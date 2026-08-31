'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
  registerSchema,
  loginSchema,
  updateMeSchema,
} = require('../validators/auth.validators');
const controller = require('../controllers/auth.controller');
const env = require('../config/env');

const router = express.Router();

/** Tighter than the global limit: credential endpoints are the ones attacked. */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { message: 'Too many attempts. Try again in a few minutes.' } },
  skip: () => env.isTest,
});

router.post(
  '/auth/register',
  credentialLimiter,
  validate(registerSchema),
  asyncHandler(controller.register)
);

router.post('/auth/login', credentialLimiter, validate(loginSchema), asyncHandler(controller.login));

router.get('/auth/me', requireAuth, asyncHandler(controller.me));

router.patch(
  '/auth/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(controller.updateMe)
);

module.exports = router;
