'use strict';

/**
 * Express 4 does not catch rejected promises from async handlers, so every
 * async route is wrapped here and forwards failures to the error middleware.
 */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
