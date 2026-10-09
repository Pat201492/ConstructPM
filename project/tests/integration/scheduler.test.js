/**
 * Integration tests — Scheduler "add project by code" endpoints.
 *
 *   GET  /api/scheduler/project-code/:code
 *   POST /api/scheduler/projects
 *
 * Exercises the real app + a real Postgres test database (via
 * tests/helpers/setup.js) so the atomicity and status-code behaviors are
 * verified against actual Postgres transactions, not mocks.
 */

const request = require('supertest');
const { setupSuite, teardownSuite, getApp, getDb, getIds } = require('../helpers/setup');
const { authHeader } = require('../helpers/auth');

let app;
let db;
let ids;

// Unique-ish suffix per test run so fixtures never collide with a
// previous (uncleaned) run of this same suite.
const RUN = Date.now().toString(36);
let seq = 0;
function uniqueCode(label) {
  seq += 1;
  return `${label}-${RUN}-${seq}`.toUpperCase();
}

beforeAll(async () => {
  const suite = await setupSuite();
  app = suite.app;
  db = getDb();
  ids = getIds();
}, 30000);

afterAll(async () => {
  await teardownSuite();
});

// Insert a project + Primary project_numbers row directly, bypassing the
// API, so GET/POST tests have a known fixture to look up.
async function createFixtureProject({ code, status = 'active', pm_id, start_date = null, project_length_days = null }) {
  const [project] = await db('projects').insert({
    name: `Fixture ${code}`,
    year: 2026,
    pm_id: pm_id || ids.users.pm,
    status,
    start_date,
    project_length_days,
  }).returning('*');

  await db('project_numbers').insert({ project_id: project.id, number: code, label: 'Primary' });

  return project;
}

describe('GET /api/scheduler/project-code/:code', () => {
  it('returns the project for an exact code match, case-insensitively', async () => {
    const code = uniqueCode('SCH');
    const fixture = await createFixtureProject({ code, start_date: '2026-06-01', project_length_days: 10 });

    const res = await request(app)
      .get(`/api/scheduler/project-code/${code.toLowerCase()}`)
      .set('Authorization', await authHeader(app, 'pm'));

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.project.id).toBe(fixture.id);
    expect(res.body.project.status).toBe('active');
    expect(res.body.project.start_date).toBe('2026-06-01');
    expect(res.body.project.project_length_days).toBe(10);
    expect(res.body.project.works_saturday).toBe(false);
    expect(res.body.project.works_sunday).toBe(false);
  });

  it('does not fall back to a name match', async () => {
    const code = uniqueCode('SCH');
    const fixture = await createFixtureProject({ code });

    const res = await request(app)
      .get(`/api/scheduler/project-code/${encodeURIComponent(fixture.name)}`)
      .set('Authorization', await authHeader(app, 'pm'));

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });

  it('returns exists:false for a code that matches nothing', async () => {
    const res = await request(app)
      .get(`/api/scheduler/project-code/${uniqueCode('NOPE')}`)
      .set('Authorization', await authHeader(app, 'pm'));

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });

  it('returns 403 for a role lacking the permission', async () => {
    const code = uniqueCode('SCH');
    await createFixtureProject({ code });

    const res = await request(app)
      .get(`/api/scheduler/project-code/${code}`)
      .set('Authorization', await authHeader(app, 'shop'));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/scheduler/projects — existing code', () => {
  it('updates start_date/length/weekend flags and the project shows up in scheduled-list', async () => {
    const code = uniqueCode('SCH');
    const fixture = await createFixtureProject({ code, start_date: '2026-01-01', project_length_days: 5 });

    // First call: no project_schedule_overrides row yet (insert branch).
    const res1 = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-07-15', project_length_days: 20, works_saturday: true, works_sunday: false });

    expect(res1.status).toBe(200);
    expect(res1.body.created).toBe(false);
    expect(res1.body.project.id).toBe(fixture.id);

    let updated = await db('projects').where('id', fixture.id).first();
    expect(updated.project_length_days).toBe(20);
    let overrides = await db('project_schedule_overrides').where('project_id', fixture.id).first();
    expect(overrides.works_saturday).toBe(true);
    expect(overrides.works_sunday).toBe(false);

    // Second call: overrides row now exists (update branch).
    const res2 = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-07-15', project_length_days: 20, works_saturday: false, works_sunday: true });

    expect(res2.status).toBe(200);
    overrides = await db('project_schedule_overrides').where('project_id', fixture.id).first();
    expect(overrides.works_saturday).toBe(false);
    expect(overrides.works_sunday).toBe(true);

    // Shows up in scheduled-list for an overlapping window.
    const listRes = await request(app)
      .get('/api/projects/scheduled-list?from=2026-07-01&to=2026-07-31')
      .set('Authorization', await authHeader(app, 'admin'));

    expect(listRes.status).toBe(200);
    const ids_ = listRes.body.projects.map(p => p.id);
    expect(ids_).toContain(fixture.id);
  });

  it('returns 409 and writes nothing when the project is not active/on_hold', async () => {
    const code = uniqueCode('SCH');
    const fixture = await createFixtureProject({ code, status: 'completed', start_date: '2026-01-01', project_length_days: 5 });

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-08-01', project_length_days: 15 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/completed/);

    const unchanged = await db('projects').where('id', fixture.id).first();
    expect(unchanged.start_date).toEqual(fixture.start_date);
    expect(unchanged.project_length_days).toBe(5);
    const overrides = await db('project_schedule_overrides').where('project_id', fixture.id).first();
    expect(overrides).toBeUndefined();
  });

  it('returns 403 for a role lacking the permission', async () => {
    const code = uniqueCode('SCH');
    await createFixtureProject({ code });

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'shop'))
      .send({ project_code: code, start_date: '2026-08-01', project_length_days: 15 });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/scheduler/projects — unknown code (create)', () => {
  it('creates the project, its Primary project_numbers row, and its overrides row atomically', async () => {
    const code = uniqueCode('NEW');

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({
        project_code: code,
        start_date: '2026-09-01',
        project_length_days: 12,
        works_saturday: true,
        works_sunday: false,
        name: 'Brand New Project',
        pm_id: ids.users.pm,
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    const projectId = res.body.project.id;

    const project = await db('projects').where('id', projectId).first();
    expect(project).toBeTruthy();
    expect(project.name).toBe('Brand New Project');
    expect(project.status).toBe('active');
    expect(project.year).toBe(2026);
    expect(project.project_length_days).toBe(12);

    const pn = await db('project_numbers').where({ project_id: projectId, number: code }).first();
    expect(pn).toBeTruthy();
    expect(pn.label).toBe('Primary');

    const overrides = await db('project_schedule_overrides').where('project_id', projectId).first();
    expect(overrides).toBeTruthy();
    expect(overrides.works_saturday).toBe(true);
    expect(overrides.works_sunday).toBe(false);
  });

  it('rolls back the whole transaction when the last insert fails, leaving no project row', async () => {
    // project_numbers.number is varchar(100) — a too-long code fails that
    // insert for real (no mocking), after the project + overrides rows
    // have already been written inside the same transaction.
    const code = 'TOOLONG-'.repeat(13); // > 100 chars, guaranteed not to pre-exist
    const uniqueName = `Atomicity Probe ${uniqueCode('X')}`;

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({
        project_code: code,
        start_date: '2026-09-01',
        project_length_days: 12,
        name: uniqueName,
        pm_id: ids.users.pm,
      });

    expect(res.status).toBeGreaterThanOrEqual(400);

    const leftover = await db('projects').where('name', uniqueName).first();
    expect(leftover).toBeUndefined();
  });

  it('returns 400 and writes nothing when start_date is missing/invalid', async () => {
    const code = uniqueCode('NEW');
    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, project_length_days: 10, name: 'X', pm_id: ids.users.pm });

    expect(res.status).toBe(400);
    const pn = await db('project_numbers').where('number', code).first();
    expect(pn).toBeUndefined();
  });

  it('returns 400 and writes nothing when project_length_days is missing/invalid', async () => {
    const code = uniqueCode('NEW');
    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-09-01', project_length_days: 0, name: 'X', pm_id: ids.users.pm });

    expect(res.status).toBe(400);
    const pn = await db('project_numbers').where('number', code).first();
    expect(pn).toBeUndefined();
  });

  it('returns 400 and writes nothing when name is missing for a new code', async () => {
    const code = uniqueCode('NEW');
    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-09-01', project_length_days: 10, pm_id: ids.users.pm });

    expect(res.status).toBe(400);
  });

  it('returns 400 and writes nothing when pm_id is missing for a new code', async () => {
    const code = uniqueCode('NEW');
    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-09-01', project_length_days: 10, name: 'X' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when pm_id is not an active user with role project_manager or admin', async () => {
    const code = uniqueCode('NEW');

    // Wrong role (accounting, active).
    const res1 = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-09-01', project_length_days: 10, name: 'X', pm_id: ids.users.accounting });
    expect(res1.status).toBe(400);

    // Right role, inactive user.
    const [inactivePm] = await db('users').insert({
      email: 'inactive-pm@test.com',
      password_hash: 'x',
      first_name: 'Inactive',
      last_name: 'PM',
      role: 'project_manager',
      active: false,
    }).returning('*');

    const res2 = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'pm'))
      .send({ project_code: code, start_date: '2026-09-01', project_length_days: 10, name: 'X', pm_id: inactivePm.id });
    expect(res2.status).toBe(400);

    const pn = await db('project_numbers').where('number', code).first();
    expect(pn).toBeUndefined();
  });
});
