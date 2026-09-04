'use strict';

require('dotenv').config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/** Read a required variable, failing loudly at boot rather than at first use. */
function required(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * A development convenience that must never survive contact with production.
 *
 * The JWT secret used to fall back to a hard-coded string. In development that
 * is a kindness — a fresh clone runs with no setup. Deployed, it is a complete
 * authentication bypass: the fallback is committed to a public repository, so
 * anyone who reads it can mint a valid token for any account, including a
 * regulator's, without ever seeing a password.
 *
 * Failing at boot is the only safe behaviour. A warning would be read once and
 * ignored; a service that refuses to start cannot be ignored at all.
 */
/** Values that are long enough to pass a length check and still not secrets. */
const PLACEHOLDERS = [
  'change-me-before-you-commit-anything-real',
  'dev-only-insecure-secret-not-for-deployment',
  'test-only-secret',
  'changeme',
  'secret',
];

function secretFor(key, developmentFallback) {
  const value = process.env[key];

  if (value && PLACEHOLDERS.includes(value.trim())) {
    if (isProduction) {
      throw new Error(
        `${key} is still the example placeholder. Generate a real one with: openssl rand -base64 48`
      );
    }
    return value;
  }

  if (value && value.length >= 32) return value;

  if (isProduction) {
    throw new Error(
      value
        ? `${key} is too short. Use at least 32 random characters — generate one with: openssl rand -base64 48`
        : `${key} must be set in production. Generate one with: openssl rand -base64 48`
    );
  }

  // Long enough to be a real value in development and obviously not a secret.
  return developmentFallback;
}

/**
 * Checked at boot rather than at first use, because the first use of
 * VERIFY_BASE_URL is a QR code that has already been printed onto a box.
 */
function productionUrl(key, developmentFallback) {
  const value = process.env[key];
  if (value) return value;

  if (isProduction) {
    throw new Error(`${key} must be set in production (it is encoded into every printed QR code)`);
  }
  return developmentFallback;
}

module.exports = {
  nodeEnv,
  isProduction,
  isTest,
  port: Number(process.env.PORT || 4000),

  jwt: {
    secret: secretFor('JWT_SECRET', 'dev-only-insecure-secret-not-for-deployment'),
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),

  verifyBaseUrl: productionUrl('VERIFY_BASE_URL', 'http://localhost:3000/v'),

  /**
   * A wildcard CORS origin is right for local development and wrong in
   * production, where it lets any site on the internet call this API with a
   * user's token attached.
   */
  corsOrigin: process.env.CORS_ORIGIN || (isProduction ? undefined : '*'),

  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',

  required,
};
