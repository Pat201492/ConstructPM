/**
 * POST /api/projects/:id/email-day — issue #65
 *
 * Default path must send exactly ONE NotificationService.sendEmail call
 * per request, `to` holding every assigned-crew email for that date, and
 * the project PM cc'd. The compose path (override_* / extra_cc supplied)
 * must merge the PM into `cc` alongside `extra_cc`. Either way, an address
 * appears at most once across to+cc.
 *
 * Per-crew in-app notifications (NotificationService.send) are untouched —
 * still one call per assigned worker, on both paths.
 *
 * Emails are randomised per run (not just per test) because the test
 * database is not guaranteed to be wiped between suite runs — only
 * truncated reference data would be lost, so fixtures must tolerate
 * reruns without hitting the `users.email` unique constraint.
 */

const crypto = require('crypto');
const request = require('supertest');
const { setupSuite, teardownSuite, getIds } = require('../helpers/setup');
const { authHeader } = require('../helpers/auth');

describe('POST /:id/email-day', () => {
  let app;
  let db;
  let ids;
  let NotificationService;
  // `email` is unique + notNullable — shared across the two "no email on
  // file" scenarios below so at most one row ever holds the empty string.
  let noEmailUser;

  beforeAll(async () => {
    const suite = await setupSuite();
    app = suite.app;
    db = suite.db;
    ids = getIds();
    NotificationService = require('../../src/services/NotificationService');

    noEmailUser = await db('users').where('email', '').first();
    if (!noEmailUser) {
      noEmailUser = await makeUser('', 'NoEmail');
    }
  }, 30000);

  afterAll(async () => {
    await teardownSuite();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  let dateCounter = 0;
  function nextDate() {
    dateCounter += 1;
    return `2026-11-${String(10 + dateCounter).padStart(2, '0')}`;
  }

  function uniqueEmail(label) {
    return `${label}.${crypto.randomUUID()}@test.com`;
  }

  async function makeUser(email, firstName) {
    const [u] = await db('users')
      .insert({
        email,
        password_hash: 'x',
        first_name: firstName,
        last_name: 'Test',
        role: 'field_staff',
        active: true,
      })
      .returning('*');
    return u;
  }

  async function makeProject(name, pmId) {
    const [p] = await db('projects')
      .insert({ name, year: 2026, pm_id: pmId })
      .returning('*');
    return p;
  }

  async function assign(projectId, workerId, date) {
    await db('worker_assignments').insert({ project_id: projectId, worker_id: workerId, work_date: date });
  }

  test('default path: exactly one sendEmail call, to = all crew emails, cc = PM; one in-app notification per crew member', async () => {
    const pm = await db('users').where('id', ids.users.pm).first();
    const project = await makeProject('Email Day A', pm.id);
    const date = nextDate();

    const w1 = await makeUser(uniqueEmail('crew1'), 'Crew1');
    const w2 = await makeUser(uniqueEmail('crew2'), 'Crew2');
    const w3 = await makeUser(uniqueEmail('crew3'), 'Crew3');
    await Promise.all([w1, w2, w3].map((w) => assign(project.id, w.id, date)));

    const sendEmailSpy = jest.spyOn(NotificationService, 'sendEmail');
    const sendSpy = jest.spyOn(NotificationService, 'send');

    const auth = await authHeader(app, 'admin');
    const res = await request(app)
      .post(`/api/projects/${project.id}/email-day`)
      .set('Authorization', auth)
      .send({ date });

    expect(res.status).toBe(200);
    expect(res.body.sent_to).toBe(3);

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const { to, cc } = sendEmailSpy.mock.calls[0][0];
    expect([...to].sort()).toEqual([w1.email, w2.email, w3.email].sort());
    expect(cc).toEqual([pm.email]);

    expect(sendSpy).toHaveBeenCalledTimes(3);
    const notifiedIds = sendSpy.mock.calls.map((c) => c[0].userId).sort();
    expect(notifiedIds).toEqual([w1.id, w2.id, w3.id].sort());
  });

  test('default path: crew member with no email is skipped from `to` but still gets an in-app notification', async () => {
    const pm = await db('users').where('id', ids.users.pm).first();
    const project = await makeProject('Email Day B', pm.id);
    const date = nextDate();

    const withEmail = await makeUser(uniqueEmail('crew4'), 'Crew4');
    await Promise.all([withEmail, noEmailUser].map((w) => assign(project.id, w.id, date)));

    const sendEmailSpy = jest.spyOn(NotificationService, 'sendEmail');
    const sendSpy = jest.spyOn(NotificationService, 'send');

    const auth = await authHeader(app, 'admin');
    const res = await request(app)
      .post(`/api/projects/${project.id}/email-day`)
      .set('Authorization', auth)
      .send({ date });

    expect(res.status).toBe(200);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const { to } = sendEmailSpy.mock.calls[0][0];
    expect(to).toEqual([withEmail.email]);

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  test('default path: PM also assigned as crew — their address appears exactly once (in `to`, not cc)', async () => {
    const pm = await db('users').where('id', ids.users.pm).first();
    const project = await makeProject('Email Day C', pm.id);
    const date = nextDate();

    const w1 = await makeUser(uniqueEmail('crew5'), 'Crew5');
    await assign(project.id, w1.id, date);
    await assign(project.id, pm.id, date); // PM is also on the crew list

    const sendEmailSpy = jest.spyOn(NotificationService, 'sendEmail');

    const auth = await authHeader(app, 'admin');
    const res = await request(app)
      .post(`/api/projects/${project.id}/email-day`)
      .set('Authorization', auth)
      .send({ date });

    expect(res.status).toBe(200);
    const { to, cc } = sendEmailSpy.mock.calls[0][0];
    expect([...to].sort()).toEqual([w1.email, pm.email].sort());
    // PM already in `to` — must NOT also appear in cc (would be a duplicate).
    expect(cc).toBeUndefined();
  });

  test('default path: PM with no email on file — send still succeeds, cc omitted', async () => {
    const project = await makeProject('Email Day D', noEmailUser.id);
    const date = nextDate();

    const w1 = await makeUser(uniqueEmail('crew6'), 'Crew6');
    await assign(project.id, w1.id, date);

    const sendEmailSpy = jest.spyOn(NotificationService, 'sendEmail');

    const auth = await authHeader(app, 'admin');
    const res = await request(app)
      .post(`/api/projects/${project.id}/email-day`)
      .set('Authorization', auth)
      .send({ date });

    expect(res.status).toBe(200);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const { to, cc } = sendEmailSpy.mock.calls[0][0];
    expect(to).toEqual([w1.email]);
    expect(cc).toBeUndefined();
  });

  test('compose path: PM merged into cc alongside extra_cc, deduped (PM already in extra_cc)', async () => {
    const pm = await db('users').where('id', ids.users.pm).first();
    const project = await makeProject('Email Day E', pm.id);
    const date = nextDate();

    const w1 = await makeUser(uniqueEmail('crew7'), 'Crew7');
    await assign(project.id, w1.id, date);

    const sendEmailSpy = jest.spyOn(NotificationService, 'sendEmail');

    const auth = await authHeader(app, 'admin');
    const res = await request(app)
      .post(`/api/projects/${project.id}/email-day`)
      .set('Authorization', auth)
      .send({
        date,
        override_subject: 'Custom subject',
        override_body_html: '<p>Custom body</p>',
        extra_cc: ['extra@test.com', pm.email],
      });

    expect(res.status).toBe(200);
    expect(res.body.composed).toBe(true);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const { to, cc } = sendEmailSpy.mock.calls[0][0];
    expect(to).toEqual([w1.email]);
    expect([...cc].sort()).toEqual(['extra@test.com', pm.email].sort());
    // No duplicates even though extra_cc already contained the PM's address.
    expect(new Set(cc.map((e) => e.toLowerCase())).size).toBe(cc.length);
  });

  test('compose path: PM merged into cc when extra_cc is absent', async () => {
    const pm = await db('users').where('id', ids.users.pm).first();
    const project = await makeProject('Email Day F', pm.id);
    const date = nextDate();

    const w1 = await makeUser(uniqueEmail('crew8'), 'Crew8');
    await assign(project.id, w1.id, date);

    const sendEmailSpy = jest.spyOn(NotificationService, 'sendEmail');

    const auth = await authHeader(app, 'admin');
    const res = await request(app)
      .post(`/api/projects/${project.id}/email-day`)
      .set('Authorization', auth)
      .send({ date, override_to: [w1.email], override_subject: 'Custom' });

    expect(res.status).toBe(200);
    const { cc } = sendEmailSpy.mock.calls[0][0];
    expect(cc).toEqual([pm.email]);
  });
});
