'use strict';

const express = require('express');

const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  createMedicineSchema,
  updateMedicineSchema,
  createBatchSchema,
  recallSchema,
} = require('../validators/catalogue.validators');

const medicines = require('../controllers/medicine.controller');
const batches = require('../controllers/batch.controller');
const packs = require('../controllers/pack.controller');

const router = express.Router();

// ---------------------------------------------------------------- medicines
router.get('/medicines', requireAuth, asyncHandler(medicines.list));
router.get('/medicines/:id', requireAuth, asyncHandler(medicines.getById));

router.post(
  '/medicines',
  requireAuth,
  requireRole('manufacturer'),
  validate(createMedicineSchema),
  asyncHandler(medicines.create)
);
router.patch(
  '/medicines/:id',
  requireAuth,
  requireRole('manufacturer'),
  validate(updateMedicineSchema),
  asyncHandler(medicines.update)
);
router.delete(
  '/medicines/:id',
  requireAuth,
  requireRole('manufacturer'),
  asyncHandler(medicines.deactivate)
);

// ------------------------------------------------------------------ batches
router.get('/batches', requireAuth, asyncHandler(batches.list));
router.get('/batches/:id', requireAuth, asyncHandler(batches.getById));
router.get('/batches/:id/packs', requireAuth, asyncHandler(batches.listPacks));
router.get('/batches/:id/labels', requireAuth, asyncHandler(batches.labelSheet));

router.post(
  '/batches',
  requireAuth,
  requireRole('manufacturer'),
  validate(createBatchSchema),
  asyncHandler(batches.create)
);

// Recall is regulator-only: a manufacturer must not be able to quietly
// un-flag its own product.
router.post(
  '/batches/:id/recall',
  requireAuth,
  requireRole('regulator'),
  validate(recallSchema),
  asyncHandler(batches.recall)
);

// -------------------------------------------------------------------- packs
router.get('/packs/:serial', requireAuth, asyncHandler(packs.getBySerial));
router.get('/packs/:serial/qr.png', requireAuth, asyncHandler(packs.qrImage));
router.get('/packs/:serial/history', requireAuth, asyncHandler(packs.history));

router.post(
  '/packs/:serial/dispense',
  requireAuth,
  requireRole('pharmacy'),
  asyncHandler(packs.dispense)
);

module.exports = router;
