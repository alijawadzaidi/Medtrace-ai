'use strict';

const { app, db, request, createWorld, createBatch } = require('./helpers/fixtures');
const serialService = require('../src/services/serial.service');

describe('catalogue and serialization', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('lets only a manufacturer register a medicine', async () => {
    const denied = await request(app)
      .post('/medicines')
      .set('Authorization', `Bearer ${world.tokens.distributor}`)
      .send({ name: 'Nope', strength: '1 mg', form: 'tablet' });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post('/medicines')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({ name: 'Testomycin', strength: '1 mg', form: 'tablet' });
    expect(allowed.status).toBe(201);
  });

  it('creates a batch and every one of its packs', async () => {
    const { batch, packs } = await createBatch(world, { quantity: 25 });

    expect(batch.quantity).toBe(25);
    // The batch and its packs are written in one transaction. A batch holding
    // half its packs would be silently wrong until the counts stopped matching.
    expect(packs).toHaveLength(25);
  });

  it('gives every pack a distinct, well-formed serial', async () => {
    const { serials } = await createBatch(world, { quantity: 30 });

    expect(new Set(serials).size).toBe(30);
    for (const serial of serials) {
      expect(serialService.isWellFormed(serial)).toBe(true);
    }
  });

  it('rejects a serial whose check character does not match', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const good = serials[0];
    const tampered = `${good.slice(0, -1)}${good.slice(-1) === 'X' ? 'Y' : 'X'}`;

    expect(serialService.isWellFormed(good)).toBe(true);
    // The point of the check character: a typo costs no database query at all.
    expect(serialService.isWellFormed(tampered)).toBe(false);
  });

  it('normalises the characters a human misreads off a label', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    const serial = serials[0];

    // Crockford base32 has no I, L, O or U, so those can only be misreadings
    // of 1, 1, 0 and V.
    const misread = serial.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'O');
    expect(serialService.normalise(misread)).toBe(serial);
  });

  it('refuses a batch larger than the cap', async () => {
    const response = await request(app)
      .post('/batches')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({
        medicineId: world.medicine.id,
        batchNo: `TOO-BIG-${Date.now()}`,
        manufacturedOn: '2026-01-10',
        expiresOn: '2028-01-10',
        quantity: 500000,
      });

    expect(response.status).toBe(400);
  });

  it('writes no packs at all when batch creation fails', async () => {
    const batchNo = `DUPLICATE-${Date.now()}`;
    const body = {
      medicineId: world.medicine.id,
      batchNo,
      manufacturedOn: '2026-01-10',
      expiresOn: '2028-01-10',
      quantity: 10,
    };

    const first = await request(app)
      .post('/batches')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send(body);
    expect(first.status).toBe(201);

    // Same batch number: the unique constraint rejects it partway through.
    const second = await request(app)
      .post('/batches')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send(body);
    expect(second.status).toBe(409);

    const batches = await db.Batch.findAll({ where: { batchNo } });
    expect(batches).toHaveLength(1);
    const packs = await db.Pack.count({ where: { batchId: batches[0].id } });
    expect(packs).toBe(10); // exactly the first batch's packs, none orphaned
  });

  it('renders a QR image on demand rather than storing one per pack', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    const response = await request(app)
      .get(`/packs/${serials[0]}/qr.png`)
      .set('Authorization', `Bearer ${world.tokens.maker}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/image\/png/);
    expect(response.body.length).toBeGreaterThan(100);
  });

  it('produces a printable label sheet containing every serial', async () => {
    const { batch, serials } = await createBatch(world, { quantity: 4 });

    const response = await request(app)
      .get(`/batches/${batch.id}/labels`)
      .set('Authorization', `Bearer ${world.tokens.maker}`);

    expect(response.status).toBe(200);
    for (const serial of serials) expect(response.text).toContain(serial);
  });

  it('lets only a regulator recall a batch', async () => {
    const { batch } = await createBatch(world, { quantity: 2 });

    const denied = await request(app)
      .post(`/batches/${batch.id}/recall`)
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({ reason: 'I would rather this went away' });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post(`/batches/${batch.id}/recall`)
      .set('Authorization', `Bearer ${world.tokens.regulator}`)
      .send({ reason: 'Dissolution test failure' });
    expect(allowed.status).toBe(200);

    const reloaded = await db.Batch.findByPk(batch.id);
    expect(reloaded.status).toBe('recalled');
  });

  it('hides another manufacturer\'s batch behind a 404, not a 403', async () => {
    const rival = await createWorld();
    const { batch } = await createBatch(rival, { quantity: 1 });

    const response = await request(app)
      .get(`/batches/${batch.id}`)
      .set('Authorization', `Bearer ${world.tokens.maker}`);

    // 404 rather than 403 is deliberate. The lookup is organization-scoped, so
    // a rival's batch is indistinguishable from one that does not exist —
    // a 403 would confirm the batch is real and let a competitor map the
    // catalogue by walking ids.
    expect(response.status).toBe(404);

    // And a regulator still sees it, which is the whole point of the exception.
    const oversight = await request(app)
      .get(`/batches/${batch.id}`)
      .set('Authorization', `Bearer ${world.tokens.regulator}`);
    expect(oversight.status).toBe(200);
  });
});
