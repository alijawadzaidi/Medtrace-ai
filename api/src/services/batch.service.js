'use strict';

const { sequelize, Batch, Pack, Medicine } = require('../models');
const serialService = require('./serial.service');
const ApiError = require('../utils/ApiError');
const requestContext = require('../utils/requestContext');

/**
 * Hard ceiling on one batch. Real production runs are far larger, but each
 * pack is a database row and the printable label sheet renders every one of
 * them, so an unbounded number here turns a demo into a hung request.
 */
const MAX_PACKS_PER_BATCH = 5000;
const INSERT_CHUNK = 500;

/**
 * Creates a batch and its packs in one transaction. Either the batch exists
 * with a full complement of packs, or nothing was written — a batch holding
 * half its packs would be silently wrong in a way nobody would notice until
 * the counts stopped matching.
 */
async function createBatchWithPacks({ medicineId, batchNo, manufacturedOn, expiresOn, quantity }, actor) {
  if (quantity > MAX_PACKS_PER_BATCH) {
    throw ApiError.badRequest(
      `A batch is limited to ${MAX_PACKS_PER_BATCH} packs. Split larger runs across batches.`
    );
  }

  const medicine = await Medicine.findByPk(medicineId);
  if (!medicine) throw ApiError.badRequest('No medicine with that id exists');
  if (Number(medicine.manufacturerId) !== Number(actor.organizationId)) {
    throw ApiError.forbidden('That medicine belongs to another manufacturer');
  }
  if (!medicine.isActive) throw ApiError.badRequest('That medicine is no longer active');

  const existing = await Batch.findOne({ where: { batchNo } });
  if (existing) throw ApiError.conflict('A batch with that batch number already exists');

  return sequelize.transaction(async (transaction) => {
    const batchCode = serialService.generateBatchCode();

    const batch = await Batch.create(
      {
        medicineId,
        manufacturerId: actor.organizationId,
        batchNo,
        batchCode,
        manufacturedOn,
        expiresOn,
        quantity,
      },
      { transaction }
    );

    const serials = serialService.generateSerials(batchCode, quantity);
    const now = new Date();
    const rows = serials.map((serial) => ({
      batchId: batch.id,
      serial,
      currentOrganizationId: actor.organizationId,
      state: 'created',
      scanCount: 0,
      createdAt: now,
      updatedAt: now,
    }));

    // bulkCreate without individualHooks deliberately skips the per-row audit
    // hook: 5000 audit rows for one action is noise, not a trail. The batch
    // creation above is audited, and it carries the quantity.
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await Pack.bulkCreate(rows.slice(i, i + INSERT_CHUNK), { transaction });
    }

    return batch;
  });
}

/**
 * Recalling a batch is one write. Every pack inherits the state at
 * verification time, which is why recall lives on the batch and not the pack.
 */
async function recallBatch(batch, reason) {
  const { user } = requestContext.get();
  if (batch.status === 'recalled') {
    throw ApiError.conflict('That batch is already recalled');
  }

  await batch.update({
    status: 'recalled',
    recalledAt: new Date(),
    recallReason: reason || `Recalled by ${user?.fullName || 'regulator'}`,
  });

  return batch;
}

module.exports = { createBatchWithPacks, recallBatch, MAX_PACKS_PER_BATCH };
