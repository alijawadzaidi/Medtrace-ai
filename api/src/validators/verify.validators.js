'use strict';

const { z } = require('zod');

/**
 * The scanner posts coordinates only when the customer granted the browser's
 * location prompt, which most will not. Everything here is optional by design:
 * a verification must never fail because a permission was declined.
 */
const verifySchema = z.object({
  serial: z.string().trim().min(1, 'A serial number is required').max(64),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

module.exports = { verifySchema };
