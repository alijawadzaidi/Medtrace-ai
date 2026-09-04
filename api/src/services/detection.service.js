'use strict';

const { Op } = require('sequelize');

const { Alert, Pack, Batch, ScanEvent } = require('../models');
const features = require('./features.service');
const scoring = require('./scoring.service');
const geo = require('./geo.service');

/**
 * Where the rules and the model meet.
 *
 * The plan chose Isolation Forest alone, which is a defensible scope. The
 * trouble is that an unsupervised score cannot explain itself, and "anomaly
 * score 0.83" is a much weaker answer to a regulator asking *why* than "this
 * pack moved 1,400 km in 20 minutes". So both run, into the same table:
 *
 * - **Rules** catch the things that are definitionally wrong. They are cheap,
 *   deterministic, and every alert they raise comes with its own explanation.
 * - **The model** catches the shapes nobody wrote a rule for. It is the part
 *   that generalises, and the part that produces false positives.
 *
 * Reporting both, and comparing them, is more honest than pretending either
 * one is sufficient.
 */
const IMPOSSIBLE_SPEED_KMH = 900;
const SCAN_STORM_MULTIPLE = 5; // times the batch median, floor of 5 scans
const DISPENSED_ELSEWHERE_KM = 25;

/**
 * The model decides *whether* a pack is anomalous; this only decides how loud
 * to be about it.
 *
 * An earlier version raised an alert whenever the score passed 0.65, which
 * measured terribly for a reason worth recording: the score is a percentile
 * against ordinary packs, so "above 0.65" means "in the top 35% of everything"
 * and flagged a third of the catalogue — 263 false positives against 58 real
 * ones. The model's own `is_anomaly` already respects the contamination it was
 * trained with, so that is the flag, and the score is left to sort the queue.
 */
const ANOMALY_CRITICAL_SCORE = Number(process.env.ANOMALY_CRITICAL_SCORE || 0.97);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Deterministic rules. Each returns an alert or nothing, and each carries the
 * sentence a person would say out loud.
 */
function evaluateRules({ vector, pack, batch, events }) {
  const found = [];

  if (vector.max_speed_kmh > IMPOSSIBLE_SPEED_KMH) {
    // The same-instant case is a contradiction rather than a velocity, and
    // saying so is far more use to a regulator than any number would be.
    const sameInstant = vector.max_speed_kmh >= geo.SAME_INSTANT_KMH;

    found.push({
      rule: 'impossible_travel',
      severity: 'critical',
      summary: sameInstant
        ? `Pack ${pack.serial} was recorded in two different places at the same moment — one of those records cannot be true.`
        : `Pack ${pack.serial} implies a travel speed of ${Math.round(vector.max_speed_kmh)} km/h between consecutive scans — faster than a passenger aircraft.`,
    });
  }

  // A dispensed pack is with a patient. A scan of that serial far away is
  // either a clone or a pack that was never really dispensed; both are worth
  // a person's time.
  if (pack.state === 'dispensed' && pack.dispensedAt) {
    const dispensedEvent = [...events]
      .reverse()
      .find((e) => e.type === 'dispensed' && e.latitude != null);
    const laterElsewhere = events.find(
      (e) =>
        e.type === 'verified' &&
        e.latitude != null &&
        dispensedEvent &&
        new Date(e.createdAt) > new Date(dispensedEvent.createdAt) &&
        (geo.distanceKm(dispensedEvent, e) || 0) > DISPENSED_ELSEWHERE_KM
    );

    if (laterElsewhere) {
      found.push({
        rule: 'dispensed_elsewhere',
        severity: 'critical',
        summary: `Pack ${pack.serial} was dispensed to a patient, then verified ${Math.round(geo.distanceKm(dispensedEvent, laterElsewhere))} km away.`,
      });
    }
  }

  // Custody skip: a pack arrives somewhere without anyone having sent it.
  const custody = events.filter((e) => ['dispatched', 'received'].includes(e.type));
  for (let i = 0; i < custody.length; i += 1) {
    const previous = custody[i - 1];
    if (custody[i].type === 'received' && (!previous || previous.type !== 'dispatched')) {
      found.push({
        rule: 'custody_skip',
        severity: 'warning',
        summary: `Pack ${pack.serial} was received by an organization with no record of anyone dispatching it.`,
      });
      break;
    }
  }

  if (vector.days_to_expiry < 0 && ['received', 'in_transit'].includes(pack.state)) {
    found.push({
      rule: 'expired_stock',
      severity: 'warning',
      summary: `Pack ${pack.serial} expired ${Math.abs(vector.days_to_expiry)} days ago but is still moving in the supply chain.`,
    });
  }

  if (batch.status === 'recalled' && ['in_transit', 'received'].includes(pack.state)) {
    found.push({
      rule: 'recalled_in_circulation',
      severity: 'critical',
      summary: `Pack ${pack.serial} belongs to recalled batch ${batch.batchNo} and is still held in the supply chain.`,
    });
  }

  return found;
}

/** Scan storm is a property of the pack *relative to its batch*. */
function evaluateScanStorm({ vector, pack, batchMedian }) {
  const threshold = Math.max(5, batchMedian * SCAN_STORM_MULTIPLE);
  if (vector.scan_count < threshold) return null;

  return {
    rule: 'scan_storm',
    severity: 'warning',
    summary: `Pack ${pack.serial} has been verified ${vector.scan_count} times, against a batch median of ${batchMedian}. A copied label is scanned by everyone who bought one.`,
  };
}

/**
 * One open alert per pack per rule.
 *
 * Detection re-runs constantly — every public scan, plus the regulator's
 * sweep. Without this, a single cloned pack scanned four hundred times becomes
 * four hundred identical alerts, and a triage queue nobody can use is the same
 * as no detector at all. An existing open alert is sharpened instead: newest
 * score, newest evidence.
 */
async function upsertAlert({ packId, batchId, rule, severity, summary, score, details }) {
  const existing = await Alert.findOne({
    where: { packId, rule, status: { [Op.in]: ['open', 'investigating'] } },
  });

  if (existing) {
    await existing.update({ severity, summary, score, details });
    return { alert: existing, created: false };
  }

  const alert = await Alert.create({
    packId,
    batchId,
    rule,
    severity,
    summary,
    score,
    details,
    status: 'open',
  });
  return { alert, created: true };
}

/**
 * Score a set of packs and write what it finds.
 *
 * The model call is made once for the whole set rather than per pack: scoring
 * a 5000-pack batch is one HTTP request, not five thousand.
 */
async function evaluatePacks(packIds) {
  if (!packIds.length) return { evaluated: 0, created: 0, updated: 0, scorer: 'skipped', alerts: [] };

  const vectors = await features.computeForPacks(packIds);
  const packs = await Pack.findAll({
    where: { id: { [Op.in]: packIds } },
    include: [{ model: Batch, as: 'batch' }],
  });
  const packById = new Map(packs.map((p) => [p.id, p]));

  const events = await ScanEvent.findAll({
    where: { packId: { [Op.in]: packIds } },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  const eventsByPack = new Map();
  for (const event of events) {
    if (!eventsByPack.has(event.packId)) eventsByPack.set(event.packId, []);
    eventsByPack.get(event.packId).push(event);
  }

  // The batch median for scan storm, computed across the whole batch rather
  // than across the packs being evaluated — otherwise scoring one pack makes
  // it its own median and the rule can never fire.
  const batchIds = [...new Set(packs.map((p) => p.batchId))];
  const batchScanCounts = await Pack.findAll({
    where: { batchId: { [Op.in]: batchIds } },
    attributes: ['batchId', 'scanCount'],
  });
  const medians = new Map(
    batchIds.map((batchId) => [
      batchId,
      median(batchScanCounts.filter((p) => p.batchId === batchId).map((p) => p.scanCount)),
    ])
  );

  const scores = await scoring.scoreMany(vectors);
  const scorerAvailable = scores.some((s) => s !== null);

  let created = 0;
  let updated = 0;
  const raised = [];

  for (let i = 0; i < vectors.length; i += 1) {
    const vector = vectors[i];
    const pack = packById.get(vector._pack.id);
    if (!pack) continue;

    const packEvents = eventsByPack.get(pack.id) || [];
    const scored = scores[i];

    const findings = [
      ...evaluateRules({ vector, pack, batch: pack.batch, events: packEvents }),
      evaluateScanStorm({ vector, pack, batchMedian: medians.get(pack.batchId) || 0 }),
    ].filter(Boolean);

    // The model's own verdict, kept as a separate alert so the report can
    // compare what the rules caught against what the model caught.
    if (scored && scored.isAnomaly) {
      findings.push({
        rule: 'anomaly_score',
        severity: scored.score >= ANOMALY_CRITICAL_SCORE ? 'critical' : 'warning',
        summary: `Pack ${pack.serial} scores ${scored.score.toFixed(2)} against the trained model — its history does not resemble ordinary packs.`,
      });
    }

    for (const finding of findings) {
      const result = await upsertAlert({
        packId: pack.id,
        batchId: pack.batchId,
        rule: finding.rule,
        severity: finding.severity,
        summary: finding.summary,
        score: finding.rule === 'anomaly_score' ? scored.score : null,
        details: {
          features: stripPrivate(vector),
          featureVersion: features.FEATURE_VERSION,
          modelScore: scored ? scored.score : null,
          modelVersion: scored ? scored.modelVersion : null,
        },
      });

      if (result.created) created += 1;
      else updated += 1;
      raised.push(result.alert);
    }
  }

  return {
    evaluated: vectors.length,
    created,
    updated,
    scorer: scorerAvailable ? 'available' : 'unavailable',
    alerts: raised,
  };
}

function stripPrivate(vector) {
  const out = {};
  for (const name of features.FEATURE_ORDER) out[name] = vector[name];
  return out;
}

/** The regulator's sweep: score everything, or everything in one batch. */
async function runDetection({ batchId = null, limit = 5000 } = {}) {
  const where = batchId ? { batchId } : {};
  const packs = await Pack.findAll({ where, attributes: ['id'], limit, order: [['id', 'ASC']] });
  return evaluatePacks(packs.map((p) => p.id));
}

module.exports = {
  evaluatePacks,
  runDetection,
  evaluateRules,
  upsertAlert,
  IMPOSSIBLE_SPEED_KMH,
  ANOMALY_CRITICAL_SCORE,
};
