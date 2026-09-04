'use strict';

const { app, db, request, createWorld, createUser } = require('./helpers/fixtures');

/**
 * Identity and the scoping rule.
 *
 * The rule worth testing is not "does login work" but "does RBAC mean *which*
 * distributor rather than *a* distributor". That distinction is the one an
 * examiner checks first, and the one an organization-scoped query is for.
 */
describe('authentication', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('issues a token for correct credentials', async () => {
    const response = await request(app).post('/auth/login').send({
      email: world.credentials.maker.email,
      password: world.credentials.maker.password,
    });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.user.email).toBe(world.credentials.maker.email);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: world.credentials.maker.email, password: 'not-the-password' });

    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.test', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);

    // The two must be indistinguishable. A response that says "no such
    // account" for one and "wrong password" for the other turns the login
    // form into an account-enumeration oracle: an attacker learns which
    // addresses are registered without ever guessing a password.
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('never returns a password hash', async () => {
    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${world.tokens.maker}`);

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|password_hash/);
  });

  it('refuses a request with no token', async () => {
    const response = await request(app).get('/auth/me');
    expect(response.status).toBe(401);
  });

  it('refuses a tampered token', async () => {
    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${world.tokens.maker}tampered`);

    expect(response.status).toBe(401);
  });

  it('stops working the moment the account is deactivated', async () => {
    const org = world.orgs.pharmacy;
    const credentials = await createUser(org);
    const token = (
      await request(app).post('/auth/login').send(credentials)
    ).body.token;

    await db.User.update({ isActive: false }, { where: { email: credentials.email } });

    const response = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

    // The token is still cryptographically valid; the database round-trip in
    // requireAuth is what makes deactivation take effect immediately rather
    // than at expiry.
    expect(response.status).toBe(403);
  });
});

describe('organization scoping', () => {
  let world;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('shows a non-regulator only their own organization', async () => {
    const response = await request(app)
      .get('/organizations')
      .set('Authorization', `Bearer ${world.tokens.distributor}`);

    expect(response.status).toBe(200);
    expect(response.body.organizations).toHaveLength(1);
    expect(response.body.organizations[0].id).toBe(world.orgs.distributor.id);
  });

  it('shows a regulator every organization', async () => {
    const response = await request(app)
      .get('/organizations')
      .set('Authorization', `Bearer ${world.tokens.regulator}`);

    expect(response.status).toBe(200);
    expect(response.body.organizations.length).toBeGreaterThan(1);
  });

  it('refuses to read another organization by id', async () => {
    const response = await request(app)
      .get(`/organizations/${world.orgs.pharmacy.id}`)
      .set('Authorization', `Bearer ${world.tokens.distributor}`);

    expect(response.status).toBe(403);
  });

  it('lets a regulator read any organization', async () => {
    const response = await request(app)
      .get(`/organizations/${world.orgs.pharmacy.id}`)
      .set('Authorization', `Bearer ${world.tokens.regulator}`);

    expect(response.status).toBe(200);
  });

  it('lists only the partners the custody rules allow as a destination', async () => {
    const maker = await request(app)
      .get('/organizations/partners')
      .set('Authorization', `Bearer ${world.tokens.maker}`);

    expect(maker.status).toBe(200);
    expect(maker.body.organizations.every((o) => ['distributor', 'pharmacy'].includes(o.type))).toBe(true);
    // Licence numbers and coordinates are not address-label information.
    expect(JSON.stringify(maker.body)).not.toMatch(/licenseNo|latitude/);

    const pharmacy = await request(app)
      .get('/organizations/partners')
      .set('Authorization', `Bearer ${world.tokens.pharmacy}`);

    // A pharmacy may not dispatch at all, so it has no destinations.
    expect(pharmacy.body.organizations).toHaveLength(0);
  });

  it('keeps the audit trail to regulators', async () => {
    const denied = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${world.tokens.maker}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${world.tokens.regulator}`);
    expect(allowed.status).toBe(200);
  });
});
