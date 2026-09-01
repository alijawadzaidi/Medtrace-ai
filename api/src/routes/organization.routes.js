'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/organization.controller');

const router = express.Router();

router.get('/organizations', requireAuth, asyncHandler(controller.list));

// Must be declared before '/organizations/:id', or Express matches "partners"
// as an id and the route is unreachable.
router.get('/organizations/partners', requireAuth, asyncHandler(controller.listPartners));

router.get('/organizations/:id', requireAuth, asyncHandler(controller.getById));

module.exports = router;
