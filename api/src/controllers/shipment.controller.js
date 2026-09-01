'use strict';

const { Op } = require('sequelize');
const { Shipment, ShipmentItem, Pack, Organization, Batch, Medicine } = require('../models');
const shipmentService = require('../services/shipment.service');
const ApiError = require('../utils/ApiError');

const ORG_ATTRS = ['id', 'name', 'type', 'city'];
const INCLUDES = [
  { model: Organization, as: 'fromOrganization', attributes: ORG_ATTRS },
  { model: Organization, as: 'toOrganization', attributes: ORG_ATTRS },
];

/**
 * A shipment is visible to both ends of it, and to regulators. Nobody else
 * has any business seeing that two other companies traded stock.
 */
function scopeFor(req) {
  if (req.user.role === 'regulator') return {};
  const orgId = req.user.organizationId;
  return { [Op.or]: [{ fromOrganizationId: orgId }, { toOrganizationId: orgId }] };
}

async function findScoped(req) {
  const shipment = await Shipment.findOne({
    where: { id: req.params.id, ...scopeFor(req) },
    include: INCLUDES,
  });
  if (!shipment) throw ApiError.notFound('No shipment with that id exists, or it is not yours');
  return shipment;
}

async function list(req, res) {
  const where = scopeFor(req);
  if (req.query.status) where.status = req.query.status;

  const shipments = await Shipment.findAll({
    where,
    include: INCLUDES,
    order: [['id', 'DESC']],
    limit: Math.min(Number(req.query.limit) || 50, 200),
  });

  const counts = await ShipmentItem.findAll({
    attributes: [
      'shipmentId',
      [ShipmentItem.sequelize.fn('COUNT', ShipmentItem.sequelize.col('pack_id')), 'packCount'],
    ],
    where: { shipmentId: { [Op.in]: shipments.map((s) => s.id) } },
    group: ['shipmentId'],
    raw: true,
  });
  const countBy = new Map(counts.map((c) => [c.shipmentId, Number(c.packCount)]));

  res.json({
    count: shipments.length,
    shipments: shipments.map((s) => ({
      ...s.get({ plain: true }),
      packCount: countBy.get(s.id) || 0,
      direction:
        req.user.role === 'regulator'
          ? 'oversight'
          : Number(s.fromOrganizationId) === Number(req.user.organizationId)
            ? 'outbound'
            : 'inbound',
    })),
  });
}

async function getById(req, res) {
  const shipment = await findScoped(req);

  const items = await ShipmentItem.findAll({
    where: { shipmentId: shipment.id },
    include: [
      {
        model: Pack,
        as: 'pack',
        attributes: ['id', 'serial', 'state'],
        include: [
          {
            model: Batch,
            as: 'batch',
            attributes: ['id', 'batchNo', 'expiresOn', 'status'],
            include: [{ model: Medicine, as: 'medicine', attributes: ['id', 'name', 'strength', 'form'] }],
          },
        ],
      },
    ],
    limit: Math.min(Number(req.query.limit) || 100, 500),
  });

  const total = await ShipmentItem.count({ where: { shipmentId: shipment.id } });

  res.json({
    shipment,
    packCount: total,
    packs: items.map((i) => i.pack),
  });
}

async function create(req, res) {
  const { shipment, packCount } = await shipmentService.createShipment(req.body, req.user);

  const created = await Shipment.findByPk(shipment.id, { include: INCLUDES });
  res.status(201).json({
    shipment: created,
    packCount,
    next: `POST /shipments/${shipment.id}/dispatch`,
  });
}

async function dispatch(req, res) {
  const shipment = await findScoped(req);
  const result = await shipmentService.dispatchShipment(shipment, req.user);

  res.json({
    shipment: await Shipment.findByPk(shipment.id, { include: INCLUDES }),
    packCount: result.packCount,
    next: `POST /shipments/${shipment.id}/receive (as the destination organization)`,
  });
}

async function receive(req, res) {
  const shipment = await findScoped(req);
  const result = await shipmentService.receiveShipment(shipment, req.user);

  res.json({
    shipment: await Shipment.findByPk(shipment.id, { include: INCLUDES }),
    packCount: result.packCount,
  });
}

async function cancel(req, res) {
  const shipment = await findScoped(req);
  await shipmentService.cancelShipment(shipment, req.user);
  res.json({ shipment: await Shipment.findByPk(shipment.id, { include: INCLUDES }) });
}

module.exports = { list, getById, create, dispatch, receive, cancel };
