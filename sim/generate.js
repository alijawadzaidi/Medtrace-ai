'use strict';

/**
 * The supply-chain simulator.
 *
 * There is no public dataset of counterfeit medicine movements, so the model
 * has to be trained on data generated here. Every examiner will ask about
 * that, and the honest answer is the strong one: **the simulator is a
 * deliverable**. It is a documented generator that produces realistic honest
 * traffic plus five named fraud patterns, with a labelled hold-out set the
 * model is evaluated against. That turns "we made up the data" into "we built
 * a controlled testbed and reported precision and recall on it".
 *
 * Two properties make the evaluation defensible:
 *
 * - **It is seeded.** `--seed 20260901` reproduces the exact dataset that
 *   produced the numbers in the report. Without that, the metrics describe a
 *   dataset nobody can regenerate.
 * - **The labels are written by the generator, not inferred afterwards.** A
 *   pack is fraudulent because this file made it so, and `sim/labels.json`
 *   records which pattern was injected into which serial. Labelling by
 *   re-reading the data with the same rules the detector uses would be
 *   circular and would guarantee a perfect score.
 *
 * Usage:
 *   node sim/generate.js --packs 800 --fraud-rate 0.08 --seed 20260901 --reset
 */

const fs = require('fs');
const path = require('path');

// The API resolves its SQLite file and its .env relative to the working
// directory, so the simulator adopts the API's directory before loading any of
// it. Without this, running `node sim/generate.js` from the repo root silently
// creates a second, empty database beside this file and reports that the
// organizations table does not exist.
process.chdir(path.join(__dirname, '..', 'api'));

const { sequelize, Organization, Medicine, Pack, Batch } = require('../api/src/models');
const serialService = require('../api/src/services/serial.service');
const { createRandom } = require('./lib/random');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * The five fraud patterns, named so the report and the confusion matrix agree.
 * Each is a real counterfeiting or diversion behaviour, not an arbitrary
 * perturbation of the numbers — the detector has to find the *behaviour*.
 */
const FRAUD_PATTERNS = {
  cloned_serial:
    'One serial, two places. A photographed label is reprinted and sold elsewhere, so the same code is verified in two cities within hours.',
  mass_cloning:
    'One label copied onto a whole production run of fakes: dozens of verifications of a single serial, spread across many regions in days.',
  custody_skip:
    'Stock that appears at a pharmacy having never left the distributor. Typical of goods injected into the chain mid-route.',
  expired_relabel:
    'Expired stock re-entering circulation, moving and being sold after its expiry date.',
  grey_market_diversion:
    'A pack that sits far longer than usual, then surfaces in a region it was never shipped to.',
};

function parseArgs(argv) {
  const args = { packs: 800, fraudRate: 0.08, seed: 20260901, batches: 8, reset: false };
  for (let i = 2; i < argv.length; i += 1) {
    const [flag, inlineValue] = argv[i].split('=');
    const value = inlineValue ?? argv[i + 1];
    const consume = () => {
      if (inlineValue === undefined) i += 1;
    };

    switch (flag) {
      case '--packs': args.packs = Number(value); consume(); break;
      case '--fraud-rate': args.fraudRate = Number(value); consume(); break;
      case '--seed': args.seed = Number(value); consume(); break;
      case '--batches': args.batches = Number(value); consume(); break;
      case '--reset': args.reset = true; break;
      case '--help':
        console.log('node sim/generate.js [--packs N] [--fraud-rate 0.08] [--seed N] [--batches N] [--reset]');
        process.exit(0);
        break;
      default: break;
    }
  }
  return args;
}

/** Coordinates with a little scatter, so every scan in a city is not one point. */
function jitter(random, org, km = 8) {
  const degrees = km / 111;
  return {
    latitude: Number(org.latitude) + random.between(-degrees, degrees),
    longitude: Number(org.longitude) + random.between(-degrees, degrees),
  };
}

/** Somewhere else entirely — used by the patterns that need distance. */
function distantPoint(random, from, minKm = 600, maxKm = 1600) {
  const distance = random.between(minKm, maxKm) / 111;
  const bearing = random.between(0, 2 * Math.PI);
  return {
    latitude: Number(from.latitude) + distance * Math.cos(bearing),
    longitude: Number(from.longitude) + distance * Math.sin(bearing),
  };
}

function event({ type, at, org = null, position = null, metadata = null }) {
  return {
    type,
    created_at: new Date(at),
    organization_id: org ? org.id : null,
    user_id: null,
    shipment_id: null,
    latitude: position ? position.latitude : org ? Number(org.latitude) : null,
    longitude: position ? position.longitude : org ? Number(org.longitude) : null,
    ip_address: type === 'verified' ? '203.0.113.0/24' : null,
    user_agent: null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  };
}

/**
 * An honest pack's life: made, shipped through one or two distributors,
 * received by a pharmacy, occasionally scanned by the customer who bought it,
 * sometimes dispensed. Timings are drawn from normal distributions, because
 * real shipments cluster around a usual duration with a long tail — uniform
 * timings produce traffic no detector could mistake for real.
 */
function honestJourney(random, { batch, chain, bornAt }) {
  const { maker, distributors, pharmacy } = chain;
  const events = [];
  let at = bornAt;
  let holder = maker;

  events.push(event({ type: 'created', at, org: maker }));

  for (const distributor of distributors) {
    at += Math.max(0.5, random.normal(3, 1.5)) * DAY;
    events.push(event({ type: 'dispatched', at, org: holder }));

    at += Math.max(0.5, random.normal(2, 1)) * DAY;
    events.push(event({ type: 'received', at, org: distributor }));
    holder = distributor;
  }

  at += Math.max(1, random.normal(12, 6)) * DAY;
  events.push(event({ type: 'dispatched', at, org: holder }));

  at += Math.max(0.5, random.normal(2, 1)) * DAY;
  events.push(event({ type: 'received', at, org: pharmacy }));
  holder = pharmacy;

  // Customer verifications: most packs are never checked, a few are checked
  // once, a handful two or three times. The long tail matters — it is what
  // stops "scanned at all" from being a fraud signal on its own.
  const scans = random.chance(0.55) ? 0 : random.chance(0.75) ? 1 : random.int(2, 3);
  let scanAt = at;
  for (let i = 0; i < scans; i += 1) {
    scanAt += Math.max(0.2, random.normal(4, 3)) * DAY;
    events.push({
      ...event({ type: 'verified', at: scanAt, position: jitter(random, pharmacy, 12) }),
      organization_id: null,
    });
  }

  let state = 'received';
  let dispensedAt = null;
  if (random.chance(0.45)) {
    at = Math.max(at, scanAt) + Math.max(0.5, random.normal(6, 4)) * DAY;
    if (at < Date.now() && new Date(batch.expiresOn) > new Date(at)) {
      events.push(event({ type: 'dispensed', at, org: pharmacy }));
      state = 'dispensed';
      dispensedAt = new Date(at);
    }
  }

  return { events, holder, state, dispensedAt };
}

/** Each pattern takes an honest journey and does something dishonest to it. */
const INJECT = {
  cloned_serial(random, journey, { chain }) {
    const lastScan = [...journey.events].reverse().find((e) => e.type === 'verified');
    const anchor = lastScan || journey.events[journey.events.length - 1];
    const at = new Date(anchor.created_at).getTime() + random.between(0.5, 6) * HOUR;

    journey.events.push({
      ...event({
        type: 'verified',
        at,
        position: distantPoint(random, chain.pharmacy, 700, 1800),
      }),
      organization_id: null,
    });
    return journey;
  },

  mass_cloning(random, journey, { chain }) {
    const start = new Date(journey.events[journey.events.length - 1].created_at).getTime();
    const count = random.int(18, 45);

    for (let i = 0; i < count; i += 1) {
      const at = start + random.between(0, 4) * DAY;
      const somewhere = random.chance(0.5)
        ? jitter(random, chain.pharmacy, 40)
        : distantPoint(random, chain.pharmacy, 200, 2000);
      journey.events.push({ ...event({ type: 'verified', at, position: somewhere }), organization_id: null });
    }
    return journey;
  },

  custody_skip(random, journey) {
    // Remove the dispatch that should precede the pharmacy's receipt: the pack
    // arrives somewhere nobody sent it.
    const index = journey.events.map((e) => e.type).lastIndexOf('dispatched');
    if (index >= 0) journey.events.splice(index, 1);
    return journey;
  },

  expired_relabel(random, journey, { batch, chain }) {
    // Everything happens after the batch expired: the stock is repackaged and
    // pushed back into the chain.
    const expiry = new Date(batch.expiresOn).getTime();
    let at = expiry + random.between(5, 60) * DAY;

    journey.events.push(event({ type: 'dispatched', at, org: chain.pharmacy }));
    at += random.between(1, 4) * DAY;
    journey.events.push(event({ type: 'received', at, org: chain.pharmacy }));

    at += random.between(1, 10) * DAY;
    journey.events.push({
      ...event({ type: 'verified', at, position: jitter(random, chain.pharmacy, 15) }),
      organization_id: null,
    });

    journey.state = 'received';
    journey.dispensedAt = null;
    return journey;
  },

  grey_market_diversion(random, journey, { chain }) {
    // A long stall, then the pack surfaces somewhere it was never shipped.
    const last = new Date(journey.events[journey.events.length - 1].created_at).getTime();
    const surfaceAt = last + random.between(60, 200) * DAY;
    const elsewhere = distantPoint(random, chain.pharmacy, 500, 1500);

    journey.events.push(event({ type: 'dispatched', at: surfaceAt, org: chain.pharmacy }));
    journey.events.push({
      ...event({ type: 'received', at: surfaceAt + random.between(2, 8) * DAY, org: chain.pharmacy }),
      latitude: elsewhere.latitude,
      longitude: elsewhere.longitude,
    });

    for (let i = 0; i < random.int(2, 5); i += 1) {
      journey.events.push({
        ...event({
          type: 'verified',
          at: surfaceAt + random.between(10, 60) * DAY,
          position: { latitude: elsewhere.latitude + random.between(-0.3, 0.3), longitude: elsewhere.longitude + random.between(-0.3, 0.3) },
        }),
        organization_id: null,
      });
    }

    journey.state = 'received';
    journey.dispensedAt = null;
    return journey;
  },
};

async function main() {
  const args = parseArgs(process.argv);
  const random = createRandom(args.seed);

  const organizations = await Organization.findAll();
  const makers = organizations.filter((o) => o.type === 'manufacturer');
  const distributors = organizations.filter((o) => o.type === 'distributor');
  const pharmacies = organizations.filter((o) => o.type === 'pharmacy');
  const medicines = await Medicine.findAll();

  if (!makers.length || !distributors.length || !pharmacies.length || !medicines.length) {
    throw new Error('Run the API seeders first: cd api && npm run db:reset');
  }

  const queryInterface = sequelize.getQueryInterface();

  if (args.reset) {
    const existing = await Batch.findAll({ where: { batchNo: { [sequelize.Sequelize.Op.like]: 'SIM-%' } } });
    if (existing.length) {
      const batchIds = existing.map((b) => b.id);
      const packs = await Pack.findAll({ where: { batchId: batchIds }, attributes: ['id'] });
      const packIds = packs.map((p) => p.id);
      if (packIds.length) {
        await queryInterface.bulkDelete('alerts', { pack_id: packIds });
        await queryInterface.bulkDelete('scan_events', { pack_id: packIds });
      }
      await queryInterface.bulkDelete('packs', { batch_id: batchIds });
      await queryInterface.bulkDelete('batches', { id: batchIds });
      console.log(`Removed ${existing.length} previous simulated batches (${packIds.length} packs).`);
    }
  }

  const packsPerBatch = Math.max(10, Math.ceil(args.packs / args.batches));
  const now = Date.now();

  const batchRows = [];
  const batchPlans = [];

  for (let i = 0; i < args.batches; i += 1) {
    const medicine = random.pick(medicines);
    const maker = random.pick(makers);
    // One batch in six is already past its expiry date — the population the
    // expired-stock pattern has to hide in.
    const expired = random.chance(0.17);
    const madeDaysAgo = random.int(120, 400);
    const expiresInDays = expired ? -random.int(10, 120) : random.int(120, 900);

    const batchCode = serialService.generateBatchCode();
    batchRows.push({
      medicine_id: medicine.id,
      manufacturer_id: maker.id,
      batch_no: `SIM-${args.seed}-${String(i + 1).padStart(3, '0')}`,
      batch_code: batchCode,
      manufactured_on: new Date(now - madeDaysAgo * DAY).toISOString().slice(0, 10),
      expires_on: new Date(now + expiresInDays * DAY).toISOString().slice(0, 10),
      quantity: packsPerBatch,
      status: 'active',
      recalled_at: null,
      recall_reason: null,
      created_at: new Date(now - madeDaysAgo * DAY),
      updated_at: new Date(now - madeDaysAgo * DAY),
    });

    batchPlans.push({ batchCode, maker, madeDaysAgo, packsPerBatch });
  }

  await queryInterface.bulkInsert('batches', batchRows);
  const batches = await Batch.findAll({
    where: { batchNo: { [sequelize.Sequelize.Op.like]: `SIM-${args.seed}-%` } },
  });
  console.log(`Created ${batches.length} batches.`);

  const packRows = [];
  const journeys = [];
  const labels = [];

  for (const batch of batches) {
    const plan = batchPlans.find((p) => p.batchCode === batch.batchCode);
    const serials = serialService.generateSerials(batch.batchCode, plan.packsPerBatch);

    for (const serial of serials) {
      const chain = {
        maker: plan.maker,
        distributors: random.chance(0.25)
          ? random.shuffle(distributors).slice(0, 2)
          : [random.pick(distributors)],
        pharmacy: random.pick(pharmacies),
      };

      const bornAt = now - plan.madeDaysAgo * DAY + random.between(0, 2) * DAY;
      let journey = honestJourney(random, { batch, chain, bornAt });

      let label = 'honest';
      if (random.chance(args.fraudRate)) {
        label = random.pick(Object.keys(FRAUD_PATTERNS));
        journey = INJECT[label](random, journey, { batch, chain });
      }

      journey.events.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      packRows.push({
        batch_id: batch.id,
        serial,
        current_organization_id: journey.holder.id,
        state: journey.state,
        dispensed_at: journey.dispensedAt,
        scan_count: journey.events.filter((e) => e.type === 'verified').length,
        last_scanned_at:
          [...journey.events].reverse().find((e) => e.type === 'verified')?.created_at ?? null,
        created_at: new Date(bornAt),
        updated_at: new Date(),
      });

      journeys.push({ serial, events: journey.events });
      labels.push({ serial, batchNo: batch.batchNo, label });
    }
  }

  await queryInterface.bulkInsert('packs', packRows);
  console.log(`Created ${packRows.length} packs.`);

  const packs = await Pack.findAll({
    where: { serial: journeys.map((j) => j.serial) },
    attributes: ['id', 'serial'],
  });
  const idBySerial = new Map(packs.map((p) => [p.serial, p.id]));

  const eventRows = [];
  for (const journey of journeys) {
    const packId = idBySerial.get(journey.serial);
    for (const e of journey.events) eventRows.push({ pack_id: packId, ...e });
  }

  // Chunked: a single insert of a hundred thousand rows exceeds SQLite's
  // variable limit and MySQL's max_allowed_packet.
  const CHUNK = 2000;
  for (let i = 0; i < eventRows.length; i += CHUNK) {
    await queryInterface.bulkInsert('scan_events', eventRows.slice(i, i + CHUNK));
  }
  console.log(`Created ${eventRows.length} scan events.`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    seed: args.seed,
    packs: labels.length,
    fraudRate: args.fraudRate,
    patterns: FRAUD_PATTERNS,
    counts: labels.reduce((acc, l) => ({ ...acc, [l.label]: (acc[l.label] || 0) + 1 }), {}),
    labels,
  };

  const out = path.join(__dirname, 'labels.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));

  console.log('\nLabel counts:');
  for (const [label, count] of Object.entries(manifest.counts)) {
    console.log(`  ${label.padEnd(24)} ${count}`);
  }
  console.log(`\nLabels written to ${out}`);

  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
