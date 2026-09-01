'use strict';

/**
 * A seeded random number generator.
 *
 * `Math.random()` would make every run of the simulator produce a different
 * dataset, which means the metrics in the report describe a dataset nobody can
 * regenerate — the single most common way an evaluation becomes unfalsifiable.
 * With a seed, `--seed 20260901` reproduces the exact packs, journeys and
 * fraud injections that produced the numbers being reported.
 *
 * mulberry32: small, fast, and good enough for generating plausible traffic.
 * It is not a cryptographic generator and nothing here needs one — the serials
 * themselves are minted by the API's own crypto-backed generator.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRandom(seed) {
  const next = mulberry32(seed);

  return {
    next,
    /** Uniform float in [min, max). */
    between: (min, max) => min + next() * (max - min),
    /** Uniform integer in [min, max]. */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    /** True with probability p. */
    chance: (p) => next() < p,
    /**
     * Box-Muller normal. Journey timings are not uniform in reality — most
     * shipments take about the usual time and a few take much longer — and a
     * generator that ignores that produces traffic no detector could ever
     * mistake for real.
     */
    normal: (mean, stdDev) => {
      const u = Math.max(next(), Number.EPSILON);
      const v = next();
      return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

module.exports = { createRandom };
