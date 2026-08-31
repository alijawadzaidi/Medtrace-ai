'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * The token carries the organization id as well as the role. Without it every
 * request would need a database round-trip just to answer "whose data is this".
 */
function sign(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
      orgId: user.organizationId,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn, issuer: 'medtrace-api' }
  );
}

function verify(token) {
  try {
    return jwt.verify(token, env.jwt.secret, { issuer: 'medtrace-api' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Your session has expired, please sign in again');
    }
    throw ApiError.unauthorized('Invalid authentication token');
  }
}

/** Pull a bearer token out of the Authorization header, if present. */
function fromHeader(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

module.exports = { sign, verify, fromHeader };
