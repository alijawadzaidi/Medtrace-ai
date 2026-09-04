'use strict';

const request = require('supertest');

const app = require('../../src/app');
const db = require('../../src/models');

/**
 * Tests build their own world rather than leaning on the demo seeders.
 *
 * The seeders exist to make the app demonstrable, and they will change as the
 * demo changes. A test that fails because someone renamed a demo pharmacy is
 * noise, and a test that passes only because a seeder happened to create the
 * right shape is worse.
 */
const PASSWORD = 'TestPass#2026';

/** Far apart on purpose: the travel-speed rules need real distance. */
const CITIES = {
  mumbai: { city: 'Mumbai', latitude: 19.076, longitude: 72.8777 },
  delhi: { city: 'Delhi', latitude: 28.6139, longitude: 77.209 },
  bengaluru: { city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 },
};

let counter = 0;
const unique = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

async function createOrganization(type, place = CITIES.mumbai) {
  return db.Organization.create({
    name: `${type} ${unique('org')}`,
    type,
    licenseNo: unique(`LIC-${type.slice(0, 3).toUpperCase()}`),
    ...place,
  });
}

async function createUser(organization, role = organization.type) {
  const email = `${unique('user')}@example.test`;
  const user = await db.User.create({
    organizationId: organization.id,
    fullName: `Test ${role}`,
    email,
    // The model's beforeSave hook hashes whatever is put in `passwordHash`,
    // so the plaintext goes in here and never reaches the database.
    passwordHash: PASSWORD,
    role,
  });
  return { user, email, password: PASSWORD };
}

async function tokenFor(credentials) {
  const response = await request(app)
    .post('/auth/login')
    .send({ email: credentials.email, password: credentials.password });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${credentials.email}: ${JSON.stringify(response.body)}`);
  }
  return response.body.token;
}

/** A complete supply chain plus a signed-in user for each role. */
async function createWorld() {
  const maker = await createOrganization('manufacturer', CITIES.mumbai);
  const distributor = await createOrganization('distributor', CITIES.delhi);
  const pharmacy = await createOrganization('pharmacy', CITIES.delhi);
  const other = await createOrganization('pharmacy', CITIES.bengaluru);
  const authority = await createOrganization('regulator', CITIES.delhi);

  const credentials = {
    maker: await createUser(maker),
    distributor: await createUser(distributor),
    pharmacy: await createUser(pharmacy),
    other: await createUser(other),
    regulator: await createUser(authority),
  };

  const tokens = {};
  for (const [name, creds] of Object.entries(credentials)) {
    tokens[name] = await tokenFor(creds);
  }

  const medicine = await db.Medicine.create({
    manufacturerId: maker.id,
    name: `Testazol ${unique('med')}`,
    genericName: 'Testazolam',
    strength: '250 mg',
    form: 'tablet',
    packSize: '10 tablets',
  });

  return {
    orgs: { maker, distributor, pharmacy, other, authority },
    credentials,
    tokens,
    medicine,
  };
}

/** A batch and its packs, through the real endpoint so serials are real. */
async function createBatch(world, overrides = {}) {
  const body = {
    medicineId: world.medicine.id,
    batchNo: unique('BATCH'),
    manufacturedOn: '2026-01-10',
    expiresOn: '2028-01-10',
    quantity: 5,
    ...overrides,
  };

  const response = await request(app)
    .post('/batches')
    .set('Authorization', `Bearer ${world.tokens.maker}`)
    .send(body);

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Batch creation failed: ${JSON.stringify(response.body)}`);
  }

  const packs = await db.Pack.findAll({
    where: { batchId: response.body.batch.id },
    order: [['id', 'ASC']],
  });

  return { batch: response.body.batch, packs, serials: packs.map((p) => p.serial) };
}

/**
 * Spaces a pack's events out over days, working backwards from the newest.
 *
 * Tests move packs through the whole chain in milliseconds, which makes a
 * Mumbai-to-Delhi leg imply about four million km/h and trips the
 * impossible-travel rule on perfectly healthy stock. The rule is right and the
 * data is wrong: a real leg takes days. This is the same reason the demo
 * seeder backdates its supply chain, and without it no test can tell a cloned
 * pack from an ordinary one.
 */
async function spaceOutEvents(packIds, daysApart = 3) {
  const DAY = 24 * 60 * 60 * 1000;

  for (const packId of packIds) {
    const events = await db.ScanEvent.findAll({
      where: { packId },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    });

    const newest = events.length ? new Date(events[events.length - 1].createdAt).getTime() : Date.now();

    for (let i = 0; i < events.length; i += 1) {
      const stepsFromEnd = events.length - 1 - i;
      await db.ScanEvent.update(
        { createdAt: new Date(newest - stepsFromEnd * daysApart * DAY) },
        { where: { id: events[i].id }, silent: true, audit: false }
      );
    }
  }
}

/** Moves packs one hop, the way the API expects it to happen. */
async function ship(world, { fromToken, toOrganizationId, receiverToken, serials }) {
  const created = await request(app)
    .post('/shipments')
    .set('Authorization', `Bearer ${fromToken}`)
    .send({ toOrganizationId, serials });

  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`Shipment creation failed: ${JSON.stringify(created.body)}`);
  }
  const id = created.body.shipment.id;

  const dispatched = await request(app)
    .post(`/shipments/${id}/dispatch`)
    .set('Authorization', `Bearer ${fromToken}`);
  if (dispatched.status !== 200) {
    throw new Error(`Dispatch failed: ${JSON.stringify(dispatched.body)}`);
  }

  const received = await request(app)
    .post(`/shipments/${id}/receive`)
    .set('Authorization', `Bearer ${receiverToken}`);
  if (received.status !== 200) {
    throw new Error(`Receive failed: ${JSON.stringify(received.body)}`);
  }

  const packs = await db.Pack.findAll({ where: { serial: serials }, attributes: ['id'] });
  await spaceOutEvents(packs.map((p) => p.id));

  return id;
}

module.exports = {
  app,
  db,
  request,
  PASSWORD,
  CITIES,
  createOrganization,
  createUser,
  tokenFor,
  createWorld,
  createBatch,
  ship,
  spaceOutEvents,
};
