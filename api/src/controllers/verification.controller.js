'use strict';

const verificationService = require('../services/verification.service');
const qrService = require('../services/qr.service');
const serialService = require('../services/serial.service');
const geo = require('../services/geo.service');
const ApiError = require('../utils/ApiError');

/**
 * Builds the scan context from the request. Kept out of the service so the
 * service stays testable without an Express request, and so Phase 6's
 * simulator can call `verify()` directly with synthetic positions.
 */
function scanContextFrom(req, body = {}) {
  return {
    position: geo.resolve(req, body),
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

/**
 * GET /verify/:serial — what a phone camera lands on.
 *
 * The QR encodes a URL, so the customer arrives here with no app and no
 * account. Position, if any, comes from CDN headers on this path; the browser
 * asks for permission and re-submits through POST /verify below.
 */
async function verifyBySerial(req, res) {
  const result = await verificationService.verify(req.params.serial, scanContextFrom(req));

  // Never cached. Two scans of the same serial are supposed to be two events —
  // caching this response would erase exactly the signal the detector needs.
  res.set('Cache-Control', 'no-store');
  res.json(result);
}

/** POST /verify — the same check, with browser-granted coordinates attached. */
async function verifyWithPosition(req, res) {
  const { serial, ...position } = req.body;
  const result = await verificationService.verify(serial, scanContextFrom(req, position));

  res.set('Cache-Control', 'no-store');
  res.json(result);
}

/**
 * The QR image for a serial, unauthenticated.
 *
 * Public on purpose: the code is printed on the box, so it is not a secret,
 * and a pharmacist reprinting a smudged label should not need an account.
 */
async function qrImage(req, res) {
  // Structural check first: without it this endpoint would render a QR code
  // for any string a caller invents, which is a free forgery service.
  const serial = serialService.normalise(req.params.serial);
  if (!serialService.isWellFormed(serial)) {
    throw ApiError.badRequest('That is not a valid MedTrace serial number');
  }

  const png = await qrService.toPngBuffer(serial, {
    width: Math.min(Math.max(Number(req.query.width) || 320, 64), 1024),
  });

  res.type('png');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(png);
}

module.exports = { verifyBySerial, verifyWithPosition, qrImage };
