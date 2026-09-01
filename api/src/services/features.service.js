'use strict';

const { Op } = require('sequelize');

const { Pack, Batch, ScanEvent } = require('../models');
const geo = require('./geo.service');

/**
 * The feature vector, computed from `scan_events`.
 *
 * This is the contract between three things that must never disagree: the
 * training export, the live scoring call, and the Python model. They disagree
 * the moment someone adds a feature in one place and not the others, and the
 * failure is silent — the model keeps returning scores, they are just wrong.
 *
 * Two decisions guard against that:
 *
 * 1. **Features are sent as a named object, never a positional array.** A
 *    reordered array is the classic way a model quietly starts scoring
 *    `scan_count` as `days_to_expiry`; the Python service reindexes by name
 *    using this same list, so a mismatch is an error rather than a wrong
 *    answer.
 * 2. **`FEATURE_ORDER` is exported and versioned.** Anything that persists a
 *    vector records which version produced it.
 */
const FEATURE_ORDER = [
  'max_speed_kmh',
  'scan_count',
  'distinct_regions',
  'custody_hops',
  'dwell_variance',
  'batch_scan_entropy',
  'days_to_expiry',
];

const FEATURE_VERSION = 1;

/** ~11 km. Coarse enough that one city is one region, fine enough to separate two. */
const REGION_PRECISION = 1;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function variance(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/**
 * Shannon entropy of the batch's verification traffic across days.
 *
 * An honest batch is scanned as customers happen to buy its packs: a thin
 * spread over weeks, which is high entropy. A batch that was photographed and
 * mass-printed produces a spike — many scans in a few days — which is low
 * entropy. This is the one feature that is a property of the *batch* rather
 * than the pack, and every pack in the batch carries it.
 */
function entropyOf(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;

  let entropy = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Greatest implied velocity between consecutive positioned events.
 *
 * The single strongest signal that a serial exists in two places: a genuine
 * pack cannot outrun a plane. Events without coordinates are skipped rather
 * than assumed to be at the previous location — inventing a position would
 * manufacture a speed that never happened.
 */
function maxSpeedKmh(events) {
  const positioned = events.filter((e) => e.latitude != null && e.longitude != null);

  let max = 0;
  for (let i = 1; i < positioned.length; i += 1) {
    const speed = geo.impliedSpeedKmh(
      {
        latitude: positioned[i - 1].latitude,
        longitude: positioned[i - 1].longitude,
        at: positioned[i - 1].createdAt,
      },
      {
        latitude: positioned[i].latitude,
        longitude: positioned[i].longitude,
        at: positioned[i].createdAt,
      }
    );
    if (speed != null && Number.isFinite(speed) && speed > max) max = speed;
    // MAX_SAFE_INTEGER is geo's "same instant, different places". Treat it as a
    // large but finite speed so the model sees a number rather than an outlier
    // that swamps every other feature.
    if (speed === Number.MAX_SAFE_INTEGER) max = Math.max(max, 5000);
  }
  return Math.round(max * 100) / 100;
}

/** How many distinct ~11 km cells this pack has been seen in. */
function distinctRegions(events) {
  const cells = new Set();
  for (const event of events) {
    if (event.latitude == null || event.longitude == null) continue;
    cells.add(
      `${geo.round(event.latitude, REGION_PRECISION)},${geo.round(event.longitude, REGION_PRECISION)}`
    );
  }
  return cells.size;
}

/** Every change of holder, counted from the custody events themselves. */
function custodyHops(events) {
  let hops = 0;
  let holder = null;
  for (const event of events) {
    if (event.type === 'verified') continue; // a customer scan is not a hop
    if (event.organizationId == null) continue;
    if (holder != null && Number(event.organizationId) !== Number(holder)) hops += 1;
    holder = event.organizationId;
  }
  return hops;
}

/**
 * Variance, in hours squared, of how long the pack sat with each holder.
 *
 * Catches warehouse stalling and expiry gaming: a pack that moves briskly
 * through three holders and then sits somewhere for four months has a very
 * different profile from one that moves evenly.
 */
function dwellVariance(events) {
  const custody = events.filter((e) => e.type !== 'verified' && e.organizationId != null);
  if (custody.length < 2) return 0;

  const dwells = [];
  for (let i = 1; i < custody.length; i += 1) {
    const hours = (new Date(custody[i].createdAt) - new Date(custody[i - 1].createdAt)) / HOUR;
    if (Number.isFinite(hours) && hours >= 0) dwells.push(hours);
  }
  return Math.round(variance(dwells) * 100) / 100;
}

/** Shelf life left at the pack's most recent event — negative once expired. */
function daysToExpiry(batch, events) {
  const last = events.length ? new Date(events[events.length - 1].createdAt) : new Date();
  return Math.round((new Date(batch.expiresOn) - last) / DAY);
}

/** Pure: everything it needs is passed in, so it is trivially testable. */
function computeFeatures({ pack, batch, events, batchEntropy }) {
  const ordered = [...events].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id
  );

  return {
    max_speed_kmh: maxSpeedKmh(ordered),
    scan_count: ordered.filter((e) => e.type === 'verified').length,
    distinct_regions: distinctRegions(ordered),
    custody_hops: custodyHops(ordered),
    dwell_variance: dwellVariance(ordered),
    batch_scan_entropy: Math.round(batchEntropy * 1000) / 1000,
    days_to_expiry: daysToExpiry(batch, ordered),
    // Not a feature — carried alongside so a score can be explained and an
    // alert can name the pack it belongs to.
    _pack: { id: pack.id, serial: pack.serial, state: pack.state, batchId: pack.batchId },
  };
}

/** One entropy value per batch, computed once for all its packs. */
async function batchEntropies(batchIds) {
  if (!batchIds.length) return new Map();

  const events = await ScanEvent.findAll({
    where: { type: 'verified' },
    include: [
      {
        model: Pack,
        as: 'pack',
        attributes: ['batchId'],
        where: { batchId: { [Op.in]: batchIds } },
      },
    ],
    attributes: ['id', 'createdAt'],
  });

  const perBatch = new Map();
  for (const event of events) {
    const batchId = event.pack.batchId;
    if (!perBatch.has(batchId)) perBatch.set(batchId, new Map());
    const day = new Date(event.createdAt).toISOString().slice(0, 10);
    const days = perBatch.get(batchId);
    days.set(day, (days.get(day) || 0) + 1);
  }

  const out = new Map();
  for (const batchId of batchIds) {
    const days = perBatch.get(batchId);
    out.set(batchId, days ? entropyOf([...days.values()]) : 0);
  }
  return out;
}

/**
 * Features for a set of packs, in as few queries as possible.
 *
 * Scoring the whole catalogue is a routine operation for a regulator, so this
 * loads events in bulk rather than per pack: 20 000 packs must not mean 20 000
 * round trips.
 */
async function computeForPacks(packIds) {
  if (!packIds.length) return [];

  const packs = await Pack.findAll({
    where: { id: { [Op.in]: packIds } },
    include: [{ model: Batch, as: 'batch' }],
  });

  const events = await ScanEvent.findAll({
    where: { packId: { [Op.in]: packIds } },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });

  const byPack = new Map();
  for (const event of events) {
    if (!byPack.has(event.packId)) byPack.set(event.packId, []);
    byPack.get(event.packId).push(event);
  }

  const entropies = await batchEntropies([...new Set(packs.map((p) => p.batchId))]);

  return packs.map((pack) =>
    computeFeatures({
      pack,
      batch: pack.batch,
      events: byPack.get(pack.id) || [],
      batchEntropy: entropies.get(pack.batchId) || 0,
    })
  );
}

async function computeForPack(packId) {
  const [features] = await computeForPacks([packId]);
  return features || null;
}

/** Every pack that has moved or been scanned, for training and bulk scoring. */
async function computeForAll({ limit = 50000 } = {}) {
  const packs = await Pack.findAll({ attributes: ['id'], limit, order: [['id', 'ASC']] });
  return computeForPacks(packs.map((p) => p.id));
}

module.exports = {
  FEATURE_ORDER,
  FEATURE_VERSION,
  computeFeatures,
  computeForPack,
  computeForPacks,
  computeForAll,
  entropyOf,
  maxSpeedKmh,
  distinctRegions,
  custodyHops,
  dwellVariance,
};
