'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const requestContext = require('./utils/requestContext');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const env = require('./config/env');

const app = express();

app.set('trust proxy', 1); // correct client IPs behind a platform proxy
app.disable('x-powered-by');

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Opens the per-request context that the audit hooks read from. Must sit
// above the routes so every write below it is attributable.
app.use(requestContext.middleware());

if (!env.isTest) {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// A broad default limit. Phase 4 adds a much tighter one on public verification.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.isTest,
  })
);

app.use('/', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
