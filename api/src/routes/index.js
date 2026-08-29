'use strict';

const express = require('express');
const healthRoutes = require('./health.routes');

const router = express.Router();

router.use(healthRoutes);

// Phase 1 mounts /auth here, Phase 2 mounts /medicines and /batches,
// Phase 3 /shipments, Phase 4 /verify.

router.get('/', (_req, res) => {
  res.json({
    service: 'MedTrace AI API',
    docs: '/docs (Phase 7)',
    endpoints: ['/health', '/health/ready'],
  });
});

module.exports = router;
