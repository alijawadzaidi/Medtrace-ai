'use strict';

/**
 * Turns the simulated database into the CSV the model trains on.
 *
 * The features are computed by the API's own `features.service`, not
 * reimplemented here. That is the whole point: the vector the model is trained
 * on and the vector it is scored with at runtime come from the same code, so
 * they cannot drift apart. A separate training-time implementation is the
 * classic way a model that evaluated beautifully performs badly in production.
 *
 * Labels come from `sim/labels.json`, written by the generator at the moment
 * it injected each fraud. Deriving them by re-reading the data with the same
 * rules the detector uses would be circular.
 *
 * Usage: node sim/export-features.js [--out ai/data/features.csv] [--all]
 */

const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..', 'api'));

const { sequelize, Pack } = require('../api/src/models');
const features = require('../api/src/services/features.service');

const REPO_ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = { out: path.join(REPO_ROOT, 'ai', 'data', 'features.csv'), all: false };
  for (let i = 2; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    if (flag === '--out') {
      args.out = path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
      if (inline === undefined) i += 1;
    }
    if (flag === '--all') args.all = true;
  }
  return args;
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join('\n').replace(/\n/g, ',')),
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);

  const manifestPath = path.join(__dirname, 'labels.json');
  if (!fs.existsSync(manifestPath) && !args.all) {
    throw new Error('No sim/labels.json — run `node sim/generate.js` first, or pass --all.');
  }

  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { labels: [] };
  const labelBySerial = new Map(manifest.labels.map((l) => [l.serial, l.label]));

  const where = args.all ? {} : { serial: [...labelBySerial.keys()] };
  const packs = await Pack.findAll({ where, attributes: ['id', 'serial'] });
  if (!packs.length) throw new Error('No packs to export.');

  console.log(`Computing features for ${packs.length} packs…`);
  const vectors = await features.computeForPacks(packs.map((p) => p.id));

  const rows = vectors.map((vector) => {
    const label = labelBySerial.get(vector._pack.serial) ?? 'unlabelled';
    return {
      serial: vector._pack.serial,
      ...Object.fromEntries(features.FEATURE_ORDER.map((name) => [name, vector[name]])),
      label,
      // The binary target the metrics are computed against. The pattern name
      // is kept alongside so the report can break precision down per pattern
      // rather than reporting one number that hides which frauds were missed.
      is_fraud: label === 'honest' || label === 'unlabelled' ? 0 : 1,
    };
  });

  const columns = ['serial', ...features.FEATURE_ORDER, 'label', 'is_fraud'];
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${toCsv(rows, columns)}\n`);

  const fraud = rows.filter((r) => r.is_fraud).length;
  console.log(`Wrote ${rows.length} rows (${fraud} fraudulent, ${rows.length - fraud} honest)`);
  console.log(`  ${args.out}`);
  console.log(`  feature version ${features.FEATURE_VERSION}: ${features.FEATURE_ORDER.join(', ')}`);

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
