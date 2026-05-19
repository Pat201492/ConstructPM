/**
 * Project Routes (v2)
 * 
 * Project lifecycle: active → on_hold → completed / cancelled
 * Close-out: auto-notification when revenue >= contract_value + manual close button
 * Contract type: Contract vs T&M (set from notification after Contract upload)
 * Multiple project numbers per project (configurable rules)
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const Project = require('../models/Project');
const ProjectNumber = require('../models/ProjectNumber');
const FileService = require('../services/FileService');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { ROLES } = require('../config/roles');

const db = require('../config/database');

// pg returns DATE columns as JS Date objects. `String(date).slice(0, 10)`
// gives "Mon May 11" rather than "2026-05-11" — the bug Pat hit when
// Copy-Day reported "source_date is not a working day" on a valid date.
// Use this helper for any DATE column we want as YYYY-MM-DD downstream.
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

const router = express.Router();
router.use(authenticate);

// Helper: resolve project visibility for current user
async function resolveProjectVisibility(user) {
  const roleConfig = await db('role_configurations').where('role_name', user.role).first();
  const userAccess = user.access_config ? (typeof user.access_config === 'string' ? JSON.parse(user.access_config) : user.access_config) : {};
  return userAccess.project_visibility || roleConfig?.project_visibility || 'own';
}

// ═══════════════════════════════════════════════════════════
// LIST
// ═══════════════════════════════════════════════════════════

// Helper — annotate a list of projects with their primary project number
async function attachPrimaryNumbers(projectsList) {
  if (!projectsList || projectsList.length === 0) return projectsList;
  const ids = projectsList.map(p => p.id);
  const rows = await db('project_numbers')
    .whereIn('project_id', ids)
    .where('label', 'Primary')
    .select('project_id', 'number');
  const map = {};
  for (const r of rows) map[r.project_id] = r.number;
  for (const p of projectsList) p.project_number = map[p.id] || null;
  return projectsList;
}

/**
 * Recompute projects.percent_billed for a single project.
 *
 * Formula: (sum of non-cancelled invoice amounts / contract_value) × 100
 *
 * Called whenever an invoice is created, updated, or cancelled so the
 * stored value stays in sync with reality. The denormalized column lets
 * the projects list show "Billed %" without re-aggregating per row.
 *
 * If contract_value is 0 or null, percent_billed stays at 0.
 *
 * Module-exported because the financials route also mutates invoices
 * and needs to call this.
 */
async function recomputePercentBilled(projectId, trx) {
  const conn = trx || db;
  const project = await conn('projects').where('id', projectId).first();
  if (!project) return;
  if (!project.contract_value || parseFloat(project.contract_value) === 0) {
    await conn('projects').where('id', projectId).update({ percent_billed: 0 });
    return;
  }
  const totalRow = await conn('invoices')
    .where('project_id', projectId)
    .whereNot('status', 'cancelled')
    .sum('amount as total')
    .first();
  const total = parseFloat(totalRow?.total || 0);
  const pct = (total / parseFloat(project.contract_value)) * 100;
  await conn('projects').where('id', projectId).update({
    percent_billed: pct.toFixed(2),
  });
}
module.exports.recomputePercentBilled = recomputePercentBilled;

router.get('/', authorize('projects:read'), async (req, res, next) => {
  try {
    const filters = {
      year: req.query.year ? parseInt(req.query.year, 10) : undefined,
      customer_id: req.query.customer_id,
      status: req.query.status,
      search: req.query.search,
      limit: parseInt(req.query.limit, 10) || 50,
      offset: parseInt(req.query.offset, 10) || 0,
    };

    const visibility = await resolveProjectVisibility(req.user);

    if (visibility === 'none') return res.json({ projects: [], total: 0 });

    if (visibility === 'own') {
      const result = await Project.findAll({ ...filters, pm_id: req.user.id });
      await attachPrimaryNumbers(result.projects);
      return res.json(result);
    }

    if (visibility === 'assigned') {
      const assignedIds = await db('project_assignments').where({ user_id: req.user.id }).pluck('project_id');
      if (assignedIds.length === 0) return res.json({ projects: [], total: 0 });
      const result = await Project.findAll(filters);
      result.projects = result.projects.filter(p => assignedIds.includes(p.id));
      result.total = result.projects.length;
      await attachPrimaryNumbers(result.projects);
      return res.json(result);
    }

    if (visibility === 'originated') {
      const originatedBidIds = await db('bids').where('estimator_id', req.user.id).pluck('id');
      if (originatedBidIds.length === 0) return res.json({ projects: [], total: 0 });
      const result = await Project.findAll({ ...filters, bid_ids: originatedBidIds });
      await attachPrimaryNumbers(result.projects);
      return res.json(result);
    }

    // 'all' — no filter
    const result = await Project.findAll(filters);
    await attachPrimaryNumbers(result.projects);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// LOOKUP — validate a project reference (mobile foreman flow)
// ═══════════════════════════════════════════════════════════
//
// IMPORTANT: must be defined BEFORE /:id below; otherwise Express
// matches '/lookup' as ':id' and we get a UUID syntax error.

router.get('/lookup', authorize('projects:read'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref || '').trim();
    if (!ref) return res.json({ found: false, message: 'No reference provided' });
    if (ref.length < 2) return res.json({ found: false, message: 'Keep typing...' });

    const result = await ProjectNumber.lookup(ref);

    if (result.found) {
      // Slim the project payload down — foremen don't need financial info
      return res.json({
        found: true,
        project: {
          id: result.project.id,
          name: result.project.name,
          customer_name: result.project.customer_name,
          project_numbers: (result.project_numbers || []).map(n => n.number),
        },
      });
    }

    if (result.ambiguous) {
      return res.json({
        found: false,
        ambiguous: true,
        matches: result.matches.slice(0, 5).map(m => ({
          id: m.id,
          name: m.name,
          customer_name: m.customer_name,
        })),
        message: `${result.matches.length} matching projects — be more specific`,
      });
    }

    return res.json({ found: false, message: 'No active project found' });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// SUGGEST NUMBER — pre-fill the structured project number when marking a bid won
// ═══════════════════════════════════════════════════════════
//
// Query params: pm_id (required), location_id (required), year (optional, defaults to current)
// Returns: { suggestion, components } or { error }

router.get('/suggest-number', authorize('bids:update'), async (req, res, next) => {
  try {
    const { pm_id, location_id, year } = req.query;
    if (!pm_id || !location_id) {
      return res.status(400).json({ error: 'pm_id and location_id required' });
    }
    const result = await ProjectNumber.generateStructured(
      { pm_id, location_id, year: year ? parseInt(year, 10) : new Date().getFullYear() }
    );
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// RECENT — last N projects this user submitted to (mobile picker)
// ═══════════════════════════════════════════════════════════
//
// IMPORTANT: must be defined BEFORE /:id below; otherwise Express
// matches '/recent' as ':id' and we get a UUID syntax error.

router.get('/recent', authorize('projects:read'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);

    // Pull most-recent project IDs from each submission table the user authored,
    // unioned together, ordered by most recent activity, deduped.
    // Sources: field_notes (foreman_id), oil_sample_requests (foreman_id).
    // Add more as new submission types appear (e.g., timesheet_uploads).
    //
    // Returns active + on_hold projects only. No fallback — if the user has
    // never submitted, the list is empty and the mobile picker shows blank.
    const result = await db.raw(
      `
      WITH user_submissions AS (
        SELECT project_id, MAX(created_at) AS last_at
          FROM field_notes
         WHERE foreman_id = ?
         GROUP BY project_id
        UNION ALL
        SELECT project_id, MAX(created_at) AS last_at
          FROM oil_sample_requests
         WHERE foreman_id = ?
         GROUP BY project_id
      ),
      ranked AS (
        SELECT project_id, MAX(last_at) AS last_at
          FROM user_submissions
         GROUP BY project_id
      )
      SELECT p.id, p.name, p.status, p.contract_value, c.name AS customer_name, r.last_at
        FROM ranked r
        JOIN projects p ON p.id = r.project_id
        LEFT JOIN customers c ON c.id = p.customer_id
       WHERE p.status IN ('active', 'on_hold')
       ORDER BY r.last_at DESC
       LIMIT ?
      `,
      [req.user.id, req.user.id, limit]
    );

    const rows = result.rows || result;

    // Enrich with project_numbers so mobile can show "M26-1308.1" next to project name
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const numbers = await db('project_numbers').whereIn('project_id', ids).select('project_id', 'number', 'label');
      const byProject = {};
      for (const n of numbers) {
        if (!byProject[n.project_id]) byProject[n.project_id] = [];
        byProject[n.project_id].push(n.number);
      }
      for (const r of rows) {
        r.project_numbers = byProject[r.id] || [];
      }
    }

    res.json({ projects: rows, total: rows.length });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// SCHEDULER — projects with start_date in a date window
// ═══════════════════════════════════════════════════════════
//
// GET /api/projects/scheduled-list?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns projects with a start_date that overlap the given window.
// Includes per-project schedule overrides + key fields the calendar needs.
//
// Defined BEFORE /:id so Express doesn't try to match "scheduled-list"
// as a UUID parameter (per the route-ordering convention noted in
// CHANGELOG_FIXES.md).
router.get('/scheduled-list', authorize('projects:read'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });

    const primarySub = db('project_numbers')
      .select('project_id', 'number as primary_number')
      .where('label', 'Primary')
      .as('pn');

    const query = db('projects')
      .select(
        'projects.id', 'projects.name', 'projects.start_date',
        'projects.project_length_days', 'projects.manpower',
        'projects.pm_id', 'projects.status',
        'pn.primary_number',
        'customers.name as customer_name',
        'project_schedule_overrides.works_saturday',
        'project_schedule_overrides.works_sunday',
        'project_schedule_overrides.weekend_only',
        db.raw("users.first_name || ' ' || users.last_name as pm_name"),
      )
      .leftJoin(primarySub, 'projects.id', 'pn.project_id')
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .leftJoin('users', 'projects.pm_id', 'users.id')
      .leftJoin('project_schedule_overrides', 'projects.id', 'project_schedule_overrides.project_id')
      .whereNotNull('projects.start_date')
      .whereIn('projects.status', ['active', 'on_hold'])
      .where('projects.start_date', '<=', to)
      // Upper-bound overlap check. NOTE: project_length_days is in WORKING
      // days (M-F default), so the actual end-date in calendar terms is up
      // to ~length × 7/5 days after start. Multiplying by 2 here gives a
      // generous safety margin — the SQL acts as a coarse pre-filter, then
      // the frontend does precise working-day membership testing per cell.
      // Using the exact length here would mistakenly exclude long projects
      // still in their working-day window when calendar-day math says they
      // ended.
      .where(db.raw(
        `projects.start_date + ((COALESCE(projects.project_length_days, 1) * 2)::text || ' days')::interval >= ?::date`,
        [from]
      ));

    if (req.user.role === ROLES.PROJECT_MANAGER) {
      query.where('projects.pm_id', req.user.id);
    }

    const projects = await query.orderBy('projects.start_date');

    // Attach per-day fully_staffed dates so the calendar can render the
    // green ✓ per cell instead of project-wide. One round-trip total —
    // no N+1.
    if (projects.length > 0) {
      const ids = projects.map(p => p.id);
      const fsRows = await db('project_day_notes')
        .whereIn('project_id', ids)
        .where('fully_staffed', true)
        .whereBetween('work_date', [from, to])
        .select('project_id', 'work_date');
      const byProject = new Map();
      for (const r of fsRows) {
        const key = ymd(r.work_date);
        if (!byProject.has(r.project_id)) byProject.set(r.project_id, new Set());
        byProject.get(r.project_id).add(key);
      }
      for (const p of projects) {
        p.fully_staffed_dates = Array.from(byProject.get(p.id) || []);
      }
    }

    res.json({ projects });
  } catch (err) {
    // Log the actual SQL/db error before next() swallows it into a
    // generic 500. Future scheduler failures will appear in docker logs
    // with the full message.
    console.error('[scheduled-list]', err.message, err.stack);
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// DETAIL
// ═══════════════════════════════════════════════════════════

router.get('/:id', authorize('projects:read'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    // Access scoping
    if (req.user.role === ROLES.PROJECT_MANAGER && project.pm_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if ([ROLES.FIELD_STAFF, ROLES.SHOP_STAFF].includes(req.user.role)) {
      const assigned = await Project.isAssigned(project.id, req.user.id);
      if (!assigned) return res.status(403).json({ error: 'Forbidden' });
    }

    // Get related data
    const [assignments, projectNumbers, financials] = await Promise.all([
      Project.getAssignments(project.id),
      ProjectNumber.findByProject(project.id),
      Project.getFinancials(project.id),
    ]);

    // List files in project subfolders
    let files = {};
    if (project.folder_path) {
      const path = require('path');
      const subfolders = ['invoices', 'timesheets', 'purchase_orders', 'Contract'];
      for (const sub of subfolders) {
        try {
          files[sub] = await FileService.listFiles(path.join(project.folder_path, sub));
        } catch { files[sub] = []; }
      }
    }

    // Project notes are payment/admin-tracking content — PM-owner,
    // accounting, admin, and superadmin only. Strip from response for
    // anyone else (field/shop staff, estimator, scheduler) so the
    // textarea isn't even populated on their detail page.
    //
    // is_superadmin isn't in the JWT (would require a re-login on
    // grant) so fetch it directly for this check. Single-row read on
    // a single-project GET is fine.
    const NOTE_VIEWING_ROLES = [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING];
    const me = await db('users').select('is_superadmin').where('id', req.user.id).first();
    const canSeeNotes =
      me?.is_superadmin ||
      (NOTE_VIEWING_ROLES.includes(req.user.role) &&
        (req.user.role !== ROLES.PROJECT_MANAGER || project.pm_id === req.user.id));
    if (!canSeeNotes) {
      delete project.notes;
      delete project.notes_last_sent_at;
    }

    res.json({
      project,
      project_numbers: projectNumbers,
      financials,
      assignments,
      files,
      // Surface viewing capability so the frontend can hide the Notes
      // section entirely rather than render an empty box. Field staff
      // will see no Notes section at all.
      can_edit_notes: canSeeNotes,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// ACTIVE PROJECTS SUMMARY (dashboard-style)
// ═══════════════════════════════════════════════════════════

router.get('/active/summary', authorize('projects:read'), async (req, res, next) => {
  try {
    const { pm_id, customer_id, week_ending } = req.query;

    let query = db('projects')
      .select(
        'projects.*',
        'customers.name as customer_name',
        db.raw("users.first_name || ' ' || users.last_name as pm_name"),
      )
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .leftJoin('users', 'projects.pm_id', 'users.id')
      .where('projects.status', 'active')
      .orderBy('projects.name');

    // PM sees only own
    if (req.user.role === ROLES.PROJECT_MANAGER) {
      query.where('projects.pm_id', req.user.id);
    } else if (pm_id) {
      query.where('projects.pm_id', pm_id);
    }
    if (customer_id) query.where('projects.customer_id', customer_id);

    const projects = await query;

    // Resolve the week to summarize.
    //
    // Strategy:
    //   - If client provided ?week_ending=YYYY-MM-DD, use exactly that week
    //     (matches timesheets where work_date == week_ending exactly).
    //   - If not provided, pick the most recent week_ending across all visible
    //     projects' timesheets. Better than a hardcoded "past 7 days" window
    //     because that returned nothing if the timesheets are seeded data
    //     more than a week old.
    //
    // Also: build a list of all distinct weeks-with-data so the UI can offer
    // a dropdown. Capped at 12 weeks (one quarter).
    const projectIds = projects.map(p => p.id);
    let availableWeeks = [];
    let resolvedWeek = null;

    if (projectIds.length > 0) {
      const weekRows = await db('timesheets')
        .whereIn('project_id', projectIds)
        .distinct('work_date')
        .orderBy('work_date', 'desc')
        .limit(12);
      availableWeeks = weekRows.map(r => {
        // Knex returns either Date or string depending on driver/config; normalize
        if (r.work_date instanceof Date) return r.work_date.toISOString().split('T')[0];
        return String(r.work_date).split('T')[0];
      });

      if (week_ending) {
        resolvedWeek = week_ending;
      } else if (availableWeeks.length > 0) {
        resolvedWeek = availableWeeks[0]; // most recent week with data
      }
    }

    const enriched = await Promise.all(projects.map(async (proj) => {
      // Weekly hours — exact match on work_date when a week is resolved
      let hours = { week_st: 0, week_ot: 0, week_dt: 0, week_workers: 0 };
      if (resolvedWeek) {
        const [row] = await db('timesheets')
          .where('project_id', proj.id)
          .where('work_date', resolvedWeek)
          .select(
            db.raw('COALESCE(SUM(st_hours),0) as week_st'),
            db.raw('COALESCE(SUM(ot_hours),0) as week_ot'),
            db.raw('COALESCE(SUM(dt_hours),0) as week_dt'),
            db.raw('COUNT(DISTINCT worker_name) as week_workers'),
          );
        hours = row;
      }

      // Open oil samples
      const [{ cnt: oil_pending }] = await db('oil_sample_requests')
        .where('project_id', proj.id)
        .where('status', 'pending_return')
        .count('* as cnt');

      // Recent field notes (relative to resolved week, or last 14 days as fallback)
      const notesCutoff = resolvedWeek
        ? new Date(new Date(resolvedWeek).getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const recent_notes = await db('field_notes')
        .select('field_notes.*', db.raw("users.first_name || ' ' || users.last_name as foreman_name"))
        .leftJoin('users', 'field_notes.foreman_id', 'users.id')
        .where('field_notes.project_id', proj.id)
        .where('field_notes.note_date', '>=', notesCutoff)
        .orderBy('field_notes.note_date', 'desc')
        .limit(5);

      return {
        ...proj,
        week_st: parseFloat(hours.week_st),
        week_ot: parseFloat(hours.week_ot),
        week_dt: parseFloat(hours.week_dt),
        week_workers: parseInt(hours.week_workers),
        oil_samples_pending: parseInt(oil_pending),
        recent_notes,
      };
    }));

    // Also return filter options for admin
    let pm_list = [], customer_list = [];
    if (req.user.role === 'admin') {
      pm_list = await db('users').select('id', 'first_name', 'last_name').where('role', 'project_manager').where('active', true);
      customer_list = await db('customers').select('id', 'name').where('active', true).orderBy('name');
    }

    res.json({
      projects: enriched,
      pm_list,
      customer_list,
      available_weeks: availableWeeks,
      resolved_week: resolvedWeek,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// UPDATE
// ═══════════════════════════════════════════════════════════

router.patch('/:id', authorize('projects:update'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const existing = await Project.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (req.user.role === ROLES.PROJECT_MANAGER && existing.pm_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // fully_staffed intentionally NOT in this list — the flag is per-day
    // now (project_day_notes.fully_staffed). The column on projects is
    // dropped by migration 20260518_006; allowing a PATCH to it would
    // silently diverge from the per-day source of truth.
    const allowedFields = [
      'name', 'year', 'status', 'contract_value', 'contract_type', 'payment_terms',
      'contract_man_hours', 'local_union', 'miles_from_hq', 'start_date', 'end_date',
      'description', 'address', 'pm_id', 'customer_id', 'location_id', 'per_diem_rate',
      'project_length_days', 'manpower', 'notes',
    ];
    const updates = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    const project = await Project.update(req.params.id, updates);

    // Notify PM when start_date is newly set or changed. Clicking the
    // notification opens the schedule-edit pop-up DIRECTLY as a modal
    // (frontend keys off referenceType === 'project_schedule' and calls
    // showScheduleEditPopup) — no Scheduler tab navigation. actionUrl is
    // kept as a sane fallback for any non-JS notification surface.
    const startChanged = updates.start_date !== undefined &&
      String(existing.start_date || '') !== String(updates.start_date || '');
    if (startChanged && project.pm_id) {
      try {
        const NotificationService = require('../services/NotificationService');
        const wasNull = !existing.start_date;
        await NotificationService.send({
          userId: project.pm_id,
          category: 'actionable',
          priority: 'normal',
          title: wasNull
            ? `Schedule set: ${project.name}`
            : `Schedule changed: ${project.name}`,
          body: wasNull
            ? `Start date set to ${updates.start_date}. Click to confirm working days (Sat/Sun toggles) on the calendar.`
            : `Start date changed to ${updates.start_date}. Click to review the schedule.`,
          referenceType: 'project_schedule',
          referenceId: project.id,
          actionUrl: `/#/schedule?edit=${project.id}`,
        });
      } catch (err) {
        console.error('[Schedule notification] Failed:', err.message);
        // Non-fatal — the PATCH succeeded; notification failure shouldn't block it
      }
    }

    res.json({ project });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// SCHEDULER (phase 1 — Schedule sub-tab)
// ═══════════════════════════════════════════════════════════
//
// GET /:id/schedule       — read overrides (default: M-F)
// PATCH /:id/schedule     — set works_saturday / works_sunday
// GET ../scheduled-list   — projects with start_date in a date range,
//                           used by the calendar view
//
// "Override" terminology: the system default is M-F; rows in
// project_schedule_overrides express deviations from that. A project
// without a row inherits the default.

// GET /api/projects/scheduled-list?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns projects that have a start_date and overlap the given window.
// Includes per-project schedule overrides + key fields the calendar needs
// to render cards (name, project_number, length, customer, pm_name).
//
// "Overlap" check: the project occupies dates [start_date, start_date +
// project_length_days). A project overlaps the window if start_date <= to
// AND (start_date + project_length_days) >= from. Projects without
// project_length_days are treated as 1-day events for safety.
//
// Permission: projects:read. PMs see their own; others see all.
//
// Defined BEFORE /:id route to avoid Express matching "scheduled-list"
// as a UUID parameter (per the route-ordering convention in the codebase).
router.get('/:id/schedule', authorize('projects:read'), async (req, res, next) => {
  try {
    const overrides = await db('project_schedule_overrides').where('project_id', req.params.id).first();
    res.json({
      project_id: req.params.id,
      works_saturday: overrides?.works_saturday || false,
      works_sunday: overrides?.works_sunday || false,
      weekend_only: overrides?.weekend_only || false,
    });
  } catch (err) { next(err); }
});

router.patch('/:id/schedule', authorize('projects:update'), async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    if (req.user.role === ROLES.PROJECT_MANAGER && project.pm_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const works_saturday = !!req.body.works_saturday;
    const works_sunday = !!req.body.works_sunday;
    const weekend_only = !!req.body.weekend_only;

    // Upsert into project_schedule_overrides
    const existing = await db('project_schedule_overrides').where('project_id', req.params.id).first();
    if (existing) {
      await db('project_schedule_overrides')
        .where('project_id', req.params.id)
        .update({ works_saturday, works_sunday, weekend_only, updated_at: db.fn.now() });
    } else {
      await db('project_schedule_overrides').insert({
        project_id: req.params.id, works_saturday, works_sunday, weekend_only,
      });
    }

    res.json({ project_id: req.params.id, works_saturday, works_sunday, weekend_only });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// SCHEDULER PHASE 2A — worker assignments
// ═══════════════════════════════════════════════════════════
//
// GET    /:id/assignments          — list assignments for one project
// POST   /:id/assignments          — bulk-assign worker(s) to date range
// DELETE /:id/assignments/:assnId  — remove a single assignment
//
// Permission: projects:read for GET, projects:update for write. Scheduler
// role gets both via its role config.
//
// "Bulk-assign" semantics: caller sends { worker_ids: [...], dates:
// [...] } and the server creates one row per (worker, date) combination.
// ON CONFLICT DO NOTHING so re-assigning an existing slot is a no-op
// rather than an error — handy for "select all weeks, click assign" UX.

router.get('/:id/assignments', authorize('projects:read'), async (req, res, next) => {
  try {
    const rows = await db('worker_assignments')
      .select(
        'worker_assignments.*',
        db.raw("users.first_name || ' ' || users.last_name as worker_name"),
        'users.role as worker_role',
      )
      .leftJoin('users', 'worker_assignments.worker_id', 'users.id')
      .where('worker_assignments.project_id', req.params.id)
      .orderBy('worker_assignments.work_date');
    res.json({ assignments: rows });
  } catch (err) { next(err); }
});

router.post('/:id/assignments', authorize('projects:update'), async (req, res, next) => {
  try {
    const { worker_ids, dates } = req.body || {};
    if (!Array.isArray(worker_ids) || worker_ids.length === 0) {
      return res.status(400).json({ error: 'worker_ids must be a non-empty array' });
    }
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: 'dates must be a non-empty array of YYYY-MM-DD strings' });
    }

    // Verify all workers are on_schedule + active. Quietly drop any that
    // aren't — the scheduler UI shouldn't be offering them, but if it
    // does (e.g., stale list), the API rejects them rather than creating
    // invalid assignments.
    const validWorkers = await db('users')
      .whereIn('id', worker_ids)
      .where('on_schedule', true)
      .where('active', true)
      .select('id');
    const validIds = validWorkers.map(w => w.id);
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'None of the supplied workers are on_schedule and active' });
    }

    const rows = [];
    for (const wid of validIds) {
      for (const d of dates) {
        rows.push({
          worker_id: wid,
          project_id: req.params.id,
          work_date: d,
          created_by: req.user.id,
        });
      }
    }

    // ON CONFLICT DO NOTHING — re-assigning the same (worker, project,
    // date) is a silent no-op so the bulk-assign UX is idempotent.
    const result = await db('worker_assignments').insert(rows).onConflict(['worker_id', 'project_id', 'work_date']).ignore();

    res.json({ created: rows.length, requested_workers: worker_ids.length, valid_workers: validIds.length });
  } catch (err) { next(err); }
});

router.delete('/:id/assignments/:assnId', authorize('projects:update'), async (req, res, next) => {
  try {
    const deleted = await db('worker_assignments')
      .where('id', req.params.assnId)
      .where('project_id', req.params.id)
      .del();
    if (deleted === 0) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// POST /:id/assignments/copy-day
//
// Takes the crew assigned to this project on `source_date` and propagates
// it across every other working day of the project. Existing assignments
// on those other days are REPLACED (deleted, then the source-day's crew
// inserted).
//
// Body: { source_date: "YYYY-MM-DD" }
//
// Why a dedicated endpoint instead of "GET source assignments + POST
// bulk-assign + DELETE the rest": doing it server-side in one transaction
// makes the operation atomic — the calendar can't end up in a half-
// propagated state if the user navigates away mid-flight.
router.post('/:id/assignments/copy-day', authorize('projects:update'), async (req, res, next) => {
  try {
    const { source_date } = req.body || {};
    if (!source_date || !/^\d{4}-\d{2}-\d{2}$/.test(source_date)) {
      return res.status(400).json({ error: 'source_date (YYYY-MM-DD) is required' });
    }

    // Pull the project + schedule overrides to compute working days
    const project = await db('projects').where('id', req.params.id).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.start_date) return res.status(400).json({ error: 'Project has no start_date' });
    if (!project.project_length_days) return res.status(400).json({ error: 'Project has no project_length_days' });

    const overrides = await db('project_schedule_overrides').where('project_id', project.id).first() || {};

    // Compute working days — same logic the frontend uses for the calendar
    const startStr = ymd(project.start_date);
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const length = project.project_length_days;
    const workingDates = [];
    let d = new Date(start);
    let safety = 0;
    while (workingDates.length < length && safety < length * 10 + 7) {
      const dow = d.getDay();
      const isWorking = (dow >= 1 && dow <= 5)
        || (dow === 0 && !!overrides.works_sunday)
        || (dow === 6 && !!overrides.works_saturday);
      if (isWorking) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        workingDates.push(`${y}-${mo}-${da}`);
      }
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      safety++;
    }

    if (!workingDates.includes(source_date)) {
      return res.status(400).json({ error: `source_date ${source_date} is not a working day of this project` });
    }

    // Pull source-date crew
    const sourceCrew = await db('worker_assignments')
      .where('project_id', project.id)
      .where('work_date', source_date)
      .select('worker_id');

    if (sourceCrew.length === 0) {
      return res.status(400).json({ error: `No workers assigned on ${source_date} — assign a crew on that day first, then copy.` });
    }

    // Atomic replace: delete all non-source-date assignments for this
    // project, then insert the source crew on every other working day.
    // Also propagate the source day's fully_staffed flag — Pat's rule:
    // marking a day fully staffed is per-day; Copy-Day is the only path
    // that broadcasts it project-wide.
    const targetDates = workingDates.filter(d => d !== source_date);
    let inserted = 0;
    let fullyStaffedPropagated = false;
    await db.transaction(async (trx) => {
      await trx('worker_assignments')
        .where('project_id', project.id)
        .whereIn('work_date', targetDates)
        .del();

      const rows = [];
      for (const wd of targetDates) {
        for (const w of sourceCrew) {
          rows.push({
            worker_id: w.worker_id,
            project_id: project.id,
            work_date: wd,
            created_by: req.user.id,
          });
        }
      }
      if (rows.length > 0) {
        await trx('worker_assignments').insert(rows);
        inserted = rows.length;
      }

      const sourceDay = await trx('project_day_notes')
        .where({ project_id: project.id, work_date: source_date })
        .first();
      if (sourceDay?.fully_staffed) {
        fullyStaffedPropagated = true;
        for (const wd of targetDates) {
          const existing = await trx('project_day_notes')
            .where({ project_id: project.id, work_date: wd })
            .first();
          if (existing) {
            await trx('project_day_notes')
              .where('id', existing.id)
              .update({ fully_staffed: true, updated_by: req.user.id, updated_at: trx.fn.now() });
          } else {
            await trx('project_day_notes').insert({
              project_id: project.id,
              work_date: wd,
              fully_staffed: true,
              updated_by: req.user.id,
            });
          }
        }
      }
    });

    res.json({
      copied_from: source_date,
      target_dates: targetDates.length,
      crew_size: sourceCrew.length,
      assignments_created: inserted,
      fully_staffed_propagated: fullyStaffedPropagated,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PROJECT NOTES — per-day notes only go to field
// ═══════════════════════════════════════════════════════════
//
// Project-wide notes (projects.notes) are intentionally NOT broadcast.
// They're a payment/admin-tracking surface used by PM/accounting/admin;
// the field never sees them. The only path that reaches workers is the
// per-day note + Email Day to Staff button.
//
// GET/PUT /:id/day-notes/:date
//   Per-(project, work_date) note. Shown in the scheduler day popup.
//   Saving stores; doesn't auto-broadcast.
//
// POST /:id/email-day
//   { date: "YYYY-MM-DD" } — sends a notification + email (if
//   configured) to all workers assigned that day. Includes project
//   info, day note (NOT project notes), and the crew list.

router.get('/:id/day-notes/:date', authorize('projects:read'), async (req, res, next) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const row = await db('project_day_notes')
      .where({ project_id: req.params.id, work_date: req.params.date })
      .first();
    res.json({
      project_id: req.params.id,
      work_date: req.params.date,
      notes: row?.notes || '',
      fully_staffed: !!row?.fully_staffed,
      updated_at: row?.updated_at || null,
    });
  } catch (err) { next(err); }
});

router.put('/:id/day-notes/:date', authorize('projects:update'), async (req, res, next) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === ROLES.PROJECT_MANAGER && project.pm_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Build a partial update — clients may PUT just notes, just
    // fully_staffed, or both. Anything omitted is left untouched.
    const patch = { updated_by: req.user.id, updated_at: db.fn.now() };
    const insertExtras = {};
    if (req.body?.notes !== undefined) {
      patch.notes = String(req.body.notes ?? '');
      insertExtras.notes = patch.notes;
    }
    if (req.body?.fully_staffed !== undefined) {
      patch.fully_staffed = !!req.body.fully_staffed;
      insertExtras.fully_staffed = patch.fully_staffed;
    }

    const existing = await db('project_day_notes')
      .where({ project_id: req.params.id, work_date: req.params.date })
      .first();

    if (existing) {
      await db('project_day_notes').where('id', existing.id).update(patch);
    } else {
      await db('project_day_notes').insert({
        project_id: req.params.id,
        work_date: req.params.date,
        updated_by: req.user.id,
        ...insertExtras,
      });
    }

    const after = await db('project_day_notes')
      .where({ project_id: req.params.id, work_date: req.params.date })
      .first();
    res.json({
      project_id: req.params.id,
      work_date: req.params.date,
      notes: after?.notes || '',
      fully_staffed: !!after?.fully_staffed,
    });
  } catch (err) { next(err); }
});

router.post('/:id/email-day', authorize('projects:update'), async (req, res, next) => {
  try {
    const { date, override_subject, override_body_html, override_to, extra_cc } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
    }
    const project = await db('projects').where('id', req.params.id).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (req.user.role === ROLES.PROJECT_MANAGER && project.pm_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Pull crew + day note + project primary number for the message body.
    // `email` is added to the select so we can send the HTML body directly
    // via NotificationService.sendEmail (which doesn't do its own recipient
    // lookup like NotificationService.send does).
    const crew = await db('worker_assignments as wa')
      .leftJoin('users', 'wa.worker_id', 'users.id')
      .where('wa.project_id', project.id)
      .where('wa.work_date', date)
      .select(
        'wa.worker_id',
        'users.email',
        db.raw("users.first_name || ' ' || users.last_name as name"),
      );

    // No crew assigned is allowed — the action still runs (sent_to: 0) so
    // a PM can push the day through even when staffing is incomplete. The
    // picker UI surfaces staffing warnings; this endpoint stays permissive.

    const NotificationService = require('../services/NotificationService');

    // Compose path: any of override_{subject,body_html,to} or extra_cc is
    // present. Caller (the compose modal) already composed the final
    // text — we just resolve {{var}} tokens against live data and send.
    //
    // Default path (no overrides): existing template-driven fan-out where
    // each worker gets their own individual email rendered from the
    // email_day_to_staff template. Unchanged from the pre-compose version.
    const composed = !!(override_subject || override_body_html
      || (Array.isArray(override_to) && override_to.length > 0)
      || (Array.isArray(extra_cc) && extra_cc.length > 0));

    if (composed) {
      const EmailComposeService = require('../services/EmailComposeService');
      const vars = await EmailComposeService.getVars(
        'email_day_to_staff',
        { project_id: project.id, date },
      );

      // Resolve raw composed strings (with {{var}} tokens) against live data.
      // Subject is NOT HTML-escaped (it lands in a Subject header). Body IS.
      const subject = override_subject
        ? EmailComposeService.resolveWithVars(override_subject, vars, { escape: false })
        : `Schedule: ${vars['project.primary_number'] || project.name} on ${date}`;
      const html = override_body_html
        ? EmailComposeService.resolveWithVars(override_body_html, vars, { escape: true })
        : `<p>Schedule update for ${vars['project.primary_number'] || project.name} on ${date}.</p>`;

      const toList = Array.isArray(override_to) && override_to.length > 0
        ? override_to
        : crew.map(c => c.email).filter(Boolean);
      const ccList = Array.isArray(extra_cc) ? extra_cc : [];

      // Still fan in-app notifications out to each assigned worker — they
      // should see the activity in their app even when the email recipient
      // list was overridden. Plain-text body derived by stripping HTML
      // tags + collapsing whitespace; good enough for an in-app preview.
      const plain = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      await Promise.all(crew.map(c =>
        NotificationService.send({
          userId: c.worker_id,
          category: 'actionable',
          priority: 'normal',
          title: subject,
          body: plain,
          referenceType: 'project',
          referenceId: project.id,
          actionUrl: `/#/project-detail?id=${project.id}`,
          channels: ['in_app'],
        }).catch(err => console.error('[email-day:in_app] worker', c.worker_id, err.message))
      ));

      // Email: single bulk send to all addresses + CCs. Logged so any
      // surprise recipient list can be traced post-hoc.
      let emailResult = null;
      if (toList.length > 0) {
        emailResult = await NotificationService.sendEmail({
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          html,
        });
      }
      console.log(`[email-day:composed] project=${project.id} date=${date} to=${toList.length} cc=${ccList.length} result=${emailResult?.provider || 'skipped'}`);
      return res.json({
        composed: true,
        sent_to: toList.length,
        cc: ccList.length,
        in_app_to: crew.length,
        date,
      });
    }

    // ── Default (template-driven) path ─────────────────────────────────
    const EmailTemplateService = require('../services/EmailTemplateService');

    const dayNoteRow = await db('project_day_notes')
      .where({ project_id: project.id, work_date: date })
      .first();
    const dayNote = dayNoteRow?.notes || '';

    const primaryRow = await db('project_numbers')
      .where({ project_id: project.id, label: 'Primary' })
      .first();
    const primaryNumber = primaryRow?.number || project.name;

    // Render the editable email_day_to_staff template once; reuse the
    // result for every worker. Day notes are the ONLY notes channel that
    // goes to the field — project notes are intentionally EXCLUDED
    // (they're PM/accounting payment-tracking notes, not field comms).
    const tplVars = {
      project_number: primaryNumber,
      project_name: project.name,
      location: project.address || '',
      date,
      crew_count: crew.length,
      crew_names: crew.map(c => c.name).filter(Boolean).join(', '),
      // Pre-formatted line so an empty day note doesn't produce a sad
      // "Day notes: " label in the output. Template just renders {{day_notes}}.
      day_notes: dayNote ? `Day notes: ${dayNote.slice(0, 300)}` : '',
    };
    const rendered = await EmailTemplateService.render('email_day_to_staff', tplVars);

    // Fan-out to each worker. Two channels handled distinctly:
    //   - in_app: NotificationService.send creates a notifications row +
    //     does WebSocket push. Uses the plain-text body so the in-app
    //     view doesn't render raw HTML.
    //   - email: NotificationService.sendEmail sends the actual HTML body
    //     (the template-rendered one). Requires us to have the worker's
    //     email locally, hence the email column in the crew query above.
    await Promise.all(crew.map(c =>
      (async () => {
        try {
          await NotificationService.send({
            userId: c.worker_id,
            category: 'actionable',
            priority: 'normal',
            title: rendered.subject,
            body: rendered.text || '',
            referenceType: 'project',
            referenceId: project.id,
            actionUrl: `/#/project-detail?id=${project.id}`,
            channels: ['in_app'],
          });
          if (c.email) {
            await NotificationService.sendEmail({
              to: c.email,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text || undefined,
            });
          }
        } catch (err) {
          console.error('[email-day] worker', c.worker_id, err.message);
        }
      })()
    ));

    res.json({ sent_to: crew.length, date });
  } catch (err) {
    console.error('[email-day]', err.message);
    next(err);
  }
});

router.post('/:id/contract-type', authorize('projects:update'), async (req, res, next) => {
  try {
    const { contract_type } = req.body;
    if (!['contract', 't_and_m'].includes(contract_type)) {
      return res.status(400).json({ error: 'contract_type must be "contract" or "t_and_m"' });
    }
    const project = await Project.update(req.params.id, { contract_type });
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json({ project, message: `Project set to ${contract_type === 'contract' ? 'Contract' : 'T&M'}` });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// INVOICE GENERATOR
// ═══════════════════════════════════════════════════════════

/**
 * Build invoice data from timesheets in a date range.
 * Groups by classification, applies locked rates + markup + mileage.
 */
async function buildInvoiceData(projectId, startDate, endDate) {
  const project = await db('projects').where('id', projectId).first();
  if (!project) throw new Error('Project not found');

  // Get bid for markup
  const bid = project.bid_id ? await db('bids').where('id', project.bid_id).first() : null;
  const markupPct = bid ? parseFloat(bid.markup_pct || 0) : 0;

  // Get timesheets in date range
  const query = db('timesheets').where('project_id', projectId);
  if (startDate) query.where('work_date', '>=', startDate);
  if (endDate) query.where('work_date', '<=', endDate);
  const timesheets = await query.orderBy('work_date');

  if (timesheets.length === 0) throw new Error('No timesheet entries found for this date range');

  // Group by classification
  const byClass = {};
  let totalMileage = 0;
  timesheets.forEach(ts => {
    const cls = ts.classification || 'Unclassified';
    if (!byClass[cls]) byClass[cls] = { st: 0, ot: 0, dt: 0, st_rate: 0, ot_rate: 0, dt_rate: 0, workers: new Set() };
    byClass[cls].st += parseFloat(ts.st_hours || 0);
    byClass[cls].ot += parseFloat(ts.ot_hours || 0);
    byClass[cls].dt += parseFloat(ts.dt_hours || 0);
    // Use the locked rates from the timesheet (set during extraction confirm)
    if (ts.billing_rate_st) byClass[cls].st_rate = parseFloat(ts.billing_rate_st);
    if (ts.billing_rate_ot) byClass[cls].ot_rate = parseFloat(ts.billing_rate_ot);
    if (ts.billing_rate_dt) byClass[cls].dt_rate = parseFloat(ts.billing_rate_dt);
    if (ts.worker_name) byClass[cls].workers.add(ts.worker_name);
    totalMileage += parseFloat(ts.mileage_cost || 0);
  });

  // Build line items
  const lineItems = [];
  let laborSubtotal = 0;
  let sortOrder = 1;

  for (const [cls, data] of Object.entries(byClass)) {
    const stTotal = data.st * data.st_rate;
    const otTotal = data.ot * data.ot_rate;
    const dtTotal = data.dt * data.dt_rate;
    const lineTotal = stTotal + otTotal + dtTotal;
    laborSubtotal += lineTotal;

    lineItems.push({
      description: `${cls} — ${data.workers.size} worker(s): ${data.st.toFixed(1)} ST × $${data.st_rate.toFixed(2)} + ${data.ot.toFixed(1)} OT × $${data.ot_rate.toFixed(2)} + ${data.dt.toFixed(1)} DT × $${data.dt_rate.toFixed(2)}`,
      quantity: 1,
      unit_price: lineTotal,
      total: lineTotal,
      sort_order: sortOrder++,
    });
  }

  // Markup line
  const markupAmount = laborSubtotal * (markupPct / 100);
  if (markupPct > 0) {
    lineItems.push({
      description: `Markup (${markupPct}%)`,
      quantity: 1,
      unit_price: markupAmount,
      total: markupAmount,
      sort_order: sortOrder++,
    });
  }

  // Mileage line
  if (totalMileage > 0) {
    lineItems.push({
      description: `Mileage`,
      quantity: 1,
      unit_price: totalMileage,
      total: totalMileage,
      sort_order: sortOrder++,
    });
  }

  const invoiceTotal = laborSubtotal + markupAmount + totalMileage;

  // Generate invoice number: INV-<PrimaryProjectNumber>-<Seq>
  // The primary number is the canonical identifier (M26-1308.1 format).
  // SPNs are NOT used for invoice numbering — only the primary.
  const primaryNum = await db('project_numbers')
    .where('project_id', projectId)
    .where('label', 'Primary')
    .first();
  // Fallback if no primary set: use any project number, then truncated project name
  const fallbackNum = primaryNum
    ? null
    : await db('project_numbers').where('project_id', projectId).orderBy('created_at').first();
  const projNumStr = (primaryNum?.number) || (fallbackNum?.number) || project.name.substring(0, 10);
  const existingCount = await db('invoices').where('project_id', projectId).count('* as cnt').first();
  const seq = parseInt(existingCount.cnt) + 1;
  const invoiceNumber = `INV-${projNumStr}-${String(seq).padStart(3, '0')}`;

  // Customer info
  const customer = project.customer_id ? await db('customers').where('id', project.customer_id).first() : null;

  return {
    project,
    customer,
    invoice_number: invoiceNumber,
    invoice_date: new Date().toISOString().split('T')[0],
    period_start: startDate,
    period_end: endDate,
    timesheet_count: timesheets.length,
    labor_subtotal: laborSubtotal,
    markup_pct: markupPct,
    markup_amount: markupAmount,
    mileage_total: totalMileage,
    invoice_total: invoiceTotal,
    line_items: lineItems,
    payment_terms: project.payment_terms || 'Net 30',
  };
}

// POST /api/projects/:id/invoice-preview — preview without saving
router.post('/:id/invoice-preview', authorize('projects:update'), async (req, res, next) => {
  try {
    const { start_date, end_date } = req.body;
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
    const data = await buildInvoiceData(req.params.id, start_date, end_date);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/generate-invoice — create invoice + line items + optional doc
router.post('/:id/generate-invoice', authorize('projects:update'), async (req, res, next) => {
  try {
    const { start_date, end_date, template_id } = req.body;
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });

    const data = await buildInvoiceData(req.params.id, start_date, end_date);

    // Calculate payment due date
    const termsMatch = (data.payment_terms || '').match(/(\d+)/);
    const termsDays = termsMatch ? parseInt(termsMatch[1]) : 30;
    const dueDate = new Date(data.invoice_date);
    dueDate.setDate(dueDate.getDate() + termsDays);

    // Create invoice
    const [invoice] = await db('invoices').insert({
      project_id: req.params.id,
      invoice_number: data.invoice_number,
      customer: data.customer?.name || data.project.name,
      amount: data.invoice_total,
      invoice_date: data.invoice_date,
      payment_due_date: dueDate.toISOString().split('T')[0],
      status: 'pending',
      confirmed_by: req.user.id,
      notes: `Auto-generated for period ${start_date} to ${end_date}. ${data.timesheet_count} timesheet entries.`,
    }).returning('*');

    // Create line items
    const lines = data.line_items.map(li => ({
      invoice_id: invoice.id,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      total: li.total,
      sort_order: li.sort_order,
    }));
    await db('invoice_line_items').insert(lines);

    // Recompute % billed now that there's a new invoice
    await recomputePercentBilled(req.params.id);

    // Generate Word document — use selected template, fall back to default
    let docPath = null;
    let template = null;
    if (template_id) {
      template = await db('bid_templates').where({ id: template_id, template_type: 'invoice' }).first();
    }
    if (!template) {
      // Fall back to default invoice template
      template = await db('bid_templates').where({ template_type: 'invoice' }).orderBy('created_at', 'asc').first();
    }
    if (template) {
        const BidDocumentService = require('../services/BidDocumentService');
        const StorageService = require('../services/StorageService');
        const basePath = process.env.STORAGE_BASE_PATH || './storage';
        const projectFolder = data.project.folder_path || `projects/${data.project.year}`;
        const filename = `${data.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}.docx`;
        const outputPath = require('path').join(basePath, projectFolder, 'invoices', filename);

        // Ensure directory exists
        const outputDir = require('path').dirname(outputPath);
        await require('fs').promises.mkdir(outputDir, { recursive: true });

        const templateFullPath = require('path').join(basePath, template.file_path);
        await BidDocumentService.generateInvoiceDoc(data, templateFullPath, outputPath);
        docPath = require('path').join(projectFolder, 'invoices', filename);

        // Update invoice with file path
        await db('invoices').where('id', invoice.id).update({ file_path: docPath });
        invoice.file_path = docPath;
    }

    res.status(201).json({ invoice, line_items: lines, summary: data, document_path: docPath });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/last-invoice-end — returns the latest end date covered
// by any prior invoice on this project, used by the UI to default the next
// invoice's start_date to (last_end + 1 day) so periods don't overlap.
//
// We extract the "end date" from the invoice's auto-generated note line —
// "Auto-generated for period <start> to <end>." — because the platform
// doesn't currently store period_start/period_end on the invoice row.
// Manually-edited invoices may not have this format; in that case we fall
// back to invoice_date and clearly mark the answer as best-effort.
router.get('/:id/last-invoice-end', authorize('projects:read'), async (req, res, next) => {
  try {
    const last = await db('invoices')
      .where('project_id', req.params.id)
      .whereNotIn('status', ['cancelled'])
      .orderBy('invoice_date', 'desc')
      .first();
    if (!last) return res.json({ last_end_date: null, source: 'none' });

    // Try to parse the period from the auto-generated note
    const m = (last.notes || '').match(/period\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
    if (m) {
      return res.json({ last_end_date: m[2], invoice_number: last.invoice_number, source: 'period_note' });
    }
    // Fallback: use the invoice_date itself (best-effort signal that the
    // period probably ended on or before that date)
    const fallback = last.invoice_date instanceof Date
      ? last.invoice_date.toISOString().split('T')[0]
      : (typeof last.invoice_date === 'string' ? last.invoice_date.split('T')[0] : null);
    res.json({ last_end_date: fallback, invoice_number: last.invoice_number, source: 'invoice_date_fallback' });
  } catch (err) { next(err); }
});

// GET /api/projects/:projectId/invoices/:invoiceId/download — stream the
// generated invoice doc back to the user as an attachment so they can email
// it out. 404 if the invoice has no document (data-only generation).
router.get('/:projectId/invoices/:invoiceId/download', authorize('projects:read'), async (req, res, next) => {
  try {
    const inv = await db('invoices')
      .where({ id: req.params.invoiceId, project_id: req.params.projectId })
      .first();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (!inv.file_path) return res.status(404).json({ error: 'No document — this invoice was generated as data only' });

    const path = require('path');
    const fs = require('fs');
    const basePath = process.env.STORAGE_BASE_PATH || './storage';
    const fullPath = path.join(basePath, inv.file_path);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Document file missing on disk' });

    const ext = path.extname(fullPath) || '.docx';
    const downloadName = `${(inv.invoice_number || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_')}${ext}`;
    res.download(fullPath, downloadName);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// TIMESHEET EXPORT (Word document — one page per worker)
// ═══════════════════════════════════════════════════════════

/**
 * Build timesheet export data — groups timesheets by worker for a date range.
 */
async function buildTimesheetExportData(projectId, startDate, endDate) {
  const project = await db('projects').where('id', projectId).first();
  if (!project) throw new Error('Project not found');

  const query = db('timesheets').where('project_id', projectId);
  if (startDate) query.where('work_date', '>=', startDate);
  if (endDate) query.where('work_date', '<=', endDate);
  const timesheets = await query.orderBy('work_date');

  if (timesheets.length === 0) throw new Error('No timesheet entries found for this date range');

  // Group by worker + week
  const workerWeeks = {};
  timesheets.forEach(ts => {
    const key = `${ts.worker_name}__${ts.week_ending || ts.work_date}`;
    if (!workerWeeks[key]) {
      workerWeeks[key] = {
        worker_name: ts.worker_name,
        classification: ts.classification,
        local_union: ts.local_union,
        week_ending: ts.week_ending || ts.work_date,
        days_worked: ts.days_worked || 5,
        st_hours: 0, ot_hours: 0, dt_hours: 0,
        st_rate: parseFloat(ts.billing_rate_st || 0),
        ot_rate: parseFloat(ts.billing_rate_ot || 0),
        dt_rate: parseFloat(ts.billing_rate_dt || 0),
        miles_driven: 0, mileage_cost: 0,
        per_diem_rate: parseFloat(ts.per_diem_rate || 0),
        per_diem_total: 0,
        daily_details: ts.daily_details || null,
      };
    }
    const w = workerWeeks[key];
    w.st_hours += parseFloat(ts.st_hours || 0);
    w.ot_hours += parseFloat(ts.ot_hours || 0);
    w.dt_hours += parseFloat(ts.dt_hours || 0);
    w.miles_driven += parseFloat(ts.miles_driven || 0);
    w.mileage_cost += parseFloat(ts.mileage_cost || 0);
    w.per_diem_total += parseFloat(ts.per_diem_total || 0);
    if (ts.daily_details) w.daily_details = ts.daily_details;
  });

  const workers = Object.values(workerWeeks);

  // Get related data
  const customer = project.customer_id ? await db('customers').where('id', project.customer_id).first() : null;
  const pmUser = await db('users').where('id', project.pm_id).first();
  const projNum = await db('project_numbers')
    .where('project_id', projectId)
    .where('label', 'Primary')
    .first();

  return {
    workers,
    project,
    customer,
    pm: pmUser ? `${pmUser.first_name} ${pmUser.last_name}` : '',
    project_number: projNum ? projNum.number : '',
    period_start: startDate,
    period_end: endDate,
    worker_count: new Set(workers.map(w => w.worker_name)).size,
    total_entries: timesheets.length,
  };
}

// POST /api/projects/:id/timesheet-preview — preview export data
router.post('/:id/timesheet-preview', authorize('projects:read'), async (req, res, next) => {
  try {
    const { start_date, end_date } = req.body;
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
    const data = await buildTimesheetExportData(req.params.id, start_date, end_date);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/export-timesheets
//
// Generates a timesheet export. Excel (.xlsx) is the default format —
// most contractor timesheets are spreadsheet-based, and accountants prefer
// editable cells they can paste into payroll. The legacy Word (.docx)
// format is still supported when explicitly requested via ?format=docx.
router.post('/:id/export-timesheets', authorize('projects:read'), async (req, res, next) => {
  try {
    const { start_date, end_date, template_id } = req.body;
    const format = (req.body.format || req.query.format || 'xlsx').toLowerCase();
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });

    const data = await buildTimesheetExportData(req.params.id, start_date, end_date);

    const BidDocumentService = require('../services/BidDocumentService');
    const safeName = data.project.name.replace(/[^a-zA-Z0-9]/g, '_');
    const outputDir = require('path').join(process.env.STORAGE_BASE_PATH || './storage', 'exports');
    await require('fs').promises.mkdir(outputDir, { recursive: true });

    if (format === 'docx') {
      // Legacy Word path — kept available for shops that already have a
      // .docx merge template they want to populate
      let templateFullPath = null;
      if (template_id) {
        const template = await db('bid_templates').where({ id: template_id, template_type: 'timesheet' }).first();
        if (template) {
          const basePath = process.env.STORAGE_BASE_PATH || './storage';
          templateFullPath = require('path').join(basePath, template.file_path);
        }
      }
      const filename = `Timesheets_${safeName}_${start_date}_to_${end_date}.docx`;
      const outputPath = require('path').join(outputDir, filename);
      await BidDocumentService.generateTimesheetDoc(data, templateFullPath, outputPath);
      return res.download(outputPath, filename);
    }

    // Default: Excel
    const filename = `Timesheets_${safeName}_${start_date}_to_${end_date}.xlsx`;
    const outputPath = require('path').join(outputDir, filename);
    await BidDocumentService.generateTimesheetXlsx(data, outputPath);
    res.download(outputPath, filename);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CLOSE-OUT & DELETE
// ═══════════════════════════════════════════════════════════

router.post('/:id/close', authorize('projects:close'), async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.status === 'completed') return res.status(400).json({ error: 'Project already closed' });

    const updated = await Project.update(req.params.id, {
      status: 'completed',
      end_date: new Date().toISOString().split('T')[0],
    });

    // Check for equipment still checked out
    const checkedOut = await db('equipment')
      .where('current_project_id', project.id)
      .where('status', 'checked_out');

    res.json({
      project: updated,
      warnings: checkedOut.length > 0
        ? { equipment_still_out: checkedOut.map(e => ({ barcode_id: e.barcode_id, name: e.equipment_name })) }
        : null,
      message: 'Project closed.',
    });
  } catch (err) { next(err); }
});

// POST /api/projects/:id/cancel — Cancel a project (soft)
router.post('/:id/cancel', authorize('projects:close'), async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    const updated = await Project.update(req.params.id, { status: 'cancelled' });
    res.json({ project: updated, message: 'Project cancelled.' });
  } catch (err) { next(err); }
});

// DELETE /api/projects/:id — Hard delete project + all related data (admin only)
router.delete('/:id', authorize('admin:manage'), async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    await db.transaction(async (trx) => {
      const invoiceIds = await trx('invoices').where('project_id', req.params.id).pluck('id');
      if (invoiceIds.length) await trx('invoice_line_items').whereIn('invoice_id', invoiceIds).delete();
      const poIds = await trx('purchase_orders').where('project_id', req.params.id).pluck('id');
      if (poIds.length) await trx('po_line_items').whereIn('po_id', poIds).delete();
      const reqIds = await trx('equipment_requests').where('project_id', req.params.id).pluck('id');
      if (reqIds.length) await trx('equipment_request_lines').whereIn('request_id', reqIds).delete();

      await trx('invoices').where('project_id', req.params.id).delete();
      await trx('purchase_orders').where('project_id', req.params.id).delete();
      await trx('contracts').where('project_id', req.params.id).delete();
      await trx('timesheets').where('project_id', req.params.id).delete();
      await trx('equipment_checkout_log').where('project_id', req.params.id).delete();
      await trx('equipment_requests').where('project_id', req.params.id).delete();
      await trx('project_numbers').where('project_id', req.params.id).delete();
      await trx('project_assignments').where('project_id', req.params.id).delete();
      await trx('notifications').where('reference_type', 'project').where('reference_id', req.params.id).delete();
      await trx('projects').where('id', req.params.id).delete();
    });

    res.json({ deleted: true, message: `Project "${project.name}" permanently deleted.` });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PROJECT NUMBERS
// ═══════════════════════════════════════════════════════════

router.get('/:id/numbers', authorize('projects:read'), async (req, res, next) => {
  try {
    const numbers = await ProjectNumber.findByProject(req.params.id);
    res.json({ numbers });
  } catch (err) { next(err); }
});

router.post('/:id/numbers', authorize('projects:update'),
  [body('number').trim().notEmpty(), body('label').optional().trim()],
  async (req, res, next) => {
    try {
      const pn = await ProjectNumber.create(req.params.id, req.body.number, req.body.label);
      res.status(201).json(pn);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Number already exists for this project' });
      next(err);
    }
  }
);

router.delete('/:id/numbers/:numberId', authorize('projects:update'), async (req, res, next) => {
  try {
    await ProjectNumber.delete(req.params.numberId);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/projects/:id/invoices/:invoiceId/payment
 * Record payment received on an invoice.
 * Body: { date (required), amount (optional — null = full payment) }
 */
router.post('/:id/invoices/:invoiceId/payment', authorize('projects:update'), async (req, res, next) => {
  try {
    const { date, amount } = req.body;
    if (!date) return res.status(400).json({ error: 'Payment date is required' });

    const PaymentReminderService = require('../services/PaymentReminderService');
    const invoice = await PaymentReminderService.recordPayment(
      req.params.invoiceId,
      date,
      amount !== undefined ? amount : null,
      req.user.id
    );

    res.json({
      invoice,
      message: amount ? `Partial payment of $${amount} recorded` : 'Full payment recorded',
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// TEAM ASSIGNMENTS
// ═══════════════════════════════════════════════════════════

router.get('/:id/team', authorize('projects:read'), async (req, res, next) => {
  try {
    const assignments = await Project.getAssignments(req.params.id);
    res.json({ assignments });
  } catch (err) { next(err); }
});

router.post('/:id/team', authorize('projects:update'),
  [body('user_id').isUUID(), body('role_on_project').optional().trim()],
  async (req, res, next) => {
    try {
      const assignment = await Project.addAssignment(req.params.id, req.body.user_id, req.body.role_on_project);
      res.status(201).json({ assignment });
    } catch (err) { next(err); }
  }
);

router.delete('/:id/team/:userId', authorize('projects:update'), async (req, res, next) => {
  try {
    await Project.removeAssignment(req.params.id, req.params.userId);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// FILES
// ═══════════════════════════════════════════════════════════

router.get('/:id/files/:subfolder', authorize('projects:read'),
  [param('id').isUUID(), param('subfolder').isIn(['invoices', 'timesheets', 'purchase_orders', 'Contract'])],
  async (req, res, next) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Not found' });
      if (!project.folder_path) return res.json({ files: [] });

      const path = require('path');
      const files = await FileService.listFiles(path.join(project.folder_path, req.params.subfolder));
      res.json({ files, subfolder: req.params.subfolder });
    } catch (err) { next(err); }
  }
);

module.exports = router;
