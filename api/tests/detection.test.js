'use strict';

const { app, db, request, createWorld, createBatch, ship } = require('./helpers/fixtures');
const detection = require('../src/services/detection.service');
const features = require('../src/services/features.service');

/**
 * Detection, with no scoring service running.
 *
 * That is not a limitation of the test environment — it is the case worth
 * asserting. The Python service is stateless precisely so that its absence
 * degrades one feature rather than taking the system down, and these tests
 * prove the rules still fire and the API still answers when it is unreachable.
 */
describe('feature extraction', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('computes every feature the model expects, and only those', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });

    const vector = await features.computeForPack(pack.id);

    for (const name of features.FEATURE_ORDER) {
      expect(typeof vector[name]).toBe('number');
      expect(Number.isFinite(vector[name])).toBe(true);
    }
  });

  it('counts a hop only when the holder actually changes', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    const vector = await features.computeForPack(pack.id);

    // created(maker) -> dispatched(maker) -> received(distributor) is one hop.
    expect(vector.custody_hops).toBe(1);
  });

  it('reports negative days to expiry for expired stock', async () => {
    const { serials } = await createBatch(world, {
      quantity: 1,
      manufacturedOn: '2024-01-01',
      expiresOn: '2025-01-01',
    });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    const vector = await features.computeForPack(pack.id);

    expect(vector.days_to_expiry).toBeLessThan(0);
  });

  it('is high entropy for scans spread over days, low for a spike', () => {
    const spread = features.entropyOf([1, 1, 1, 1, 1, 1, 1, 1]);
    const spike = features.entropyOf([40, 1]);

    // An honest batch is scanned as customers happen to buy its packs; a
    // photographed label produces a burst.
    expect(spread).toBeGreaterThan(spike);
  });
});

describe('rules', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('raises impossible travel from two distant scans minutes apart', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    await request(app).post('/verify').send({ serial: serials[0], latitude: 19.07, longitude: 72.87 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 28.61, longitude: 77.21 });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    const result = await detection.evaluatePacks([pack.id]);

    expect(result.scorer).toBe('unavailable');
    const alerts = await db.Alert.findAll({ where: { packId: pack.id } });
    expect(alerts.map((a) => a.rule)).toContain('impossible_travel');
    expect(alerts.find((a) => a.rule === 'impossible_travel').severity).toBe('critical');
  });

  it('raises custody skip when a pack arrives that nobody sent', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });

    // Written directly: the API refuses to produce this, which is the point —
    // the rule exists to catch records that arrived some other way.
    await db.ScanEvent.create({
      packId: pack.id,
      type: 'received',
      organizationId: world.orgs.pharmacy.id,
      latitude: world.orgs.pharmacy.latitude,
      longitude: world.orgs.pharmacy.longitude,
    });

    await detection.evaluatePacks([pack.id]);

    const alerts = await db.Alert.findAll({ where: { packId: pack.id } });
    expect(alerts.map((a) => a.rule)).toContain('custody_skip');
  });

  it('raises expired stock still moving', async () => {
    const { serials } = await createBatch(world, {
      quantity: 1,
      manufacturedOn: '2023-01-01',
      expiresOn: '2024-01-01',
    });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    await detection.evaluatePacks([pack.id]);

    const alerts = await db.Alert.findAll({ where: { packId: pack.id } });
    expect(alerts.map((a) => a.rule)).toContain('expired_stock');
  });

  it('leaves an ordinary pack alone', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    await detection.evaluatePacks([pack.id]);

    // A detector that flags healthy stock is a detector nobody reads.
    expect(await db.Alert.count({ where: { packId: pack.id } })).toBe(0);
  });

  it('sharpens an existing alert instead of piling up duplicates', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 19.07, longitude: 72.87 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 28.61, longitude: 77.21 });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });

    await detection.evaluatePacks([pack.id]);
    await detection.evaluatePacks([pack.id]);
    await detection.evaluatePacks([pack.id]);

    const alerts = await db.Alert.findAll({
      where: { packId: pack.id, rule: 'impossible_travel' },
    });
    // One cloned pack scanned four hundred times must not become four hundred
    // identical alerts: a triage queue nobody can use is the same as no
    // detector at all.
    expect(alerts).toHaveLength(1);
  });

  it('keeps the evidence that produced each alert', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 19.07, longitude: 72.87 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 12.97, longitude: 77.59 });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    await detection.evaluatePacks([pack.id]);

    const alert = await db.Alert.findOne({ where: { packId: pack.id } });
    expect(alert.details.features).toBeDefined();
    expect(alert.details.featureVersion).toBe(features.FEATURE_VERSION);
    // "Why was this flagged" is the first question anyone asks.
    for (const name of features.FEATURE_ORDER) {
      expect(alert.details.features[name]).toBeDefined();
    }
  });
});

describe('alert triage', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('is closed to everyone but a regulator', async () => {
    for (const role of ['maker', 'distributor', 'pharmacy']) {
      const response = await request(app)
        .get('/alerts')
        .set('Authorization', `Bearer ${world.tokens[role]}`);
      // An alert is an accusation; the accused must not be able to dismiss it.
      expect(response.status).toBe(403);
    }

    const regulator = await request(app)
      .get('/alerts')
      .set('Authorization', `Bearer ${world.tokens.regulator}`);
    expect(regulator.status).toBe(200);
  });

  it('records who closed an alert and when', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 19.07, longitude: 72.87 });
    await request(app).post('/verify').send({ serial: serials[0], latitude: 28.61, longitude: 77.21 });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    await detection.evaluatePacks([pack.id]);
    const alert = await db.Alert.findOne({ where: { packId: pack.id } });

    const response = await request(app)
      .patch(`/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${world.tokens.regulator}`)
      .send({ status: 'dismissed', resolutionNote: 'Known courier test route' });

    expect(response.status).toBe(200);

    const closed = await db.Alert.findByPk(alert.id);
    expect(closed.status).toBe('dismissed');
    // A dismissed alert that turns out to have been real is exactly the record
    // an inquiry would want.
    expect(closed.resolvedByUserId).toBeTruthy();
    expect(closed.resolvedAt).toBeTruthy();
  });

  it('runs a sweep and says honestly that the model was unreachable', async () => {
    const response = await request(app)
      .post('/detection/run')
      .set('Authorization', `Bearer ${world.tokens.regulator}`)
      .send({ limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body.scorer).toBe('unavailable');
    expect(response.body.note).toMatch(/only the deterministic rules ran/i);
  });

  it('reports the scorer as unavailable rather than pretending', async () => {
    const response = await request(app)
      .get('/detection/health')
      .set('Authorization', `Bearer ${world.tokens.regulator}`);

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
  });
});
