'use strict';

const { z } = require('zod');

const ROLES = ['manufacturer', 'distributor', 'pharmacy', 'regulator'];

/**
 * Order matters: z.email() validates before any later .trim() runs, so an
 * address pasted with surrounding whitespace would be rejected. Normalise the
 * string first, then validate the normalised value.
 */
const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }));

const password = z
  .string({ error: 'Password is required' })
  .min(8, { error: 'Password must be at least 8 characters' })
  .max(72, { error: 'Password must be 72 characters or fewer' });

const registerSchema = z.object({
  fullName: z
    .string({ error: 'Full name is required' })
    .trim()
    .min(2, { error: 'Full name must be at least 2 characters' })
    .max(120, { error: 'Full name must be 120 characters or fewer' }),
  email,
  password,
  role: z.enum(ROLES, { error: `Role must be one of: ${ROLES.join(', ')}` }),
  organizationId: z.coerce
    .number({ error: 'Organization is required' })
    .int({ error: 'Organization id must be a whole number' })
    .positive({ error: 'Organization id must be positive' }),
});

const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' }),
});

const updateMeSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, { error: 'Full name must be at least 2 characters' })
      .max(120, { error: 'Full name must be 120 characters or fewer' })
      .optional(),
    password: password.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    error: 'Provide at least one field to update',
  });

module.exports = { registerSchema, loginSchema, updateMeSchema, ROLES };
