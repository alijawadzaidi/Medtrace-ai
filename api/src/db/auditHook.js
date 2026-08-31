'use strict';

const requestContext = require('../utils/requestContext');

/** Never written to an audit row, whatever model they appear on. */
const REDACTED = new Set(['passwordHash', 'password_hash', 'password', 'token']);

/** Models that must not audit themselves, or we recurse forever. */
const EXCLUDED_MODELS = new Set(['AuditLog', 'SequelizeMeta']);

function redact(values) {
  if (!values) return null;
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = REDACTED.has(key) ? '[redacted]' : value;
  }
  return out;
}

/** For updates, record only what actually changed — before and after. */
function diffOf(instance) {
  const changed = instance.changed();
  if (!changed || changed.length === 0) return null;

  const before = {};
  const after = {};
  for (const field of changed) {
    before[field] = REDACTED.has(field) ? '[redacted]' : instance.previous(field);
    after[field] = REDACTED.has(field) ? '[redacted]' : instance.get(field);
  }
  return { before, after };
}

/**
 * Registers global hooks so every model created from Phase 2 onward is audited
 * without any change here. Writes are best-effort: a failure to audit must
 * never fail the operation being audited.
 */
function registerAuditHooks(sequelize, AuditLog) {
  async function record(action, instance, options) {
    const modelName = instance.constructor.name;
    if (EXCLUDED_MODELS.has(modelName)) return;
    if (options?.audit === false) return;

    const { user, ipAddress, requestId } = requestContext.get();

    let changes = null;
    if (action === 'create') changes = { after: redact(instance.get({ plain: true })) };
    else if (action === 'update') changes = diffOf(instance);
    else if (action === 'delete') changes = { before: redact(instance.get({ plain: true })) };

    // The audit row joins the caller's transaction. An earlier version wrote it
    // on a separate connection so the record would survive a rollback; that
    // deadlocks against the very transaction it is auditing (SQLITE_BUSY, and
    // a pool-exhaustion risk on MySQL), and it silently lost every write made
    // inside a transaction. Auditing what committed is both correct and safe.
    //
    // Failures are fatal on purpose: in a traceability system, an unauditable
    // write is not a write worth keeping. Because the audit row is now inside
    // the transaction, throwing here rolls the whole operation back.
    await AuditLog.create(
      {
        userId: user?.id ?? null,
        organizationId: user?.organizationId ?? null,
        action,
        entity: modelName,
        entityId: instance.get(instance.constructor.primaryKeyAttribute)?.toString() ?? null,
        changes,
        ipAddress: ipAddress ?? null,
        requestId: requestId ?? null,
      },
      { transaction: options?.transaction, audit: false }
    );
  }

  sequelize.addHook('afterCreate', (instance, options) => record('create', instance, options));
  sequelize.addHook('afterUpdate', (instance, options) => record('update', instance, options));
  sequelize.addHook('afterDestroy', (instance, options) => record('delete', instance, options));

  // bulkCreate with individualHooks:false bypasses afterCreate by design;
  // callers doing bulk pack generation in Phase 2 audit at the batch level.
}

module.exports = registerAuditHooks;
