'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Rebuilds the test database once per run, from the real migrations.
 *
 * Deleting the file first is deliberate: `db:migrate:undo:all` depends on
 * every `down` still working, and a suite that cannot start because of a
 * broken rollback is a bad way to find out about it. Starting from nothing
 * makes the run reproducible whatever state the last one left behind.
 */
module.exports = async () => {
  process.env.NODE_ENV = 'test';

  const root = path.join(__dirname, '..', '..');
  const storage = path.join(root, 'medtrace.test.sqlite');
  if (fs.existsSync(storage)) fs.unlinkSync(storage);

  execFileSync('npx', ['sequelize-cli', 'db:migrate', '--env', 'test'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' },
  });
};
