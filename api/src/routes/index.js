'use strict';

const express = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const organizationRoutes = require('./organization.routes');
const catalogueRoutes = require('./catalogue.routes');
const shipmentRoutes = require('./shipment.routes');
const auditLogRoutes = require('./auditLog.routes');

const router = express.Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(organizationRoutes);
router.use(catalogueRoutes);
router.use(shipmentRoutes);
router.use(auditLogRoutes);

// Phase 4 mounts the public, unauthenticated /verify endpoint.

router.get('/', (_req, res) => {
  res.json({
    service: 'MedTrace AI API',
    docs: '/docs (Phase 7)',
    endpoints: [
      'GET  /health',
      'GET  /health/ready',
      'POST /auth/register',
      'POST /auth/login',
      'GET  /auth/me',
      'PATCH /auth/me',
      'GET  /organizations',
      'GET  /organizations/:id',
      'GET  /medicines',
      'POST /medicines (manufacturer)',
      'GET  /batches',
      'POST /batches (manufacturer)',
      'GET  /batches/:id/packs',
      'GET  /batches/:id/labels',
      'POST /batches/:id/recall (regulator)',
      'GET  /packs/:serial',
      'GET  /packs/:serial/qr.png',
      'GET  /packs/:serial/history',
      'POST /packs/:serial/dispense (pharmacy)',
      'GET  /shipments',
      'POST /shipments (manufacturer, distributor)',
      'POST /shipments/:id/dispatch',
      'POST /shipments/:id/receive',
      'POST /shipments/:id/cancel',
      'GET  /audit-logs (regulator only)',
    ],
  });
});

module.exports = router;
