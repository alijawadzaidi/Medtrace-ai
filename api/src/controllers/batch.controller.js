'use strict';

const { Batch, Medicine, Organization, Pack } = require('../models');
const batchService = require('../services/batch.service');
const qrService = require('../services/qr.service');
const { renderLabelSheet } = require('../services/labelSheet.service');
const ApiError = require('../utils/ApiError');

const MEDICINE_INCLUDE = {
  model: Medicine,
  as: 'medicine',
  attributes: ['id', 'name', 'genericName', 'strength', 'form', 'packSize'],
};
const MANUFACTURER_INCLUDE = {
  model: Organization,
  as: 'manufacturer',
  attributes: ['id', 'name', 'city'],
};

function scopeFor(req) {
  return req.user.role === 'regulator' ? {} : { manufacturerId: req.user.organizationId };
}

async function findScoped(req) {
  const batch = await Batch.findOne({
    where: { id: req.params.id, ...scopeFor(req) },
    include: [MEDICINE_INCLUDE, MANUFACTURER_INCLUDE],
  });
  if (!batch) throw ApiError.notFound('No batch with that id exists, or it is not yours');
  return batch;
}

async function list(req, res) {
  const where = scopeFor(req);
  if (req.query.status) where.status = req.query.status;

  const batches = await Batch.findAll({
    where,
    include: [MEDICINE_INCLUDE, MANUFACTURER_INCLUDE],
    order: [['id', 'DESC']],
    limit: Math.min(Number(req.query.limit) || 50, 200),
  });

  res.json({ count: batches.length, batches });
}

async function getById(req, res) {
  const batch = await findScoped(req);
  const packCount = await Pack.count({ where: { batchId: batch.id } });

  res.json({
    batch,
    packs: { generated: packCount, expected: batch.quantity, complete: packCount === batch.quantity },
    expired: batch.isExpired(),
  });
}

async function create(req, res) {
  const batch = await batchService.createBatchWithPacks(req.body, req.user);

  const created = await Batch.findByPk(batch.id, {
    include: [MEDICINE_INCLUDE, MANUFACTURER_INCLUDE],
  });
  const sample = await Pack.findAll({
    where: { batchId: batch.id },
    attributes: ['serial'],
    limit: 3,
    order: [['id', 'ASC']],
  });

  res.status(201).json({
    batch: created,
    packsGenerated: batch.quantity,
    sampleSerials: sample.map((p) => p.serial),
    labelSheet: `/batches/${batch.id}/labels`,
  });
}

/** Paginated: a batch may hold thousands of packs. */
async function listPacks(req, res) {
  const batch = await findScoped(req);
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;

  const { rows, count } = await Pack.findAndCountAll({
    where: { batchId: batch.id },
    attributes: ['id', 'serial', 'state', 'currentOrganizationId', 'scanCount'],
    order: [['id', 'ASC']],
    limit,
    offset,
  });

  res.json({
    batch: { id: batch.id, batchNo: batch.batchNo },
    total: count,
    limit,
    offset,
    packs: rows.map((p) => ({ ...p.get({ plain: true }), qrUrl: qrService.payloadFor(p.serial) })),
  });
}

async function recall(req, res) {
  const batch = await Batch.findByPk(req.params.id, { include: [MEDICINE_INCLUDE] });
  if (!batch) throw ApiError.notFound('No batch with that id exists');

  await batchService.recallBatch(batch, req.body.reason);

  res.json({
    batch,
    note: 'Every pack in this batch will now fail verification with a recall warning.',
  });
}

/**
 * Print-ready label sheet. Paginated because rendering an SVG QR code per pack
 * is real work: 5000 of them in one response would take seconds and produce a
 * document no browser wants to lay out.
 */
async function labelSheet(req, res) {
  const batch = await findScoped(req);

  const limit = Math.min(Number(req.query.limit) || 60, 300);
  const offset = Number(req.query.offset) || 0;

  const { rows, count } = await Pack.findAndCountAll({
    where: { batchId: batch.id },
    attributes: ['serial'],
    order: [['id', 'ASC']],
    limit,
    offset,
  });

  if (rows.length === 0) throw ApiError.notFound('No packs in that range');

  const html = await renderLabelSheet({
    batch,
    medicine: batch.medicine,
    manufacturer: batch.manufacturer,
    packs: rows,
    offset,
    total: count,
  });

  res.type('html').send(html);
}

module.exports = { list, getById, create, listPacks, recall, labelSheet };
