/**
 * Scheduler routes — top-level scheduler endpoints that span workers
 * rather than living under a single project.
 *
 *   GET  /api/scheduler/by-worker?from=&to=        — grid feed for By-Worker view
 *   PATCH /api/scheduler/assignments/reorder       — set order_index for one
 *                                                     worker on one date
 *   GET  /api/scheduler/project-code/:code         — exact-code project lookup
 *   POST /api/scheduler/projects                   — add/schedule a project by
 *                                                     code (create if missing)
 *
 * Per-project assignment CRUD lives under /api/projects/:id/assignments/*.
 *
 * Permission: scheduler + admin can read AND write. PMs get read-only
 * (so they can see the worker grid for their own projects' staffing) —
 * write actions go through the per-project routes which already enforce
 * their own ownership rules.
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

// pg returns DATE columns as JS Date objects. `String(date).slice(0, 10)`
// gives "Mon May 11" rather than "2026-05-11" — see projects.js:ymd for the
// bug this avoids. Use this helper for any DATE column read in this file.
function ymd(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

// All scheduler routes require an authenticated user. Without this,
// authorize() throws because req.user is undefined — every request
// returned 401 even with a valid token. Matches the pattern used by
// every other route file (projects.js, users.js, admin.js, bids.js).
router.use(authenticate);

// GET /api/scheduler/by-worker?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns assignments grouped by worker for a date range, joined with
// project info so the grid can render the project number per cell. Only
// includes workers marked on_schedule + active — the same filter the
// picker uses, so the grid stays consistent.
//
// Response shape:
//   {
//     workers: [{ id, first_name, last_name, role, initials }],
//     assignments: [{
//       id, worker_id, project_id, work_date, order_index,
//       project_number, project_name, project_color_seed
//     }]
//   }
//
// The frontend pivots assignments into a {worker × date} grid and
// computes the "Multiple" / extended-stack rendering from there.
router.get('/by-worker', authorize('projects:read'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });

    // Permission narrowing: scheduler + admin see everyone; PMs see only
    // workers assigned to their own projects (filter on assignment level
    // by project ownership).
    const isFullView = ['admin', 'scheduler'].includes(req.user.role);

    const workers = await db('users')
      .select('id', 'first_name', 'last_name', 'role', 'initials')
      .where('on_schedule', true)
      .where('active', true)
      .orderBy('first_name');

    const assignmentsQuery = db('worker_assignments as wa')
      .select(
        'wa.id', 'wa.worker_id', 'wa.project_id', 'wa.work_date', 'wa.order_index',
        'pn.number as project_number',
        'projects.name as project_name',
      )
      .leftJoin('projects', 'wa.project_id', 'projects.id')
      .leftJoin(
        db('project_numbers').select('project_id', 'number').where('label', 'Primary').as('pn'),
        'wa.project_id', 'pn.project_id'
      )
      .whereBetween('wa.work_date', [from, to])
      .orderBy(['wa.worker_id', 'wa.work_date', 'wa.order_index']);

    if (!isFullView) {
      assignmentsQuery.where('projects.pm_id', req.user.id);
    }

    const assignments = await assignmentsQuery;

    res.json({ workers, assignments });
  } catch (err) {
    console.error('[scheduler/by-worker]', err.message);
    next(err);
  }
});

// PATCH /api/scheduler/assignments/reorder
//
// Body: { worker_id, work_date, ordered_assignment_ids: [id1, id2, ...] }
//
// Re-numbers the order_index for the given worker's assignments on the
// given date based on the supplied id order. Idempotent — safe to call
// repeatedly with the same array. Validates that every supplied id
// belongs to the (worker_id, work_date) group; rejects with 400 if any
// stray ids are present.
router.patch('/assignments/reorder', authorize('projects:update'), async (req, res, next) => {
  try {
    const { worker_id, work_date, ordered_assignment_ids } = req.body || {};
    if (!worker_id || !work_date || !Array.isArray(ordered_assignment_ids)) {
      return res.status(400).json({ error: 'worker_id, work_date, and ordered_assignment_ids are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
      return res.status(400).json({ error: 'work_date must be YYYY-MM-DD' });
    }

    // Validate all ids belong to this (worker_id, work_date) group
    const existing = await db('worker_assignments')
      .where({ worker_id, work_date })
      .select('id');
    const existingIds = new Set(existing.map(r => r.id));
    for (const id of ordered_assignment_ids) {
      if (!existingIds.has(id)) {
        return res.status(400).json({ error: `assignment id ${id} does not belong to this worker on ${work_date}` });
      }
    }

    // Re-number atomically
    await db.transaction(async (trx) => {
      for (let i = 0; i < ordered_assignment_ids.length; i++) {
        await trx('worker_assignments')
          .where('id', ordered_assignment_ids[i])
          .update({ order_index: i, updated_at: trx.fn.now() });
      }
    });

    res.json({ reordered: ordered_assignment_ids.length });
  } catch (err) {
    console.error('[scheduler/reorder]', err.message);
    next(err);
  }
});

// GET /api/scheduler/project-code/:code
//
// Case-insensitive EXACT match on project_numbers.number — no name
// fallback (unlike GET /api/projects/lookup, which is tuned for the
// mobile foreman flow and fuzzy-matches on project name too; that's
// wrong here since the calendar's "add by code" box must only ever
// resolve a code to the one project that code actually belongs to).
//
// Guarded with the same permission as PATCH /api/projects/:id/schedule
// (projects:update) since this lookup only exists to feed that same
// add/schedule flow.
router.get('/project-code/:code', authorize('projects:update'), async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.json({ exists: false });

    const pnRow = await db('project_numbers')
      .whereRaw('LOWER(number) = LOWER(?)', [code])
      .first();
    if (!pnRow) return res.json({ exists: false });

    const project = await db('projects')
      .leftJoin('users', 'projects.pm_id', 'users.id')
      .where('projects.id', pnRow.project_id)
      .select(
        'projects.id', 'projects.name', 'projects.status', 'projects.pm_id',
        'projects.start_date', 'projects.project_length_days',
        db.raw("users.first_name || ' ' || users.last_name as pm_name"),
      )
      .first();
    if (!project) return res.json({ exists: false });

    const overrides = await db('project_schedule_overrides').where('project_id', project.id).first();

    res.json({
      exists: true,
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        pm_id: project.pm_id,
        pm_name: project.pm_name,
        start_date: ymd(project.start_date),
        project_length_days: project.project_length_days,
        works_saturday: overrides?.works_saturday || false,
        works_sunday: overrides?.works_sunday || false,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/scheduler/projects
//
// Body: { project_code, start_date, project_length_days, works_saturday,
//          works_sunday, name?, pm_id? }
//
// Add a project to the Schedule calendar by its code:
//   - Code matches an existing project (project_numbers.number, exact,
//     case-insensitive) → update its start_date/project_length_days and
//     upsert its schedule overrides. Rejected with 409 if the project's
//     status isn't active/on_hold.
//   - Code matches nothing → create the project (requires name + pm_id),
//     its Primary project_numbers row, and its overrides row, all in one
//     transaction.
//
// Guarded with the same permission as PATCH /api/projects/:id/schedule.
router.post('/projects', authorize('projects:update'), async (req, res, next) => {
  try {
    const { project_code, start_date, project_length_days, works_saturday, works_sunday, name, pm_id } = req.body || {};

    const code = String(project_code || '').trim();
    if (!code) return res.status(400).json({ error: 'project_code is required' });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date || '')) || Number.isNaN(Date.parse(start_date))) {
      return res.status(400).json({ error: 'start_date must be a valid YYYY-MM-DD date' });
    }

    const length = Number(project_length_days);
    if (!Number.isInteger(length) || length < 1) {
      return res.status(400).json({ error: 'project_length_days must be an integer >= 1' });
    }

    const worksSaturday = !!works_saturday;
    const worksSunday = !!works_sunday;

    const pnRow = await db('project_numbers').whereRaw('LOWER(number) = LOWER(?)', [code]).first();

    // ── Existing project: update its schedule fields ──
    if (pnRow) {
      const project = await db('projects').where('id', pnRow.project_id).first();
      if (!project) return res.status(404).json({ error: 'Not found' });

      if (!['active', 'on_hold'].includes(project.status)) {
        return res.status(409).json({
          error: `Project status is "${project.status}" — only active or on_hold projects can be scheduled`,
        });
      }

      await db.transaction(async (trx) => {
        await trx('projects').where('id', project.id).update({
          start_date, project_length_days: length, updated_at: trx.fn.now(),
        });

        const existingOverrides = await trx('project_schedule_overrides').where('project_id', project.id).first();
        if (existingOverrides) {
          await trx('project_schedule_overrides').where('project_id', project.id).update({
            works_saturday: worksSaturday, works_sunday: worksSunday, updated_at: trx.fn.now(),
          });
        } else {
          await trx('project_schedule_overrides').insert({
            project_id: project.id, works_saturday: worksSaturday, works_sunday: worksSunday,
          });
        }
      });

      return res.json({
        created: false,
        project: {
          id: project.id, name: project.name, status: project.status, pm_id: project.pm_id,
          start_date, project_length_days: length,
          works_saturday: worksSaturday, works_sunday: worksSunday,
        },
      });
    }

    // ── Unknown code: create the project ──
    const projectName = String(name || '').trim();
    if (!projectName || !pm_id) {
      return res.status(400).json({ error: 'name and pm_id are required to create a new project from an unknown code' });
    }
    if (!/^[0-9a-f-]{36}$/i.test(String(pm_id))) {
      return res.status(400).json({ error: 'pm_id must be an active user with role project_manager or admin' });
    }

    const pm = await db('users').where('id', pm_id).first();
    if (!pm || !pm.active || !['project_manager', 'admin'].includes(pm.role)) {
      return res.status(400).json({ error: 'pm_id must be an active user with role project_manager or admin' });
    }

    const year = new Date(start_date).getUTCFullYear();

    const project = await db.transaction(async (trx) => {
      const [created] = await trx('projects').insert({
        name: projectName, pm_id, year, status: 'active',
        start_date, project_length_days: length,
      }).returning('*');

      await trx('project_schedule_overrides').insert({
        project_id: created.id, works_saturday: worksSaturday, works_sunday: worksSunday,
      });

      // Last — a project_code too long for project_numbers.number (varchar
      // 100) fails here and rolls back the project + overrides rows too.
      await trx('project_numbers').insert({
        project_id: created.id, number: code, label: 'Primary',
      });

      return created;
    });

    res.status(201).json({
      created: true,
      project: {
        id: project.id, name: project.name, status: project.status, pm_id: project.pm_id,
        start_date, project_length_days: length,
        works_saturday: worksSaturday, works_sunday: worksSunday,
      },
    });
  } catch (err) {
    console.error('[scheduler/projects]', err.message);
    next(err);
  }
});

module.exports = router;
