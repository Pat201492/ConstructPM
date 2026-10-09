/**
 * Scheduler routes — top-level scheduler endpoints that span workers
 * rather than living under a single project.
 *
 *   GET  /api/scheduler/by-worker?from=&to=     — grid feed for By-Worker view
 *   PATCH /api/scheduler/assignments/reorder    — set order_index for one
 *                                                  worker on one date
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

// ═══════════════════════════════════════════════════════════
// ADD-BY-CODE — look up / schedule a project by its project code
// ═══════════════════════════════════════════════════════════
//
// GET  /api/scheduler/project-code/:code  — exact, case-insensitive
//        match on project_numbers.number (NO name fallback, unlike
//        GET /api/projects/lookup which fuzzy-matches names).
// POST /api/scheduler/projects            — set schedule fields on an
//        existing project, or create a brand-new one if the code is
//        unknown.
//
// Both are gated with the SAME permission as PATCH /api/projects/:id/
// schedule ('projects:update'), so the set of roles that can edit a
// project's schedule and the set that can add one by code stay in sync.

// GET /api/scheduler/project-code/:code
//
// Returns { exists:false } when nothing matches the code exactly, or
// { exists:true, project:{...} } with the fields the Add-to-Schedule
// dialog needs to pre-fill. A code that only matches a project NAME
// (not a project_numbers.number) is treated as not-found — this route
// is deliberately exact-match only.
router.get('/project-code/:code', authorize('projects:update'), async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'code is required' });

    const project = await db('project_numbers as pn')
      .join('projects as p', 'pn.project_id', 'p.id')
      .leftJoin('users as u', 'p.pm_id', 'u.id')
      .leftJoin('project_schedule_overrides as o', 'p.id', 'o.project_id')
      .whereRaw('LOWER(pn.number) = LOWER(?)', [code])
      .select(
        'p.id', 'p.name', 'p.status', 'p.pm_id',
        db.raw("u.first_name || ' ' || u.last_name as pm_name"),
        'p.start_date', 'p.project_length_days',
        db.raw('COALESCE(o.works_saturday, false) as works_saturday'),
        db.raw('COALESCE(o.works_sunday, false) as works_sunday'),
      )
      .first();

    if (!project) return res.json({ exists: false });
    return res.json({ exists: true, project });
  } catch (err) {
    console.error('[scheduler/project-code]', err.message);
    next(err);
  }
});

// POST /api/scheduler/projects
//
// Body: { project_code, start_date, project_length_days,
//         works_saturday, works_sunday, name?, pm_id? }
//
//   - Existing code → set projects.start_date + project_length_days and
//     upsert the works_saturday/works_sunday overrides. Rejected with
//     409 if the project's status is not active/on_hold (nothing is
//     written in that case).
//   - Unknown code → requires name + pm_id; creates projects +
//     project_numbers (label 'Primary') + overrides in ONE transaction,
//     so a failure on any insert leaves no orphan project row.
router.post('/projects', authorize('projects:update'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const code = String(body.project_code || '').trim();
    if (!code) return res.status(400).json({ error: 'project_code is required' });

    // start_date — must be a real YYYY-MM-DD calendar date.
    const start_date = String(body.start_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || Number.isNaN(Date.parse(start_date))) {
      return res.status(400).json({ error: 'start_date must be a valid YYYY-MM-DD date' });
    }

    // project_length_days — integer >= 1.
    const lengthRaw = body.project_length_days;
    const project_length_days = Number(lengthRaw);
    if (lengthRaw === undefined || lengthRaw === null || lengthRaw === '' ||
        !Number.isInteger(project_length_days) || project_length_days < 1) {
      return res.status(400).json({ error: 'project_length_days must be an integer >= 1' });
    }

    const works_saturday = !!body.works_saturday;
    const works_sunday = !!body.works_sunday;

    // Does the code already exist? (exact, case-insensitive)
    const existing = await db('project_numbers as pn')
      .join('projects as p', 'pn.project_id', 'p.id')
      .whereRaw('LOWER(pn.number) = LOWER(?)', [code])
      .select('p.id', 'p.status')
      .first();

    // ── Existing project: update schedule fields only ──────────
    if (existing) {
      if (!['active', 'on_hold'].includes(existing.status)) {
        return res.status(409).json({
          error: `Project status is "${existing.status}"; only active or on_hold projects can be scheduled.`,
        });
      }

      await db.transaction(async (trx) => {
        await trx('projects')
          .where('id', existing.id)
          .update({ start_date, project_length_days, updated_at: trx.fn.now() });

        const override = await trx('project_schedule_overrides')
          .where('project_id', existing.id).first();
        if (override) {
          await trx('project_schedule_overrides')
            .where('project_id', existing.id)
            .update({ works_saturday, works_sunday, updated_at: trx.fn.now() });
        } else {
          await trx('project_schedule_overrides')
            .insert({ project_id: existing.id, works_saturday, works_sunday });
        }
      });

      return res.json({
        created: false,
        project: { id: existing.id, start_date, project_length_days, works_saturday, works_sunday },
      });
    }

    // ── Unknown code: create a new project ─────────────────────
    const name = String(body.name || '').trim();
    const pm_id = body.pm_id;
    if (!name) return res.status(400).json({ error: 'name is required to create a new project' });
    if (!pm_id) return res.status(400).json({ error: 'pm_id is required to create a new project' });

    // The PM owner must be an active user whose role can own projects.
    const pm = await db('users').where('id', pm_id).first();
    if (!pm || !pm.active || !['project_manager', 'admin'].includes(pm.role)) {
      return res.status(400).json({ error: 'pm_id must be an active project_manager or admin' });
    }

    const year = parseInt(start_date.slice(0, 4), 10);

    const project = await db.transaction(async (trx) => {
      const [row] = await trx('projects').insert({
        name,
        pm_id,
        year,
        status: 'active',
        start_date,
        project_length_days,
      }).returning('*');

      await trx('project_numbers').insert({
        project_id: row.id,
        number: code,
        label: 'Primary',
      });

      await trx('project_schedule_overrides').insert({
        project_id: row.id,
        works_saturday,
        works_sunday,
      });

      return row;
    });

    return res.status(201).json({
      created: true,
      project: {
        id: project.id, name: project.name, status: project.status, pm_id: project.pm_id,
        start_date, project_length_days, works_saturday, works_sunday,
      },
    });
  } catch (err) {
    console.error('[scheduler/projects]', err.message);
    next(err);
  }
});

module.exports = router;
