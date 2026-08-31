'use strict';

const { z } = require('zod');

const FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'ointment', 'drops', 'inhaler'];

const isoDate = z
  .string({ error: 'Provide a date as YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Date must be in YYYY-MM-DD format' })
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: 'That is not a real date' });

const createMedicineSchema = z.object({
  name: z.string().trim().min(2, { error: 'Name must be at least 2 characters' }).max(160),
  genericName: z.string().trim().max(160).optional(),
  strength: z.string().trim().min(1, { error: 'Strength is required, e.g. "500 mg"' }).max(60),
  form: z.enum(FORMS, { error: `Form must be one of: ${FORMS.join(', ')}` }),
  packSize: z.string().trim().max(60).optional(),
});

const updateMedicineSchema = createMedicineSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, {
    error: 'Provide at least one field to update',
  });

const createBatchSchema = z
  .object({
    medicineId: z.coerce.number().int().positive({ error: 'Medicine is required' }),
    batchNo: z
      .string()
      .trim()
      .min(3, { error: 'Batch number must be at least 3 characters' })
      .max(64)
      .regex(/^[A-Za-z0-9/-]+$/, {
        error: 'Batch number may contain letters, numbers, hyphens and slashes only',
      }),
    manufacturedOn: isoDate,
    expiresOn: isoDate,
    quantity: z.coerce
      .number()
      .int({ error: 'Quantity must be a whole number' })
      .min(1, { error: 'A batch needs at least 1 pack' })
      .max(5000, { error: 'A batch is limited to 5000 packs' }),
  })
  .refine((data) => data.expiresOn > data.manufacturedOn, {
    error: 'Expiry date must be after the manufacture date',
    path: ['expiresOn'],
  });

const recallSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { error: 'Give a reason of at least 5 characters — it appears on every scan' })
    .max(255),
});

module.exports = {
  createMedicineSchema,
  updateMedicineSchema,
  createBatchSchema,
  recallSchema,
  FORMS,
};
