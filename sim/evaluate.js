'use strict';

/**
 * Measures the system that actually ships.
 *
 * `ai/train.py` reports how the model performs in isolation, which is the
 * right number for the model and the wrong number for the product: what runs
 * in production is the deterministic rules *and* the model, writing into one
 * alert table. This script runs that whole pipeline over the simulated packs
 * and compares the alerts it produced against the labels the generator wrote.
 *
 * It reports three columns on purpose — rules alone, model alone, and both
 * together — because the interesting result is not any single score. It is
 * that the two find different frauds, and that the ones the model misses are
 * exactly the ones a rule can state in a sentence.
 *
 * Usage: node sim/evaluate.js [--out sim/evaluation.json]
 */

const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..', 'api'));

const { sequelize, Pack, Alert } = require('../api/src/models');
const detection = require('../api/src/services/detection.service');
const scoring = require('../api/src/services/scoring.service');

const RULE_NAMES = new Set([
  'impossible_travel',
  'dispensed_elsewhere',
  'custody_skip',
  'expired_stock',
  'recalled_in_circulation',
  'scan_storm',
]);

function score(predicted, actual) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const serial of actual.keys()) {
    const isFraud = actual.get(serial) !== 'honest';
    const flagged = predicted.has(serial);
    if (flagged && isFraud) tp += 1;
    else if (flagged && !isFraud) fp += 1;
    else if (!flagged && isFraud) fn += 1;
    else tn += 1;
  }

  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  };
}

function perPattern(predicted, actual) {
  const out = {};
  for (const [serial, label] of actual) {
    if (label === 'honest') continue;
    if (!out[label]) out[label] = { total: 0, detected: 0 };
    out[label].total += 1;
    if (predicted.has(serial)) out[label].detected += 1;
  }
  for (const stats of Object.values(out)) {
    stats.recall = Number((stats.detected / stats.total).toFixed(4));
  }
  return out;
}

function table(rows) {
  const header = ['', 'precision', 'recall', 'f1', 'TP', 'FP', 'FN'];
  const lines = [header.map((h, i) => (i ? h.padStart(10) : h.padEnd(10))).join('')];
  for (const [name, m] of Object.entries(rows)) {
    lines.push(
      [
        name.padEnd(10),
        m.precision.toFixed(3).padStart(10),
        m.recall.toFixed(3).padStart(10),
        m.f1.toFixed(3).padStart(10),
        String(m.truePositives).padStart(10),
        String(m.falsePositives).padStart(10),
        String(m.falseNegatives).padStart(10),
      ].join('')
    );
  }
  return lines.join('\n');
}

async function main() {
  const outFlagIndex = process.argv.indexOf('--out');
  const outPath =
    outFlagIndex > -1
      ? path.resolve(process.argv[outFlagIndex + 1])
      : path.join(__dirname, '..', 'sim', 'evaluation.json');

  const manifestPath = path.join(__dirname, '..', 'sim', 'labels.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('No sim/labels.json — run `node sim/generate.js` first.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const actual = new Map(manifest.labels.map((l) => [l.serial, l.label]));

  const health = await scoring.health();
  console.log(
    health.available
      ? `Scorer: ${health.model} (trained on ${health.trained_on} packs)`
      : 'Scorer: UNAVAILABLE — evaluating the rules alone. Start it with:\n  ai/.venv/bin/uvicorn app.main:app --app-dir ai --port 8000'
  );

  const packs = await Pack.findAll({
    where: { serial: [...actual.keys()] },
    attributes: ['id', 'serial'],
  });
  const serialById = new Map(packs.map((p) => [p.id, p.serial]));

  // Clear previous alerts on these packs so a re-run measures this run rather
  // than an accumulation of every run before it.
  await Alert.destroy({ where: { packId: packs.map((p) => p.id) } });

  console.log(`Scoring ${packs.length} packs…`);
  const started = Date.now();
  const result = await detection.evaluatePacks(packs.map((p) => p.id));
  console.log(`  ${result.evaluated} packs, ${result.created} alerts, ${Date.now() - started} ms\n`);

  const alerts = await Alert.findAll({ where: { packId: packs.map((p) => p.id) } });

  const byRules = new Set();
  const byModel = new Set();
  for (const alert of alerts) {
    const serial = serialById.get(alert.packId);
    if (!serial) continue;
    if (RULE_NAMES.has(alert.rule)) byRules.add(serial);
    if (alert.rule === 'anomaly_score') byModel.add(serial);
  }
  const combined = new Set([...byRules, ...byModel]);

  const metrics = {
    rules: score(byRules, actual),
    model: score(byModel, actual),
    combined: score(combined, actual),
  };

  console.log(table(metrics));
  console.log('\nRecall by fraud pattern:');
  const patterns = {
    rules: perPattern(byRules, actual),
    model: perPattern(byModel, actual),
    combined: perPattern(combined, actual),
  };

  const names = Object.keys(patterns.combined).sort();
  console.log(`  ${'pattern'.padEnd(24)}${'rules'.padStart(8)}${'model'.padStart(8)}${'both'.padStart(8)}`);
  for (const name of names) {
    console.log(
      `  ${name.padEnd(24)}${(patterns.rules[name]?.recall ?? 0).toFixed(2).padStart(8)}` +
        `${(patterns.model[name]?.recall ?? 0).toFixed(2).padStart(8)}` +
        `${(patterns.combined[name]?.recall ?? 0).toFixed(2).padStart(8)}`
    );
  }

  const alertsByRule = alerts.reduce((acc, a) => ({ ...acc, [a.rule]: (acc[a.rule] || 0) + 1 }), {});
  console.log('\nAlerts raised, by rule:');
  for (const [rule, count] of Object.entries(alertsByRule).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule.padEnd(26)} ${count}`);
  }

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        seed: manifest.seed,
        packs: packs.length,
        scorer: health.available ? health.model : 'unavailable',
        metrics,
        perPattern: patterns,
        alertsByRule,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\nWritten to ${outPath}`);

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
