'use strict';

const { Medicine, Organization, Batch } = require('../models');
const ApiError = require('../utils/ApiError');

/** Manufacturers see their own catalogue; regulators see everything. */
function scopeFor(req) {
  return req.user.role === 'regulator' ? {} : { manufacturerId: req.user.organizationId };
}

async function list(req, res) {
  const medicines = await Medicine.findAll({
    where: scopeFor(req),
    include: [{ model: Organization, as: 'manufacturer', attributes: ['id', 'name', 'type'] }],
    order: [['name', 'ASC']],
  });

  res.json({ count: medicines.length, medicines });
}

async function getById(req, res) {
  const medicine = await Medicine.findOne({
    where: { id: req.params.id, ...scopeFor(req) },
    include: [
      { model: Organization, as: 'manufacturer', attributes: ['id', 'name', 'type'] },
      { model: Batch, as: 'batches', attributes: ['id', 'batchNo', 'quantity', 'status', 'expiresOn'] },
    ],
  });

  if (!medicine) throw ApiError.notFound('No medicine with that id exists, or it is not yours');
  res.json({ medicine });
}

async function create(req, res) {
  const medicine = await Medicine.create({
    ...req.body,
    manufacturerId: req.user.organizationId,
  });

  res.status(201).json({ medicine });
}

async function update(req, res) {
  const medicine = await Medicine.findOne({
    where: { id: req.params.id, manufacturerId: req.user.organizationId },
  });
  if (!medicine) throw ApiError.notFound('No medicine with that id exists, or it is not yours');

  await medicine.update(req.body);
  res.json({ medicine });
}

/**
 * Deactivates rather than deletes. A medicine with batches in circulation must
 * remain resolvable — a customer scanning a two-year-old pack still needs to
 * see what it is.
 */
async function deactivate(req, res) {
  const medicine = await Medicine.findOne({
    where: { id: req.params.id, manufacturerId: req.user.organizationId },
  });
  if (!medicine) throw ApiError.notFound('No medicine with that id exists, or it is not yours');

  await medicine.update({ isActive: false });
  res.json({ medicine, note: 'Medicine deactivated. Existing batches remain verifiable.' });
}

module.exports = { list, getById, create, update, deactivate };
