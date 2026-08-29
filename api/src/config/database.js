'use strict';

require('dotenv').config({ quiet: true });

const dialect = process.env.DB_DIALECT || 'sqlite';
const logging = process.env.DB_LOGGING === 'true' ? console.log : false;

/**
 * SQLite lets the project run with no database server installed, which keeps
 * `npm run dev` working on a fresh clone. MySQL is the deployment target.
 * Migrations are written against the portable subset both dialects share.
 */
function build(overrides = {}) {
  if (dialect === 'sqlite') {
    return {
      dialect: 'sqlite',
      storage: process.env.DB_STORAGE || './medtrace.dev.sqlite',
      logging,
      ...overrides,
    };
  }

  return {
    dialect,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'medtrace',
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    logging,
    define: {
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    },
    pool: { max: 10, min: 0, idle: 10000 },
    ...overrides,
  };
}

module.exports = {
  development: build(),
  test: build({
    storage: './medtrace.test.sqlite',
    database: `${process.env.DB_NAME || 'medtrace'}_test`,
    logging: false,
  }),
  production: build(),
};
