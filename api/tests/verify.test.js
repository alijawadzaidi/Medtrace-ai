'use strict';

const { app, db, request, createWorld, createBatch, ship } = require('./helpers/fixtures');

/**
 * Public verification: the only unauthenticated surface in the system.
 *
 * The tests here are mostly about what it must *not* do — leak the catalogue,
 * confuse "we cannot tell you" with "this is fake", or let a page refresh
 * distort the scan history the detector learns from.
 */
describe('public verification', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('verifies a genuine pack with no authentication at all', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    const response = await request(app).get(`/verify/${serials[0]}`);

    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('genuine');
    expect(response.body.severity).toBe('ok');
    expect(response.body.medicine.name).toBe(world.medicine.name);
  });

  it('answers an unknown serial with 200 and a counterfeit verdict', async () => {
    const response = await request(app).get('/verify/MT-ZZZZZZ-ZZZZZZZZZZZZZ');

    // A 404 tells a counterfeiter which of their guesses were closer, and
    // tells a worried customer nothing at all.
    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('counterfeit');
  });

  it('rejects a malformed serial without touching the database', async () => {
    const response = await request(app).get('/verify/NOT-A-SERIAL');

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe('malformed_serial');
  });

  it('never leaks staff-only fields', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const response = await request(app).get(`/verify/${serials[0]}`);

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/licenseNo|passwordHash|ipAddress|userId/);
  });

  it('is never cached', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const response = await request(app).get(`/verify/${serials[0]}`);

    // Two scans of one serial are supposed to be two events. Caching this
    // response would erase the duplicate-scan signal the project rests on.
    expect(response.headers['cache-control']).toMatch(/no-store/);
  });

  it('reports a recalled batch even after the pack has left the factory', async () => {
    const { batch, serials } = await createBatch(world, { quantity: 1 });

    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.pharmacy.id,
      receiverToken: world.tokens.pharmacy,
      serials,
    });

    await request(app)
      .post(`/batches/${batch.id}/recall`)
      .set('Authorization', `Bearer ${world.tokens.regulator}`)
      .send({ reason: 'Failed dissolution test' });

    const response = await request(app).get(`/verify/${serials[0]}`);
    expect(response.body.verdict).toBe('recalled');
    expect(response.body.severity).toBe('critical');
  });

  it('reports an expired pack', async () => {
    const { serials } = await createBatch(world, {
      quantity: 1,
      manufacturedOn: '2024-01-01',
      expiresOn: '2025-01-01',
    });

    const response = await request(app).get(`/verify/${serials[0]}`);
    expect(response.body.verdict).toBe('expired');
  });

  it('shows the journey a customer can read', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    const response = await request(app).get(`/verify/${serials[0]}`);

    expect(response.body.journey.map((step) => step.event)).toEqual([
      'created',
      'dispatched',
      'received',
    ]);
    // Customer scans are noise in a custody story and are filtered out.
    expect(response.body.journey.some((step) => step.event === 'verified')).toBe(false);
  });

  it('records each scan once, however often the page is refreshed', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    const first = await request(app).get(`/verify/${serials[0]}`);
    const second = await request(app).get(`/verify/${serials[0]}`);

    expect(first.body.counted).toBe(true);
    // Without this, a customer refreshing the page inflates scan_count — the
    // very feature the scan-storm rule reads — and the detector ends up
    // learning from an artefact of the UI.
    expect(second.body.counted).toBe(false);

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    expect(pack.scanCount).toBe(1);
  });

  it('always records a scan from somewhere else, however recent', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    await request(app).post('/verify').send({ serial: serials[0], latitude: 19.07, longitude: 72.87 });
    const faraway = await request(app)
      .post('/verify')
      .send({ serial: serials[0], latitude: 28.61, longitude: 77.21 });

    // A repeat from 1,100 km away is not a refresh. It is the exact evidence
    // the system exists to capture, and discarding it as a duplicate would
    // erase the only trace of a cloned pack.
    expect(faraway.body.counted).toBe(true);
    expect(faraway.body.verdict).toBe('suspect');
    expect(faraway.body.warnings.map((w) => w.code)).toContain('impossible_travel');
  });

  it('stores only a coarse position and a truncated address', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    await request(app)
      .post('/verify')
      .send({ serial: serials[0], latitude: 19.076543, longitude: 72.877654 });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    const event = await db.ScanEvent.findOne({
      where: { packId: pack.id, type: 'verified' },
      order: [['id', 'DESC']],
    });

    // ~1.1 km, which keeps every feature the detector needs and discards the
    // rest of a member of the public's location.
    expect(Number(event.latitude)).toBe(19.08);
    expect(event.ipAddress).toMatch(/\/(24|48)$/);
    // A public scan has no actor, and that absence is itself a feature.
    expect(event.organizationId).toBeNull();
    expect(event.userId).toBeNull();
  });

  it('writes no audit row for public traffic', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const before = await db.AuditLog.count();

    await request(app).get(`/verify/${serials[0]}`);

    // The scan event *is* the record. Auditing public scans would duplicate
    // the entire public traffic of the system into a staff-actions table.
    expect(await db.AuditLog.count()).toBe(before);
  });
});
