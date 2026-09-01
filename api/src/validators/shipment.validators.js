'use strict';

const { z } = require('zod');

const createShipmentSchema = z.object({
  toOrganizationId: z.coerce
    .number()
    .int()
    .positive({ error: 'A destination organization is required' }),
  serials: z
    .array(z.string().trim().min(1), { error: 'Provide the serials to ship' })
    .min(1, { error: 'A shipment needs at least one pack' })
    .max(2000, { error: 'A shipment is limited to 2000 packs' }),
  carrier: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

module.exports = { createShipmentSchema };
