'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { verifySchema } = require('../validators/verify.validators');
const verification = require('../controllers/verification.controller');
const env = require('../config/env');

const router = express.Router();

/**
 * Public verification is the one unauthenticated surface in the system, which
 * makes it the one that needs its own limit. Two different abuses are worth
 * stopping and they need different numbers:
 *
 *   - **Enumeration.** Guessing serials to find a valid one. 60 bits of
 *     randomness already makes this hopeless, but a slow door costs nothing.
 *   - **Scan-count inflation.** Hammering one real serial to trip the
 *     scan-storm rule and bury a genuine pack in false alerts.
 *
 * The limit is per IP and deliberately generous for a human with a phone —
 * a pharmacist checking a shelf full of boxes must not be locked out — and
 * tight for a script. Repeat scans of the same serial from the same network
 * are additionally de-duplicated inside the service, so a customer refreshing
 * the page does not distort the detector's training data.
 */
const verifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  message: {
    error: {
      message: 'Too many verification requests. Wait a minute and scan again.',
    },
  },
});

router.get('/verify/:serial', verifyLimiter, asyncHandler(verification.verifyBySerial));

router.post(
  '/verify',
  verifyLimiter,
  validate(verifySchema),
  asyncHandler(verification.verifyWithPosition)
);

// The QR image itself is public: it is printed on the box, so it is not a
// secret, and a reprint should not require an account.
router.get('/verify/:serial/qr.png', verifyLimiter, asyncHandler(verification.qrImage));

module.exports = router;
