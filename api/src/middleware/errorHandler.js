'use strict';

const { ValidationError, UniqueConstraintError, DatabaseError } = require('sequelize');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

/** Translate the errors we actually throw into a single response shape. */
function normalise(err) {
  if (err instanceof ApiError) {
    return { status: err.status, message: err.message, details: err.details };
  }

  if (err instanceof UniqueConstraintError) {
    return {
      status: 409,
      message: 'That value is already in use',
      details: err.errors.map((e) => ({ field: e.path, message: e.message })),
    };
  }

  if (err instanceof ValidationError) {
    return {
      status: 400,
      message: 'Validation failed',
      details: err.errors.map((e) => ({ field: e.path, message: e.message })),
    };
  }

  if (err instanceof DatabaseError) {
    return { status: 500, message: 'Database error' };
  }

  if (err.type === 'entity.parse.failed') {
    return { status: 400, message: 'Request body is not valid JSON' };
  }

  return { status: err.status || 500, message: err.message || 'Internal server error' };
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
module.exports = (err, req, res, next) => {
  const { status, message, details } = normalise(err);

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  res.status(status).json({
    error: {
      message,
      ...(details ? { details } : {}),
      ...(env.isProduction ? {} : { stack: err.stack }),
    },
  });
};
