'use strict';

const ApiError = require('../utils/ApiError');

module.exports = (req, _res, next) => {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
};
