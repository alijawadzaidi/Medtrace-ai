'use strict';

const { z } = require('zod');

const triageSchema = z.object({
  status: z.enum(['open', 'investigating', 'confirmed', 'dismissed']),
  resolutionNote: z.string().trim().max(500).optional(),
});

const runSchema = z.object({
  batchId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(20000).optional(),
});

module.exports = { triageSchema, runSchema };
