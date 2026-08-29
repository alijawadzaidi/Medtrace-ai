'use strict';

const app = require('./app');
const env = require('./config/env');
const { sequelize } = require('./models');

async function start() {
  try {
    await sequelize.authenticate();
    console.log(`[db] connected (${sequelize.getDialect()})`);
  } catch (err) {
    // Not fatal: /health stays up so the failure is visible rather than silent.
    console.error('[db] connection failed —', err.message);
  }

  const server = app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal) => async () => {
    console.log(`\n[api] ${signal} received, shutting down`);
    server.close(async () => {
      await sequelize.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

start();
