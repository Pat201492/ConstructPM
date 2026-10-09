/**
 * Integration tests — Scheduler "add a project by code" endpoints.
 *
 *   GET  /api/scheduler/project-code/:code
 *   POST /api/scheduler/projects
 *
 * Covers issue #66 acceptance criteria:
 *   - exact (case-insensitive) code lookup, NO name fallback
 *   - POST updates an existing project's schedule fields and makes it
 *     show up in /api/projects/scheduled-list
 *   - POST creates project + Primary number + overrides atomically
 *   - 400 validation for bad/missing fields and bad pm_id
 *   - 409 for a non-active/on_hold project
 *   - 403 for a role without the schedule-edit permission
 */

const request = require('supertest');
const { setupSuite, teardownSuite, resetAndSeed, getApp, getDb, getIds } = require('../helpers/setup');
const { authHeader, clearTokenCache } = require('../helpers/auth');

let app;
let db;

// Create a project with a Primary project_number. Returns { id }.
async function makeProject({ name, number, status = 'active', pmId, startDate = null, length = null }) {
  const [project] = await db('projects').insert({
    name,
    year: 2026,
    pm_id: pmId,
    status,
    start_date: startDate,
    project_length_days: length,
  }).returning('*');
  await db('project_numbers').insert({ project_id: project.id, number, label: 'Primary' });
  return project;
}

beforeAll(async () => {
  const s = await setupSuite();
  app = s.app;
  db = s.db;
});

afterAll(async () => {
  await teardownSuite();
});

beforeEach(async () => {
  clearTokenCache();
  await resetAndSeed();
});

describe('GET /api/scheduler/project-code/:code', () => {
  it('returns the project for an exact code in any letter case', async () => {
    const pmId = getIds().users.pm;
    await makeProject({ name: 'Acme Plant Upgrade', number: 'PRJ-2026-100', pmId, startDate: '2026-07-01', length: 10 });

    const res = await request(app)
      .get('/api/scheduler/project-code/prj-2026-100') // lowercase on purpose
      .set('Authorization', await authHeader(app, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.project).toMatchObject({
      name: 'Acme Plant Upgrade',
      status: 'active',
      pm_id: pmId,
      project_length_days: 10,
      works_saturday: false,
      works_sunday: false,
    });
    expect(res.body.project.pm_name).toBe('Test PM');
  });

  it('returns exists:false for a code that only matches a project NAME', async () => {
    const pmId = getIds().users.pm;
    // Project NAME is "ZONE-9" but its number is something else.
    await makeProject({ name: 'ZONE-9', number: 'REAL-NUM-1', pmId });

    const res = await request(app)
      .get('/api/scheduler/project-code/ZONE-9')
      .set('Authorization', await authHeader(app, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
  });

  it('returns 403 for a role lacking the schedule-edit permission', async () => {
    const res = await request(app)
      .get('/api/scheduler/project-code/anything')
      .set('Authorization', await authHeader(app, 'shop'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/scheduler/projects — existing code', () => {
  it('updates start_date, length, works_saturday/sunday and appears in scheduled-list', async () => {
    const pmId = getIds().users.pm;
    const project = await makeProject({ name: 'Bridge Repaint', number: 'PRJ-EXIST-1', pmId });

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'admin'))
      .send({
        project_code: 'prj-exist-1',
        start_date: '2026-08-10',
        project_length_days: 5,
        works_saturday: true,
        works_sunday: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);

    const row = await db('projects').where('id', project.id).first();
    expect(row.project_length_days).toBe(5);
    // pg returns a `date` column as a JS Date at local midnight.
    const d = new Date(row.start_date);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 7, 10]);

    const override = await db('project_schedule_overrides').where('project_id', project.id).first();
    expect(override.works_saturday).toBe(true);
    expect(override.works_sunday).toBe(false);

    const list = await request(app)
      .get('/api/projects/scheduled-list?from=2026-08-01&to=2026-08-31')
      .set('Authorization', await authHeader(app, 'admin'));
    expect(list.status).toBe(200);
    const ids = list.body.projects.map(p => p.id);
    expect(ids).toContain(project.id);
  });

  it('returns 409 and writes nothing for a project not active/on_hold', async () => {
    const pmId = getIds().users.pm;
    const project = await makeProject({ name: 'Finished Job', number: 'PRJ-DONE-1', status: 'completed', pmId });

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'admin'))
      .send({ project_code: 'PRJ-DONE-1', start_date: '2026-08-10', project_length_days: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('completed');

    const row = await db('projects').where('id', project.id).first();
    expect(row.start_date).toBeNull();
    const override = await db('project_schedule_overrides').where('project_id', project.id).first();
    expect(override).toBeUndefined();
  });
});

describe('POST /api/scheduler/projects — unknown code (create)', () => {
  it('creates project + Primary number + overrides', async () => {
    const pmId = getIds().users.pm;

    const res = await request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, 'admin'))
      .send({
        project_code: 'NEW-2026-500',
        start_date: '2026-09-01',
        project_length_days: 3,
        works_saturday: false,
        works_sunday: true,
        name: 'Fresh Project',
        pm_id: pmId,
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    const newId = res.body.project.id;

    const row = await db('projects').where('id', newId).first();
    expect(row.name).toBe('Fresh Project');
    expect(row.year).toBe(2026);
    expect(row.status).toBe('active');
    expect(row.project_length_days).toBe(3);

    const num = await db('project_numbers').where('project_id', newId).first();
    expect(num).toMatchObject({ number: 'NEW-2026-500', label: 'Primary' });

    const override = await db('project_schedule_overrides').where('project_id', newId).first();
    expect(override).toMatchObject({ works_saturday: false, works_sunday: true });
  });

  it('is atomic — a forced failure on the last insert leaves no project row', async () => {
    const pmId = getIds().users.pm;

    // Force the FINAL insert (project_schedule_overrides) to fail.
    await db.raw(`CREATE OR REPLACE FUNCTION pg_temp_fail_pso() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END; $$ LANGUAGE plpgsql;`);
    await db.raw(`CREATE TRIGGER t_fail_pso BEFORE INSERT ON project_schedule_overrides FOR EACH ROW EXECUTE FUNCTION pg_temp_fail_pso();`);

    try {
      const res = await request(app)
        .post('/api/scheduler/projects')
        .set('Authorization', await authHeader(app, 'admin'))
        .send({
          project_code: 'ROLLBACK-1',
          start_date: '2026-09-01',
          project_length_days: 3,
          name: 'Should Not Persist',
          pm_id: pmId,
        });

      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await db.raw('DROP TRIGGER t_fail_pso ON project_schedule_overrides');
      await db.raw('DROP FUNCTION pg_temp_fail_pso()');
    }

    const num = await db('project_numbers').where('number', 'ROLLBACK-1').first();
    expect(num).toBeUndefined();
    const proj = await db('projects').where('name', 'Should Not Persist').first();
    expect(proj).toBeUndefined();
  });
});

describe('POST /api/scheduler/projects — validation', () => {
  const base = { project_code: 'VALIDATE-1', start_date: '2026-09-01', project_length_days: 2 };

  async function post(body, role = 'admin') {
    return request(app)
      .post('/api/scheduler/projects')
      .set('Authorization', await authHeader(app, role))
      .send(body);
  }

  it('400 when start_date is missing or invalid', async () => {
    expect((await post({ ...base, start_date: undefined })).status).toBe(400);
    expect((await post({ ...base, start_date: 'not-a-date' })).status).toBe(400);
    expect((await post({ ...base, start_date: '2026-13-40' })).status).toBe(400);
  });

  it('400 when project_length_days is missing or not an integer >= 1', async () => {
    expect((await post({ ...base, project_length_days: undefined })).status).toBe(400);
    expect((await post({ ...base, project_length_days: 0 })).status).toBe(400);
    expect((await post({ ...base, project_length_days: 2.5 })).status).toBe(400);
    expect((await post({ ...base, project_length_days: -3 })).status).toBe(400);
  });

  it('400 when a new code is missing name or pm_id', async () => {
    const pmId = getIds().users.pm;
    expect((await post({ ...base, pm_id: pmId })).status).toBe(400); // no name
    expect((await post({ ...base, name: 'X' })).status).toBe(400);   // no pm_id
  });

  it('400 when pm_id is not an active project_manager or admin', async () => {
    const fieldId = getIds().users.field; // role field_staff — cannot own a project
    const res = await post({ ...base, name: 'Bad PM', pm_id: fieldId });
    expect(res.status).toBe(400);

    // Deactivated PM also rejected.
    const pmId = getIds().users.pm;
    await db('users').where('id', pmId).update({ active: false });
    const res2 = await post({ ...base, name: 'Inactive PM', pm_id: pmId });
    expect(res2.status).toBe(400);

    // Nothing was written.
    expect(await db('project_numbers').where('number', base.project_code).first()).toBeUndefined();
  });

  it('403 for a role lacking the schedule-edit permission', async () => {
    const res = await post({ ...base, name: 'X', pm_id: getIds().users.pm }, 'shop');
    expect(res.status).toBe(403);
  });
});
