'use strict';

const { app, db, request, createWorld, createBatch, ship } = require('./helpers/fixtures');

/**
 * The chain of custody.
 *
 * This is the cheapest effective anti-counterfeit control in the system:
 * without it a pack can appear at a pharmacy having never left the factory and
 * the record looks perfectly ordinary. Every test here is a way that could
 * happen.
 */
describe('custody', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('moves packs manufacturer to distributor to pharmacy', async () => {
    const { serials } = await createBatch(world, { quantity: 3 });

    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    let pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    expect(pack.state).toBe('received');
    expect(pack.currentOrganizationId).toBe(world.orgs.distributor.id);

    await ship(world, {
      fromToken: world.tokens.distributor,
      toOrganizationId: world.orgs.pharmacy.id,
      receiverToken: world.tokens.pharmacy,
      serials,
    });

    pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    expect(pack.currentOrganizationId).toBe(world.orgs.pharmacy.id);
  });

  it('writes a geo-tagged event for every custody change', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    const pack = await db.Pack.findOne({ where: { serial: serials[0] } });
    const events = await db.ScanEvent.findAll({
      where: { packId: pack.id },
      order: [['id', 'ASC']],
    });

    expect(events.map((e) => e.type)).toEqual(['created', 'dispatched', 'received']);
    // Coordinates on every event: implied travel speed between consecutive
    // events is the strongest single signal that a serial has been cloned,
    // and it needs a position on both ends.
    for (const event of events) expect(event.latitude).not.toBeNull();
  });

  it('refuses to let anyone but the holder dispatch', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    // The pharmacy never had these packs.
    const response = await request(app)
      .post('/shipments')
      .set('Authorization', `Bearer ${world.tokens.distributor}`)
      .send({ toOrganizationId: world.orgs.pharmacy.id, serials });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to let anyone but the destination receive', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    const created = await request(app)
      .post('/shipments')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({ toOrganizationId: world.orgs.distributor.id, serials });
    await request(app)
      .post(`/shipments/${created.body.shipment.id}/dispatch`)
      .set('Authorization', `Bearer ${world.tokens.maker}`);

    // An organization with no part in the shipment cannot even see it, so the
    // answer is 404: a 403 would confirm the shipment exists and let anyone
    // map other people's logistics by walking ids.
    const uninvolved = await request(app)
      .post(`/shipments/${created.body.shipment.id}/receive`)
      .set('Authorization', `Bearer ${world.tokens.pharmacy}`);
    expect(uninvolved.status).toBe(404);

    // The sender *can* see it, and is refused on the rule itself: signing for
    // your own delivery is how a pack arrives without ever travelling.
    const senderSigningForThemselves = await request(app)
      .post(`/shipments/${created.body.shipment.id}/receive`)
      .set('Authorization', `Bearer ${world.tokens.maker}`);
    expect(senderSigningForThemselves.status).toBe(403);
  });

  it('refuses a route the organization types do not allow', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.pharmacy.id,
      receiverToken: world.tokens.pharmacy,
      serials,
    });

    // A pharmacy shipping onward is not a workflow, it is a red flag.
    const response = await request(app)
      .post('/shipments')
      .set('Authorization', `Bearer ${world.tokens.pharmacy}`)
      .send({ toOrganizationId: world.orgs.other.id, serials });

    expect(response.status).toBe(403);
  });

  it('will not put one pack on two open shipments', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });

    const first = await request(app)
      .post('/shipments')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({ toOrganizationId: world.orgs.distributor.id, serials });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/shipments')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({ toOrganizationId: world.orgs.pharmacy.id, serials });

    // Double-booking a pack is how one physical box becomes two records.
    expect(second.status).toBe(409);
  });

  it('will not move packs from a recalled batch', async () => {
    const { batch, serials } = await createBatch(world, { quantity: 2 });

    await request(app)
      .post(`/batches/${batch.id}/recall`)
      .set('Authorization', `Bearer ${world.tokens.regulator}`)
      .send({ reason: 'Contamination' });

    const response = await request(app)
      .post('/shipments')
      .set('Authorization', `Bearer ${world.tokens.maker}`)
      .send({ toOrganizationId: world.orgs.distributor.id, serials });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('lets a pharmacy dispense, once, and never again', async () => {
    const { serials } = await createBatch(world, { quantity: 1 });
    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.pharmacy.id,
      receiverToken: world.tokens.pharmacy,
      serials,
    });

    const first = await request(app)
      .post(`/packs/${serials[0]}/dispense`)
      .set('Authorization', `Bearer ${world.tokens.pharmacy}`);
    expect(first.status).toBe(200);

    // Dispensed is terminal: the pack is with a patient.
    const second = await request(app)
      .post(`/packs/${serials[0]}/dispense`)
      .set('Authorization', `Bearer ${world.tokens.pharmacy}`);
    expect(second.status).toBe(409);
  });

  it('refuses to dispense an expired pack', async () => {
    const { serials } = await createBatch(world, {
      quantity: 1,
      manufacturedOn: '2024-01-01',
      expiresOn: '2025-01-01',
    });

    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.pharmacy.id,
      receiverToken: world.tokens.pharmacy,
      serials,
    });

    const response = await request(app)
      .post(`/packs/${serials[0]}/dispense`)
      .set('Authorization', `Bearer ${world.tokens.pharmacy}`);

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('audits a bulk movement once, not once per pack', async () => {
    const { serials } = await createBatch(world, { quantity: 40 });
    const before = await db.AuditLog.count();

    await ship(world, {
      fromToken: world.tokens.maker,
      toOrganizationId: world.orgs.distributor.id,
      receiverToken: world.tokens.distributor,
      serials,
    });

    const written = (await db.AuditLog.count()) - before;
    // 40 packs moved twice would be 80 audit rows of pure noise. The shipment
    // carries the quantity; the scan events carry the per-pack detail.
    expect(written).toBeLessThan(10);
  });
});
