'use strict';

const express = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const organizationRoutes = require('./organization.routes');
const auditLogRoutes = require('./auditLog.routes');

const router = express.Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(organizationRoutes);
router.use(auditLogRoutes);

// Phase 2 mounts /medicines and /batches, Phase 3 /shipments, Phase 4 /verify.

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
      'GET  /audit-logs (regulator only)',
    ],
  });
});

module.exports = router;
