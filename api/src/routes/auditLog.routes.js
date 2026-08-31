'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const controller = require('../controllers/auditLog.controller');

const router = express.Router();

router.get(
  '/audit-logs',
  requireAuth,
  requireRole('regulator'),
  asyncHandler(controller.list)
);

module.exports = router;
