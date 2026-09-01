'use strict';

const { Op } = require('sequelize');
const crypto = require('node:crypto');

const { sequelize, Shipment, ShipmentItem, Pack, Batch, Organization, ScanEvent } = require('../models');
const custody = require('./custody.service');
const serialService = require('./serial.service');
const ApiError = require('../utils/ApiError');
const requestContext = require('../utils/requestContext');

const MAX_PACKS_PER_SHIPMENT = 2000;

function makeReference() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `SHP-${day}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Every custody change writes a scan_event. Coordinates come from the acting
 * organization, because the detector's strongest feature is implied travel
 * speed between consecutive events and it needs a position on every one.
 */
async function recordEvents({ packIds, type, organization, shipmentId, metadata }, transaction) {
  const { user, ipAddress } = requestContext.get();
  const now = new Date();

  const rows = packIds.map((packId) => ({
    packId,
    type,
    organizationId: organization?.id ?? null,
    userId: user?.id ?? null,
    shipmentId: shipmentId ?? null,
    latitude: organization?.latitude ?? null,
    longitude: organization?.longitude ?? null,
    ipAddress: ipAddress ?? null,
    // The model's setter serialises this; pre-stringifying would nest it.
    metadata: metadata ?? null,
    createdAt: now,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await ScanEvent.bulkCreate(rows.slice(i, i + CHUNK), { transaction });
  }
}

/** Resolves serials to packs, failing loudly on anything unusable. */
async function resolvePacks(serials, transaction) {
  const normalised = [...new Set(serials.map((s) => serialService.normalise(s)))];

  const malformed = normalised.filter((s) => !serialService.isWellFormed(s));
  if (malformed.length) {
    throw ApiError.badRequest('Some serials are not valid MedTrace serials', {
      serials: malformed.slice(0, 10),
    });
  }

  const packs = await Pack.findAll({
    where: { serial: { [Op.in]: normalised } },
    include: [{ model: Batch, as: 'batch', attributes: ['id', 'status', 'batchNo', 'expiresOn'] }],
    transaction,
  });

  if (packs.length !== normalised.length) {
    const found = new Set(packs.map((p) => p.serial));
    throw ApiError.badRequest('Some serials do not exist', {
      serials: normalised.filter((s) => !found.has(s)).slice(0, 10),
    });
  }

  return packs;
}

async function createShipment({ toOrganizationId, serials, carrier, notes }, actor) {
  if (serials.length > MAX_PACKS_PER_SHIPMENT) {
    throw ApiError.badRequest(`A shipment is limited to ${MAX_PACKS_PER_SHIPMENT} packs`);
  }

  const [from, to] = await Promise.all([
    Organization.findByPk(actor.organizationId),
    Organization.findByPk(toOrganizationId),
  ]);

  if (!to) throw ApiError.badRequest('No destination organization with that id exists');
  if (!to.isActive) throw ApiError.badRequest('That destination organization is not active');
  if (Number(to.id) === Number(from.id)) {
    throw ApiError.badRequest('A shipment must go to a different organization');
  }

  custody.assertRouteAllowed(from.type, to.type);

  return sequelize.transaction(async (transaction) => {
    const packs = await resolvePacks(serials, transaction);

    for (const pack of packs) {
      custody.assertHolder(pack, actor.organizationId);
      custody.assertTransition(pack, 'in_transit');
      if (pack.batch.status === 'recalled') {
        throw ApiError.conflict(
          `Pack ${pack.serial} belongs to recalled batch ${pack.batch.batchNo} and cannot be shipped`
        );
      }
    }

    // A pack already committed to an open shipment must not be double-booked.
    const packIds = packs.map((p) => p.id);
    const alreadyCommitted = await ShipmentItem.findAll({
      where: { packId: { [Op.in]: packIds } },
      include: [
        {
          model: Shipment,
          as: 'shipment',
          where: { status: { [Op.in]: ['draft', 'in_transit'] } },
          attributes: ['id', 'reference', 'status'],
        },
      ],
      transaction,
    });

    if (alreadyCommitted.length) {
      throw ApiError.conflict('Some packs are already on an open shipment', {
        shipments: [...new Set(alreadyCommitted.map((i) => i.shipment.reference))].slice(0, 5),
      });
    }

    const shipment = await Shipment.create(
      {
        reference: makeReference(),
        fromOrganizationId: from.id,
        toOrganizationId: to.id,
        status: 'draft',
        createdByUserId: actor.id,
        carrier: carrier || null,
        notes: notes || null,
      },
      { transaction }
    );

    const now = new Date();
    await ShipmentItem.bulkCreate(
      packIds.map((packId) => ({ shipmentId: shipment.id, packId, createdAt: now })),
      { transaction }
    );

    return { shipment, packCount: packIds.length };
  });
}

async function dispatchShipment(shipment, actor) {
  if (shipment.status !== 'draft') {
    throw ApiError.conflict(`This shipment is "${shipment.status}" and cannot be dispatched`);
  }
  if (Number(shipment.fromOrganizationId) !== Number(actor.organizationId)) {
    throw ApiError.forbidden('Only the sending organization can dispatch this shipment');
  }

  return sequelize.transaction(async (transaction) => {
    const from = await Organization.findByPk(shipment.fromOrganizationId, { transaction });
    const items = await ShipmentItem.findAll({
      where: { shipmentId: shipment.id },
      include: [{ model: Pack, as: 'pack' }],
      transaction,
    });

    // Re-check at dispatch: state may have moved since the draft was created.
    for (const { pack } of items) {
      custody.assertHolder(pack, actor.organizationId);
      custody.assertTransition(pack, 'in_transit');
    }

    const packIds = items.map((i) => i.packId);

    // Bulk update: per-row hooks would write one audit row per pack, which is
    // noise. The shipment update below is the auditable event.
    await Pack.update(
      { state: 'in_transit', currentOrganizationId: null },
      { where: { id: { [Op.in]: packIds } }, transaction }
    );

    await recordEvents(
      { packIds, type: 'dispatched', organization: from, shipmentId: shipment.id },
      transaction
    );

    await shipment.update({ status: 'in_transit', dispatchedAt: new Date() }, { transaction });

    return { shipment, packCount: packIds.length };
  });
}

async function receiveShipment(shipment, actor) {
  if (shipment.status !== 'in_transit') {
    throw ApiError.conflict(`This shipment is "${shipment.status}" and cannot be received`);
  }
  if (Number(shipment.toOrganizationId) !== Number(actor.organizationId)) {
    throw ApiError.forbidden('Only the destination organization can receive this shipment');
  }

  return sequelize.transaction(async (transaction) => {
    const to = await Organization.findByPk(shipment.toOrganizationId, { transaction });
    const items = await ShipmentItem.findAll({
      where: { shipmentId: shipment.id },
      include: [{ model: Pack, as: 'pack' }],
      transaction,
    });

    for (const { pack } of items) custody.assertTransition(pack, 'received');

    const packIds = items.map((i) => i.packId);

    await Pack.update(
      { state: 'received', currentOrganizationId: to.id },
      { where: { id: { [Op.in]: packIds } }, transaction }
    );

    await recordEvents(
      { packIds, type: 'received', organization: to, shipmentId: shipment.id },
      transaction
    );

    await shipment.update(
      { status: 'received', receivedAt: new Date(), receivedByUserId: actor.id },
      { transaction }
    );

    return { shipment, packCount: packIds.length };
  });
}

async function cancelShipment(shipment, actor) {
  if (shipment.status !== 'draft') {
    throw ApiError.conflict(`Only a draft shipment can be cancelled; this one is "${shipment.status}"`);
  }
  if (Number(shipment.fromOrganizationId) !== Number(actor.organizationId)) {
    throw ApiError.forbidden('Only the sending organization can cancel this shipment');
  }

  // Packs never left 'created'/'received', so there is nothing to undo.
  await shipment.update({ status: 'cancelled' });
  return shipment;
}

/** The end of the chain: a pharmacy hands a pack to a patient. */
async function dispensePack(pack, actor) {
  custody.assertTransition(pack, 'dispensed');

  if (Number(pack.currentOrganizationId) !== Number(actor.organizationId)) {
    throw ApiError.forbidden('That pack is not held by your pharmacy');
  }
  if (pack.batch.status === 'recalled') {
    throw ApiError.conflict(
      `Batch ${pack.batch.batchNo} is recalled. This pack must not be dispensed.`
    );
  }
  if (pack.batch.isExpired()) {
    throw ApiError.conflict(`Batch ${pack.batch.batchNo} expired on ${pack.batch.expiresOn}`);
  }

  return sequelize.transaction(async (transaction) => {
    const organization = await Organization.findByPk(actor.organizationId, { transaction });

    await pack.update({ state: 'dispensed', dispensedAt: new Date() }, { transaction });
    await recordEvents({ packIds: [pack.id], type: 'dispensed', organization }, transaction);

    return pack;
  });
}

module.exports = {
  createShipment,
  dispatchShipment,
  receiveShipment,
  cancelShipment,
  dispensePack,
  recordEvents,
  MAX_PACKS_PER_SHIPMENT,
};
