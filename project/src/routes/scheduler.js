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

module.exports = router;
