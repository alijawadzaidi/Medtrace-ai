'use strict';

/**
 * Tests run against SQLite in a file of their own, migrated from the real
 * migrations rather than `sequelize.sync()`. Syncing models would test a
 * schema the deployment never sees — the migrations *are* the schema, and a
 * migration that no longer applies cleanly is exactly the failure worth
 * catching here.
 */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/db/migrations/**',
    '!src/db/seeders/**',
    '!src/server.js',
  ],
  // The suite shares one SQLite file, and SQLite takes a write lock per
  // connection. Parallel workers would spend the run fighting over it.
  maxWorkers: 1,
  testTimeout: 20000,
};
