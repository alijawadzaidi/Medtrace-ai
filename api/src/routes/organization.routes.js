'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/organization.controller');

const router = express.Router();

router.get('/organizations', requireAuth, asyncHandler(controller.list));
router.get('/organizations/:id', requireAuth, asyncHandler(controller.getById));

module.exports = router;
