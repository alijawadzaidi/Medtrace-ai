'use strict';

const express = require('express');

const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { triageSchema, runSchema } = require('../validators/alert.validators');
const alerts = require('../controllers/alert.controller');

const router = express.Router();

/**
 * Alerts are regulator-only, and that is a deliberate line rather than an
 * oversight.
 *
 * An alert is an accusation about a specific organization's handling of a
 * specific pack. The party being accused must not be the party who can dismiss
 * it — a manufacturer able to close "recalled stock still in circulation" on
 * its own batch is a detector that reports whatever the accused prefers.
 * Everyone else sees the consequences through the public verification page,
 * which they cannot edit either.
 */
router.get('/alerts', requireAuth, requireRole('regulator'), asyncHandler(alerts.list));
router.get('/alerts/:id', requireAuth, requireRole('regulator'), asyncHandler(alerts.getById));

router.patch(
  '/alerts/:id',
  requireAuth,
  requireRole('regulator'),
  validate(triageSchema),
  asyncHandler(alerts.triage)
);

router.post(
  '/detection/run',
  requireAuth,
  requireRole('regulator'),
  validate(runSchema),
  asyncHandler(alerts.run)
);

router.get(
  '/detection/health',
  requireAuth,
  requireRole('regulator'),
  asyncHandler(alerts.scorerHealth)
);

module.exports = router;
