'use strict';

const { AuditLog } = require('../models');

/** Regulator-only. The audit trail is oversight material, not user-facing data. */
async function list(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const where = {};
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.action) where.action = req.query.action;

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [['id', 'DESC']],
    limit,
    offset,
  });

  res.json({ total: count, limit, offset, logs: rows });
}

module.exports = { list };
