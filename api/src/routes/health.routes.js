'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { sequelize } = require('../models');
const { version } = require('../../package.json');

const router = express.Router();

/**
 * Liveness: the process is up. Deliberately does not touch the database, so a
 * database outage does not cause a deployment platform to restart the process.
 */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({
      status: 'ok',
      service: 'medtrace-api',
      version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  })
);

/** Readiness: the process is up *and* the database answers. */
router.get(
  '/health/ready',
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now();
    let database = { connected: false, dialect: sequelize.getDialect() };

    try {
      await sequelize.authenticate();
      database = { ...database, connected: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      database = { ...database, error: err.message };
    }

    res.status(database.connected ? 200 : 503).json({
      status: database.connected ? 'ready' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    });
  })
);

module.exports = router;
