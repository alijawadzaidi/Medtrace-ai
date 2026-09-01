'use strict';

const express = require('express');

const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createShipmentSchema } = require('../validators/shipment.validators');
const shipments = require('../controllers/shipment.controller');

const router = express.Router();

router.get('/shipments', requireAuth, asyncHandler(shipments.list));
router.get('/shipments/:id', requireAuth, asyncHandler(shipments.getById));

// Regulators observe the chain; they never move stock through it.
router.post(
  '/shipments',
  requireAuth,
  requireRole('manufacturer', 'distributor'),
  validate(createShipmentSchema),
  asyncHandler(shipments.create)
);
router.post(
  '/shipments/:id/dispatch',
  requireAuth,
  requireRole('manufacturer', 'distributor'),
  asyncHandler(shipments.dispatch)
);
router.post(
  '/shipments/:id/receive',
  requireAuth,
  requireRole('distributor', 'pharmacy'),
  asyncHandler(shipments.receive)
);
router.post(
  '/shipments/:id/cancel',
  requireAuth,
  requireRole('manufacturer', 'distributor'),
  asyncHandler(shipments.cancel)
);

module.exports = router;
