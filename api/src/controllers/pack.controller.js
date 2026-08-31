'use strict';

const { Pack, Batch, Medicine, Organization } = require('../models');
const qrService = require('../services/qr.service');
const serialService = require('../services/serial.service');
const ApiError = require('../utils/ApiError');

const FULL_INCLUDE = [
  {
    model: Batch,
    as: 'batch',
    include: [
      { model: Medicine, as: 'medicine' },
      { model: Organization, as: 'manufacturer', attributes: ['id', 'name', 'city'] },
    ],
  },
  { model: Organization, as: 'currentOrganization', attributes: ['id', 'name', 'type', 'city'] },
];

/**
 * Rejects malformed serials before touching the database. The check character
 * means a typo costs no query at all, which matters once the public
 * verification endpoint is exposed in Phase 4.
 */
async function findBySerialOrFail(rawSerial) {
  const serial = serialService.normalise(rawSerial);

  if (!serialService.isWellFormed(serial)) {
    throw ApiError.badRequest('That is not a valid MedTrace serial number');
  }

  const pack = await Pack.findOne({ where: { serial }, include: FULL_INCLUDE });
  if (!pack) throw ApiError.notFound('No pack carries that serial number');
  return pack;
}

async function getBySerial(req, res) {
  const pack = await findBySerialOrFail(req.params.serial);

  // Staff view. The public, unauthenticated version arrives in Phase 4.
  if (req.user.role !== 'regulator') {
    const owns =
      Number(pack.batch.manufacturerId) === Number(req.user.organizationId) ||
      Number(pack.currentOrganizationId) === Number(req.user.organizationId);
    if (!owns) throw ApiError.forbidden('That pack is not held by your organization');
  }

  res.json({
    pack,
    qrUrl: qrService.payloadFor(pack.serial),
    batchRecalled: pack.batch.status === 'recalled',
    expired: pack.batch.isExpired(),
  });
}

/** Rendered on demand — storing thousands of PNGs would be wasted disk. */
async function qrImage(req, res) {
  const serial = serialService.normalise(req.params.serial);
  if (!serialService.isWellFormed(serial)) {
    throw ApiError.badRequest('That is not a valid MedTrace serial number');
  }

  const width = Math.min(Math.max(Number(req.query.width) || 320, 64), 1024);
  const png = await qrService.toPngBuffer(serial, { width });

  res.type('png');
  res.set('Cache-Control', 'public, max-age=31536000, immutable'); // a serial's QR never changes
  res.send(png);
}

module.exports = { getBySerial, qrImage, findBySerialOrFail };
