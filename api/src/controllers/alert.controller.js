'use strict';

const { Op } = require('sequelize');

const { Alert, Pack, Batch, Medicine, Organization } = require('../models');
const detection = require('../services/detection.service');
const scoring = require('../services/scoring.service');
const ApiError = require('../utils/ApiError');

const ALERT_INCLUDE = [
  {
    model: Pack,
    as: 'pack',
    attributes: ['id', 'serial', 'state', 'scanCount'],
    include: [
      { model: Organization, as: 'currentOrganization', attributes: ['id', 'name', 'type', 'city'] },
    ],
  },
  {
    model: Batch,
    as: 'batch',
    attributes: ['id', 'batchNo', 'status', 'expiresOn'],
    include: [{ model: Medicine, as: 'medicine', attributes: ['id', 'name', 'strength'] }],
  },
];

async function list(req, res) {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.severity) where.severity = req.query.severity;
  if (req.query.rule) where.rule = req.query.rule;
  if (req.query.batchId) where.batchId = Number(req.query.batchId);

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const { rows, count } = await Alert.findAndCountAll({
    where,
    include: ALERT_INCLUDE,
    // Critical first, then newest: a triage queue sorted by time alone buries
    // the one alert that matters under fifty that do not.
    order: [
      ['status', 'ASC'],
      ['severity', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit,
    offset,
  });

  const openCount = await Alert.count({ where: { status: { [Op.in]: ['open', 'investigating'] } } });

  res.json({ total: count, open: openCount, limit, offset, alerts: rows });
}

async function getById(req, res) {
  const alert = await Alert.findByPk(req.params.id, { include: ALERT_INCLUDE });
  if (!alert) throw ApiError.notFound('No alert with that id exists');
  res.json({ alert });
}

/**
 * Triage. A regulator confirms or dismisses, and either way the decision is
 * attributed and kept — a dismissed alert that turns out to have been real is
 * exactly the record an inquiry would want.
 */
async function triage(req, res) {
  const alert = await Alert.findByPk(req.params.id);
  if (!alert) throw ApiError.notFound('No alert with that id exists');

  const { status, resolutionNote } = req.body;
  const closing = ['confirmed', 'dismissed'].includes(status);

  await alert.update({
    status,
    resolutionNote: resolutionNote ?? alert.resolutionNote,
    resolvedByUserId: closing ? req.user.id : null,
    resolvedAt: closing ? new Date() : null,
  });

  res.json({ alert });
}

/** Score everything, or one batch. The sweep a regulator runs on demand. */
async function run(req, res) {
  const result = await detection.runDetection({
    batchId: req.body?.batchId ? Number(req.body.batchId) : null,
    limit: Math.min(Number(req.body?.limit) || 5000, 20000),
  });

  res.json({
    evaluated: result.evaluated,
    alertsCreated: result.created,
    alertsUpdated: result.updated,
    scorer: result.scorer,
    note:
      result.scorer === 'unavailable'
        ? 'The model was unreachable, so only the deterministic rules ran. Rule alerts are unaffected.'
        : undefined,
  });
}

/** Is the model up? Answered honestly, because "unavailable" is a valid state. */
async function scorerHealth(_req, res) {
  res.json(await scoring.health());
}

module.exports = { list, getById, triage, run, scorerHealth };
