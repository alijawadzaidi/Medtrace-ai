'use strict';

const crypto = require('node:crypto');

/**
 * Serial format:  MT-<BATCH>-<RANDOM><CHECK>
 * e.g.            MT-7K2M9P-XQ4T8HRW2VNB
 *
 * Design constraints, in order of importance:
 *
 * 1. Unguessable. A sequential serial would let anyone enumerate the whole
 *    catalogue and print valid-looking labels, which defeats the entire point
 *    of per-pack serialization. 12 random Crockford characters give ~60 bits.
 * 2. Unambiguous when read by a human off a damaged label. Crockford base32
 *    omits I, L, O and U, so there is no 1/I or 0/O confusion.
 * 3. Self-checking. A trailing check character rejects most typos before the
 *    database is ever touched.
 */

// Crockford base32: digits plus letters, minus I, L, O, U.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LENGTH = 12;
const BATCH_CODE_LENGTH = 6;

/** Normalises the characters a human is most likely to mistype. */
function normalise(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z-]/g, '')
    .replace(/I|L/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

/** Rejection sampling keeps every character uniformly distributed. */
function randomChars(length) {
  const out = [];
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte < 248) {
        // 248 = 8 * 32, the largest multiple of 32 below 256
        out.push(ALPHABET[byte % 32]);
        if (out.length === length) break;
      }
    }
  }
  return out.join('');
}

/** Single character derived from the payload; catches most single-character typos. */
function checkChar(payload) {
  const digest = crypto.createHash('sha256').update(payload).digest();
  return ALPHABET[digest[0] % 32];
}

function generateBatchCode() {
  return randomChars(BATCH_CODE_LENGTH);
}

function generateSerial(batchCode) {
  const body = `MT-${batchCode}-${randomChars(RANDOM_LENGTH)}`;
  return body + checkChar(body);
}

/** Generates `count` distinct serials for one batch. */
function generateSerials(batchCode, count) {
  const serials = new Set();
  // Collision at 60 bits is vanishingly unlikely, but a set costs nothing.
  while (serials.size < count) serials.add(generateSerial(batchCode));
  return [...serials];
}

/** Structural validation only — says nothing about whether the pack exists. */
function isWellFormed(serial) {
  const value = normalise(serial);
  const pattern = new RegExp(
    `^MT-[0-9A-Z]{${BATCH_CODE_LENGTH}}-[0-9A-Z]{${RANDOM_LENGTH}}[0-9A-Z]$`
  );
  if (!pattern.test(value)) return false;
  return checkChar(value.slice(0, -1)) === value.slice(-1);
}

module.exports = {
  ALPHABET,
  generateBatchCode,
  generateSerial,
  generateSerials,
  isWellFormed,
  normalise,
};
