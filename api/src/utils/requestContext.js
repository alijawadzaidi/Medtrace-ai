'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

/**
 * Carries "who is making this request" down to the Sequelize hooks without
 * threading a user argument through every service and model call.
 */
const storage = new AsyncLocalStorage();

const requestContext = {
  run(context, callback) {
    return storage.run(context, callback);
  },

  get() {
    return storage.getStore() || {};
  },

  /** Express middleware that opens a context for the lifetime of the request. */
  middleware() {
    return (req, res, next) => {
      const requestId = req.get('x-request-id') || crypto.randomUUID();
      res.set('x-request-id', requestId);

      const context = {
        requestId,
        ipAddress: req.ip,
        get user() {
          return req.user; // read lazily: auth middleware runs after this
        },
      };

      req.context = context;
      requestContext.run(context, next);
    };
  },
};

module.exports = requestContext;
