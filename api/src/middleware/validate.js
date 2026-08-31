'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Validates one part of the request against a Zod schema and replaces it with
 * the parsed result, so handlers receive coerced, trimmed, known-shape data.
 */
module.exports = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    return next(
      ApiError.badRequest(
        'Validation failed',
        result.error.issues.map((issue) => ({
          field: issue.path.join('.') || source,
          message: issue.message,
        }))
      )
    );
  }

  req[source] = result.data;
  return next();
};
