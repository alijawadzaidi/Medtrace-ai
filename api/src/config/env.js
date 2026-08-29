'use strict';

require('dotenv').config({ quiet: true });

/** Read a required variable, failing loudly at boot rather than at first use. */
function required(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 4000),

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),

  required,
};
