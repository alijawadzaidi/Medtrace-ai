'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';

// Keep bcrypt cheap. The suite hashes a password for every fixture user, and
// ten rounds per user turns a two-second run into thirty.
process.env.BCRYPT_ROUNDS = '4';

// No scoring service is running during tests, and that is one of the things
// worth asserting: the detector must degrade to its rules rather than fail.
process.env.AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:59999';
process.env.AI_TIMEOUT_MS = '150';

/**
 * One connection per test file, closed once at the end of it.
 *
 * The models module is a singleton, so a `afterAll` inside any one `describe`
 * block closes the connection for every other block in the file — the second
 * suite then fails with SQLITE_MISUSE before its first assertion. Closing here
 * is the only place that is true exactly once per file.
 */
afterAll(async () => {
  // Public verification deliberately scores the pack *after* sending the
  // response, so a request can finish with detection still in flight. Closing
  // the connection out from under it produces a confusing SQLITE_MISUSE in the
  // test output for behaviour that is working exactly as designed. A short
  // grace period lets that work land first.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const { sequelize } = require('../../src/models');
  await sequelize.close();
});
