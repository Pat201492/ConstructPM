/**
 * Integration tests for POST /api/projects/:id/email-day (issue #65).
 *
 * The Scheduler's "Email Day" action must send ONE email per project/day:
 *   - crew members' addresses in `to`
 *   - the project PM's address always in `cc`
 *   - no address duplicated across to+cc
 * while still creating one in-app notification per crew member.
 *
 * We spy on NotificationService.sendEmail (the real send is a no-op in the
 * test env since no EMAIL_PROVIDER is configured) to assert the call count
 * and the exact to/cc recipient lists.
 */

const request = require('supertest');
const {
  setupSuite,
  teardownSuite,
  resetAndSeed,
  getApp,
  getDb,
  getIds,
} = require('../helpers/setup');
const { authHeader, clearTokenCache } = require('../helpers/auth');
const NotificationService = require('../../src/services/NotificationService');

let app;
let db;

// Normalize a to/cc argument (string | string[] | undefined) to a lowercase
// array for order-independent assertions.
function addrs(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map(s => String(s).trim().toLowerCase()).filter(Boolean);
}

async function makeWorker(email) {
  const [u] = await db('users')
    .insert({
      email,
      password_hash: 'x',
      first_name: 'Crew',
      last_name: email.split('@')[0],
      role: 'field_staff',
      active: true,
      notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
    })
    .returning('*');
  return u.id;
}

async function makeProject(pmId) {
  const [p] = await db('projects')
    .insert({
      name: 'Email Day Test Project',
      year: 2026,
      status: 'active',
      customer_id: getIds().customer,
      pm_id: pmId,
    })
    .returning('*');
  await db('project_numbers').insert({
    project_id: p.id,
    label: 'Primary',
    number: 'M26-TEST',
  });
  return p.id;
}

async function assign(projectId, workerId, date) {
  await db('worker_assignments').insert({
    project_id: projectId,
    worker_id: workerId,
    work_date: date,
  });
}

const DATE = '2026-06-15';

// The shared truncateAll() (TRUNCATE ... CASCADE) empties email_templates,
// but the default email-day path renders the `email_day_to_staff` template
// (always present in a real install via migration). Re-seed it after each
// reset so the default path has a template to render.
async function ensureDayTemplate() {
  await db('email_templates')
    .insert({
      key: 'email_day_to_staff',
      name: 'Scheduler — Email Day to Staff',
      subject: 'Schedule: {{project_number}} on {{date}}',
      body_html: '<p>Crew for {{project_name}} ({{project_number}}) on {{date}}.</p><p>{{day_notes}}</p>',
      body_text: 'Crew for {{project_name}} ({{project_number}}) on {{date}}.\n{{day_notes}}',
      variables: JSON.stringify([]),
    })
    .onConflict('key')
    .merge();
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
  await resetAndSeed();
  await ensureDayTemplate();
  clearTokenCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/projects/:id/email-day — default path', () => {
  test('sends exactly ONE email with all crew in `to` and the PM in `cc`', async () => {
    const pmId = getIds().users.pm; // pm@test.com
    const projectId = await makeProject(pmId);

    const w1 = await makeWorker('crew1@test.com');
    const w2 = await makeWorker('crew2@test.com');
    const w3 = await makeWorker('crew3@test.com');
    await assign(projectId, w1, DATE);
    await assign(projectId, w2, DATE);
    await assign(projectId, w3, DATE);

    const spy = jest.spyOn(NotificationService, 'sendEmail');

    const res = await request(app)
      .post(`/api/projects/${projectId}/email-day`)
      .set('Authorization', await authHeader(app, 'admin'))
      .send({ date: DATE });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    const arg = spy.mock.calls[0][0];
    expect(addrs(arg.to).sort()).toEqual(
      ['crew1@test.com', 'crew2@test.com', 'crew3@test.com'].sort(),
    );
    expect(addrs(arg.cc)).toEqual(['pm@test.com']);

    // One in-app notification per crew member (none for the PM).
    const notes = await db('notifications')
      .whereIn('user_id', [w1, w2, w3])
      .where('channel', 'in_app');
    expect(notes).toHaveLength(3);
  });

  test('crew member without an email is skipped, not errored', async () => {
    const pmId = getIds().users.pm;
    const projectId = await makeProject(pmId);

    const withEmail = await makeWorker('hasmail@test.com');
    // A worker row with no email (empty string — the column is NOT NULL).
    const [noMail] = await db('users')
      .insert({
        email: '',
        password_hash: 'x',
        first_name: 'No',
        last_name: 'Mail',
        role: 'field_staff',
        active: true,
        notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
      })
      .returning('*');
    await assign(projectId, withEmail, DATE);
    await assign(projectId, noMail.id, DATE);

    const spy = jest.spyOn(NotificationService, 'sendEmail');

    const res = await request(app)
      .post(`/api/projects/${projectId}/email-day`)
      .set('Authorization', await authHeader(app, 'admin'))
      .send({ date: DATE });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(addrs(spy.mock.calls[0][0].to)).toEqual(['hasmail@test.com']);
    // In-app still goes to both workers.
    const notes = await db('notifications')
      .whereIn('user_id', [withEmail, noMail.id])
      .where('channel', 'in_app');
    expect(notes).toHaveLength(2);
  });

  test('PM who is also on the crew appears exactly once (in `to`, not `cc`)', async () => {
    const pmId = getIds().users.pm; // pm@test.com
    const projectId = await makeProject(pmId);

    const w1 = await makeWorker('crewA@test.com');
    await assign(projectId, w1, DATE);
    await assign(projectId, pmId, DATE); // PM is also assigned

    const spy = jest.spyOn(NotificationService, 'sendEmail');

    const res = await request(app)
      .post(`/api/projects/${projectId}/email-day`)
      .set('Authorization', await authHeader(app, 'admin'))
      .send({ date: DATE });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    const arg = spy.mock.calls[0][0];
    const to = addrs(arg.to);
    const cc = addrs(arg.cc);
    expect(to.sort()).toEqual(['crewa@test.com', 'pm@test.com'].sort());
    expect(cc).not.toContain('pm@test.com');
    // Appears exactly once across to+cc.
    expect([...to, ...cc].filter(a => a === 'pm@test.com')).toHaveLength(1);
  });

  test('a PM with no email still lets the send succeed (no cc)', async () => {
    // Give the PM user no email (empty string — the column is NOT NULL).
    const pmId = getIds().users.pm;
    await db('users').where('id', pmId).update({ email: '' });
    const projectId = await makeProject(pmId);
    const w1 = await makeWorker('crewB@test.com');
    await assign(projectId, w1, DATE);

    const spy = jest.spyOn(NotificationService, 'sendEmail');

    const res = await request(app)
      .post(`/api/projects/${projectId}/email-day`)
      .set('Authorization', await authHeader(app, 'admin'))
      .send({ date: DATE });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(addrs(spy.mock.calls[0][0].to)).toEqual(['crewb@test.com']);
    expect(addrs(spy.mock.calls[0][0].cc)).toEqual([]);
  });
});

describe('POST /api/projects/:id/email-day — compose path', () => {
  test('extra_cc is merged with the PM, deduped, with PM also added', async () => {
    const pmId = getIds().users.pm; // pm@test.com
    const projectId = await makeProject(pmId);
    const w1 = await makeWorker('crewC@test.com');
    await assign(projectId, w1, DATE);

    const spy = jest.spyOn(NotificationService, 'sendEmail');

    const res = await request(app)
      .post(`/api/projects/${projectId}/email-day`)
      .set('Authorization', await authHeader(app, 'admin'))
      .send({
        date: DATE,
        override_subject: 'Custom subject',
        override_body_html: '<p>Hi {{project.primary_number}}</p>',
        extra_cc: ['boss@test.com'],
      });

    expect(res.status).toBe(200);
    expect(res.body.composed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    const arg = spy.mock.calls[0][0];
    expect(addrs(arg.to)).toEqual(['crewc@test.com']);
    expect(addrs(arg.cc).sort()).toEqual(['boss@test.com', 'pm@test.com'].sort());
  });

  test('compose path dedupes the PM when extra_cc already lists them', async () => {
    const pmId = getIds().users.pm; // pm@test.com
    const projectId = await makeProject(pmId);
    const w1 = await makeWorker('crewD@test.com');
    await assign(projectId, w1, DATE);

    const spy = jest.spyOn(NotificationService, 'sendEmail');

    const res = await request(app)
      .post(`/api/projects/${projectId}/email-day`)
      .set('Authorization', await authHeader(app, 'admin'))
      .send({
        date: DATE,
        override_subject: 'Custom subject',
        extra_cc: ['pm@test.com', 'boss@test.com'],
      });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    const cc = addrs(spy.mock.calls[0][0].cc);
    expect(cc.filter(a => a === 'pm@test.com')).toHaveLength(1);
    expect(cc.sort()).toEqual(['boss@test.com', 'pm@test.com'].sort());
  });
});
