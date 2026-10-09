// applySuperadminBootstrap — re-applied on every server boot (src/server.js)
// to sync is_superadmin from SUPERADMIN_BOOTSTRAP_EMAIL. Runs against a real
// test database because it chains knex where/whereRaw/update/insert calls
// that aren't worth hand-mocking faithfully. Seeds its own users directly
// (tests/helpers/testDb.js seeds a `customers` shape that predates the
// current schema, so it isn't used here).

const knex = require('knex');
const bcrypt = require('bcryptjs');
const { applySuperadminBootstrap } = require('../../src/services/superadminBootstrap');

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.TEST_DB_NAME || 'construct_mgr_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  migrations: { directory: './migrations' },
  pool: { min: 1, max: 5 },
});

const USERS = {
  admin: 'bootstrap-admin@test.com',
  pm: 'bootstrap-pm@test.com',
};

async function seedUser(email) {
  const password_hash = await bcrypt.hash('TestPass123!', 4);
  await db('users').insert({
    email,
    password_hash,
    first_name: 'Test',
    last_name: 'User',
    initials: 'TU',
    active: true,
  });
}

describe('applySuperadminBootstrap', () => {
  let warnSpy;
  let logSpy;

  beforeAll(async () => {
    await db.migrate.latest();
  }, 30000);

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db('users').whereIn('email', Object.values(USERS)).del();
    await seedUser(USERS.admin);
    await seedUser(USERS.pm);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    await db('users').where('email', 'brand-new-superadmin@test.com').del();
  });

  it('set: grants is_superadmin to the matching user (any letter case) and revokes everyone else', async () => {
    await db('users').where('email', USERS.admin).update({ is_superadmin: true });

    await applySuperadminBootstrap(db, USERS.pm.toUpperCase());

    const admin = await db('users').where('email', USERS.admin).first();
    const pm = await db('users').where('email', USERS.pm).first();
    expect(admin.is_superadmin).toBe(false);
    expect(pm.is_superadmin).toBe(true);
  });

  it('unset: revokes existing superadmins and warns with the count and env var name', async () => {
    await db('users').where('email', USERS.admin).update({ is_superadmin: true });
    await db('users').where('email', USERS.pm).update({ is_superadmin: true });

    await applySuperadminBootstrap(db, undefined);

    const stillGranted = await db('users').whereIn('email', Object.values(USERS)).where('is_superadmin', true);
    expect(stillGranted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SUPERADMIN_BOOTSTRAP_EMAIL'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2'));
  });

  it('unset: does not warn when no one was revoked', async () => {
    await applySuperadminBootstrap(db, '');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('email not yet a user: creates the user with superadmin granted', async () => {
    const target = 'brand-new-superadmin@test.com';

    await applySuperadminBootstrap(db, target);

    const created = await db('users').where('email', target).first();
    expect(created).toBeDefined();
    expect(created.is_superadmin).toBe(true);
    expect(created.password_hash).toBeTruthy();
  });
});
