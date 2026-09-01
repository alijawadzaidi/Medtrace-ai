'use strict';

const { Op } = require('sequelize');

const { sequelize, Pack, Batch, Medicine, Organization, ScanEvent } = require('../models');
const serialService = require('./serial.service');
const geo = require('./geo.service');

/**
 * Public verification — the only route in the system with no login, ever.
 *
 * A customer holding a box of medicine is the last line of defence against a
 * counterfeit, and any friction between them and an answer means they will not
 * check. So: no account, no app, no error codes to interpret. Point a camera at
 * the QR, get a verdict in one page.
 *
 * Three consequences shape everything below.
 *
 * 1. **Never leak the catalogue.** The response says whether *this* serial is
 *    genuine and where it has been. It never reveals how many packs exist, what
 *    other serials look like, who bought anything, or any staff-only field.
 * 2. **An unknown serial is an answer, not an error.** It returns 200 with a
 *    `counterfeit` verdict. A 404 tells a counterfeiter which of their guesses
 *    were closer, and tells a worried customer nothing at all.
 * 3. **Every scan is evidence.** Each call appends a `verified` scan event.
 *    That is simultaneously the customer's history, the regulator's trail, and
 *    the training signal for Phase 6 — a serial scanned in two cities an hour
 *    apart has been cloned, and the only way to know is to have recorded both.
 */

/** Verdicts, worst first. The first one that applies is the one reported. */
const VERDICTS = {
  counterfeit: {
    severity: 'critical',
    headline: 'Not a genuine MedTrace serial',
    message:
      'No pack carries this serial number. Do not take this medicine. Report it to the pharmacy you bought it from.',
  },
  recalled: {
    severity: 'critical',
    headline: 'This batch has been recalled',
    message:
      'The pack is genuine, but its batch was withdrawn by the regulator. Do not take it — return it to your pharmacy.',
  },
  suspect: {
    severity: 'critical',
    headline: 'This pack looks cloned',
    message:
      'The pack is registered, but its scan history is not physically possible for a single box. Treat it as counterfeit and report it.',
  },
  expired: {
    severity: 'warning',
    headline: 'This medicine has expired',
    message: 'The pack is genuine but past its expiry date. Do not take it.',
  },
  dispensed: {
    severity: 'warning',
    headline: 'Already dispensed',
    message:
      'This pack was already handed to a patient. If you have just bought it sealed, report it — the serial may have been copied.',
  },
  genuine: {
    severity: 'ok',
    headline: 'Genuine',
    message: 'This pack is registered, in date, and its journey is complete.',
  },
};

/**
 * Deterministic rules, evaluated on the spot.
 *
 * The Isolation Forest in Phase 6 scores subtler patterns, but it cannot
 * explain itself. "This pack moved 1,400 km in 20 minutes" is an answer a
 * customer, a pharmacist and an examiner all understand immediately, and it
 * costs one query. These stay even after the model lands.
 */
const IMPOSSIBLE_SPEED_KMH = 900; // faster than a commercial airliner
const SCAN_STORM_THRESHOLD = 25; // one box, scanned this often, is a copied label

function evaluateRules({ pack, lastPositioned, position, now }) {
  const warnings = [];

  if (lastPositioned && position) {
    const speed = geo.impliedSpeedKmh(
      { latitude: lastPositioned.latitude, longitude: lastPositioned.longitude, at: lastPositioned.createdAt },
      { latitude: position.latitude, longitude: position.longitude, at: now }
    );
    const km = geo.distanceKm(lastPositioned, position);

    if (speed != null && speed > IMPOSSIBLE_SPEED_KMH && km > 100) {
      warnings.push({
        code: 'impossible_travel',
        severity: 'critical',
        message: `This serial was last seen ${Math.round(km)} km away, too recently for the same box to have travelled here.`,
      });
    }
  }

  if (pack.scanCount >= SCAN_STORM_THRESHOLD) {
    warnings.push({
      code: 'scan_storm',
      severity: 'warning',
      message: `This serial has been verified ${pack.scanCount} times. A single pack is rarely checked this often, which can mean the label was photographed and reprinted.`,
    });
  }

  if (pack.state === 'dispensed') {
    warnings.push({
      code: 'already_dispensed',
      severity: 'warning',
      message: 'This pack was already recorded as dispensed to a patient.',
    });
  }

  return warnings;
}

/** What the public is allowed to see of a pack's journey. */
function publicJourney(events) {
  return events
    .filter((e) => e.type !== 'verified') // customer scans are noise in a custody story
    .map((e) => ({
      at: e.createdAt,
      event: e.type,
      organization: e.organization
        ? { name: e.organization.name, type: e.organization.type, city: e.organization.city }
        : null,
    }));
}

const PACK_INCLUDE = [
  {
    model: Batch,
    as: 'batch',
    include: [
      { model: Medicine, as: 'medicine' },
      { model: Organization, as: 'manufacturer', attributes: ['id', 'name', 'city', 'country'] },
    ],
  },
  { model: Organization, as: 'currentOrganization', attributes: ['id', 'name', 'type', 'city'] },
];

/**
 * Repeat scans of the same serial from the same network inside this window are
 * answered but not recorded twice. Without it, a customer refreshing the page
 * inflates `scan_count` — the very feature the scan-storm rule reads — and the
 * detector learns from an artefact of the UI rather than from the supply chain.
 */
const DEDUPE_WINDOW_MINUTES = 10;

const DEDUPE_RADIUS_KM = 25;

async function isRepeatScan(packId, truncatedIp, position, transaction) {
  if (!truncatedIp) return false;

  const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000);
  const previous = await ScanEvent.findOne({
    where: {
      packId,
      type: 'verified',
      ipAddress: truncatedIp,
      createdAt: { [Op.gte]: since },
    },
    attributes: ['id', 'latitude', 'longitude'],
    order: [['createdAt', 'DESC']],
    transaction,
  });

  if (!previous) return false;

  // A repeat from somewhere else is not a repeat — it is the exact evidence
  // this system exists to capture. Two scans of one serial from the same
  // network but 400 km apart mean either a spoofed position or a cloned pack,
  // and discarding the second event would erase the only trace of it.
  const moved = geo.distanceKm(previous, position);
  if (moved != null && moved > DEDUPE_RADIUS_KM) return false;

  return true;
}

/**
 * The whole endpoint, in one function.
 *
 * @param {string} rawSerial      whatever the camera or the keyboard produced
 * @param {object} scanContext    { position, ipAddress, userAgent }
 */
async function verify(rawSerial, { position = null, ipAddress = null, userAgent = null } = {}) {
  const serial = serialService.normalise(rawSerial);
  const truncatedIp = geo.truncateIp(ipAddress);
  const now = new Date();

  // A malformed serial never reaches the database. The check character in the
  // serial format exists precisely so that a typo — or a randomly guessed code
  // — costs an attacker a round trip and costs us nothing.
  if (!serialService.isWellFormed(serial)) {
    return {
      serial: rawSerial,
      verdict: 'counterfeit',
      ...VERDICTS.counterfeit,
      reason: 'malformed_serial',
      scannedAt: now,
      warnings: [],
    };
  }

  const pack = await Pack.findOne({ where: { serial }, include: PACK_INCLUDE });

  if (!pack) {
    return {
      serial,
      verdict: 'counterfeit',
      ...VERDICTS.counterfeit,
      reason: 'unknown_serial',
      scannedAt: now,
      warnings: [],
    };
  }

  const events = await ScanEvent.findAll({
    where: { packId: pack.id },
    include: [
      { model: Organization, as: 'organization', attributes: ['id', 'name', 'type', 'city'] },
    ],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });

  const lastPositioned = [...events].reverse().find((e) => e.latitude != null) || null;
  const warnings = evaluateRules({ pack, lastPositioned, position, now });

  const recalled = pack.batch.status === 'recalled';
  const expired = pack.batch.isExpired(now);
  const cloned = warnings.some((w) => w.code === 'impossible_travel');

  let verdict = 'genuine';
  if (recalled) verdict = 'recalled';
  else if (cloned) verdict = 'suspect';
  else if (expired) verdict = 'expired';
  else if (pack.state === 'dispensed') verdict = 'dispensed';

  // Record the scan. Wrapped in a transaction with the counter update so a
  // scan can never be counted without also being described.
  const repeat = await isRepeatScan(pack.id, truncatedIp, position);

  if (!repeat) {
    await sequelize.transaction(async (transaction) => {
      await ScanEvent.create(
        {
          packId: pack.id,
          type: 'verified',
          // Null organization and null user are the point: an event with no
          // actor is a member of the public, and the detector treats that
          // differently from a custody movement.
          organizationId: null,
          userId: null,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          ipAddress: truncatedIp,
          userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
          metadata: {
            verdict,
            positionSource: position?.source ?? 'none',
            warnings: warnings.map((w) => w.code),
          },
        },
        // No audit row: a public scan has no acting user, and the scan event
        // *is* the record. Auditing it would duplicate the entire public
        // traffic of the system into a table meant for staff actions.
        { transaction, audit: false }
      );

      await pack.update(
        { scanCount: pack.scanCount + 1, lastScannedAt: now },
        { transaction, audit: false }
      );
    });
  }

  const decorated = VERDICTS[verdict];

  return {
    serial: pack.serial,
    verdict,
    ...decorated,
    scannedAt: now,
    counted: !repeat,
    medicine: {
      name: pack.batch.medicine.name,
      genericName: pack.batch.medicine.genericName,
      strength: pack.batch.medicine.strength,
      form: pack.batch.medicine.form,
      packSize: pack.batch.medicine.packSize,
      manufacturer: pack.batch.manufacturer.name,
      manufacturerCity: pack.batch.manufacturer.city,
    },
    batch: {
      batchNo: pack.batch.batchNo,
      manufacturedOn: pack.batch.manufacturedOn,
      expiresOn: pack.batch.expiresOn,
      recalled,
      recalledAt: recalled ? pack.batch.recalledAt : null,
      recallReason: recalled ? pack.batch.recallReason : null,
      expired,
    },
    pack: {
      state: pack.state,
      currentHolder: pack.currentOrganization
        ? { name: pack.currentOrganization.name, type: pack.currentOrganization.type, city: pack.currentOrganization.city }
        : null,
      dispensedAt: pack.dispensedAt,
      timesVerified: pack.scanCount + (repeat ? 0 : 1),
    },
    warnings,
    journey: publicJourney(events),
  };
}

module.exports = {
  verify,
  VERDICTS,
  IMPOSSIBLE_SPEED_KMH,
  SCAN_STORM_THRESHOLD,
  DEDUPE_WINDOW_MINUTES,
  DEDUPE_RADIUS_KM,
  evaluateRules,
};
