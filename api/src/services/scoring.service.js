'use strict';

const features = require('./features.service');
const env = require('../config/env');

/**
 * The client for the Python scoring service.
 *
 * The whole reason the scorer is stateless — it receives features and returns
 * a number, and never touches the database — is this function's error path. If
 * the model is down, unreachable, or slow, verification still returns a valid
 * or invalid verdict and custody still works. Only the risk score is missing.
 * A dead AI service must not be able to take the demo, or a pharmacy, down.
 *
 * That is also why the timeout is short. A scorer that takes four seconds is a
 * scorer that is broken, and waiting for it would turn one sick service into a
 * queue of stalled requests across the whole API.
 */
const SCORER_URL = env.aiServiceUrl;
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 1500);

/** Remembered so a long outage does not cost a timeout on every single call. */
let lastFailureAt = 0;
const COOLDOWN_MS = 30_000;

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${SCORER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Scorer returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isCoolingDown() {
  return Date.now() - lastFailureAt < COOLDOWN_MS;
}

/**
 * Scores a batch of feature vectors.
 *
 * Returns `null` — never throws, never a fabricated score — when the scorer
 * cannot be reached. "No risk score available" is an honest answer; a made-up
 * 0.5 is not, and would end up in an alert a regulator acts on.
 */
async function scoreMany(vectors) {
  if (!vectors.length) return [];
  if (isCoolingDown()) return vectors.map(() => null);

  try {
    const payload = {
      feature_version: features.FEATURE_VERSION,
      // Named objects, not positional arrays: see features.service.
      items: vectors.map((v) => {
        const named = {};
        for (const name of features.FEATURE_ORDER) named[name] = v[name];
        return named;
      }),
    };

    const result = await post('/score', payload);
    lastFailureAt = 0;

    return result.scores.map((entry) => ({
      score: entry.score,
      isAnomaly: entry.is_anomaly,
      contributions: entry.contributions || null,
      modelVersion: result.model_version || null,
    }));
  } catch {
    lastFailureAt = Date.now();
    return vectors.map(() => null);
  }
}

async function health() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(`${SCORER_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { available: false, url: SCORER_URL };
    return { available: true, url: SCORER_URL, ...(await response.json()) };
  } catch {
    return { available: false, url: SCORER_URL };
  }
}

module.exports = { scoreMany, health, SCORER_URL };
