'use strict';

const QRCode = require('qrcode');

/**
 * QR payload design.
 *
 * The code encodes a verification URL, not raw JSON. Two reasons:
 *
 * 1. Any phone camera opens it. A customer does not install an app, does not
 *    know what MedTrace is, and will not paste a JSON blob anywhere. Pointing
 *    a camera at the box and getting a web page is the whole user experience.
 * 2. The serial is the only secret worth carrying. Encoding batch details in
 *    the QR would let a counterfeiter fabricate plausible labels offline;
 *    keeping everything server-side means a fake code fails on lookup.
 *
 * Phase 8 (optional) appends an HMAC signature to this URL so a forged serial
 * fails before the database is touched. The shape below leaves room for it.
 */
const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:3000/v';

function payloadFor(serial) {
  return `${VERIFY_BASE_URL.replace(/\/$/, '')}/${serial}`;
}

/**
 * Error correction level M tolerates ~15% damage. Pharmaceutical labels get
 * creased, wet and rubbed; L would be smaller but fails on a scuffed box.
 */
const DEFAULT_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 1,
};

async function toPngBuffer(serial, { width = 320 } = {}) {
  return QRCode.toBuffer(payloadFor(serial), { ...DEFAULT_OPTIONS, type: 'png', width });
}

async function toSvgString(serial, { width = 160 } = {}) {
  return QRCode.toString(payloadFor(serial), { ...DEFAULT_OPTIONS, type: 'svg', width });
}

async function toDataUrl(serial, { width = 320 } = {}) {
  return QRCode.toDataURL(payloadFor(serial), { ...DEFAULT_OPTIONS, width });
}

module.exports = { payloadFor, toPngBuffer, toSvgString, toDataUrl, VERIFY_BASE_URL };
