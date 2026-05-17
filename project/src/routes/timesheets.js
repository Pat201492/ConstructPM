/**
 * Timesheet Routes
 * 
 * Timesheets enter through the centralized inbox flow (admin confirms).
 * These routes are for READING/QUERYING timesheet data.
 * 
 * Data entry: POST /api/inbox/timesheets → AI extraction → admin verifies → Extraction.confirm
 * Reading:    GET /api/timesheets → list/filter/group by project or personnel
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { ROLES } = require('../config/roles');
const db = require('../config/database');
const ExportService = require('../services/ExportService');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/timesheets
 * List timesheets with filters and grouping.
 * Query params: project_id, worker_name, start_date, end_date, group_by (project|worker), limit, offset
 */
router.get('/', authorize('timesheets:read'), async (req, res, next) => {
  try {
    const { project_id, worker_name, start_date, end_date, group_by, limit, offset } = req.query;

    // If group_by requested, return aggregated data
    if (group_by === 'project') {
      const query = db('timesheets')
        .select(
          'timesheets.project_id',
          'projects.name as project_name',
          db.raw('SUM(st_hours) as total_st'),
          db.raw('SUM(ot_hours) as total_ot'),
          db.raw('SUM(dt_hours) as total_dt'),
          db.raw('SUM(potential_revenue) as total_revenue'),
          db.raw('SUM(mileage_cost) as total_mileage'),
          db.raw('COUNT(DISTINCT worker_name) as worker_count'),
          db.raw('COUNT(*) as entry_count'),
        )
        .join('projects', 'timesheets.project_id', 'projects.id')
        .groupBy('timesheets.project_id', 'projects.name');

      if (start_date) query.where('work_date', '>=', start_date);
      if (end_date) query.where('work_date', '<=', end_date);

      const groups = await query;
      return res.json({ groups, group_by: 'project' });
    }

    if (group_by === 'worker') {
      const query = db('timesheets')
        .select(
          'worker_name',
          'classification',
          db.raw('SUM(st_hours) as total_st'),
          db.raw('SUM(ot_hours) as total_ot'),
          db.raw('SUM(dt_hours) as total_dt'),
          db.raw('SUM(potential_revenue) as total_revenue'),
          db.raw('COUNT(DISTINCT project_id) as project_count'),
          db.raw('COUNT(*) as entry_count'),
        )
        .groupBy('worker_name', 'classification');

      if (project_id) query.where('project_id', project_id);
      if (start_date) query.where('work_date', '>=', start_date);
      if (end_date) query.where('work_date', '<=', end_date);

      const groups = await query;
      return res.json({ groups, group_by: 'worker' });
    }

    // Default: individual entries
    const query = db('timesheets')
      .select('timesheets.*', 'projects.name as project_name')
      .join('projects', 'timesheets.project_id', 'projects.id')
      .orderBy('timesheets.work_date', 'desc')
      .limit(parseInt(limit) || 100)
      .offset(parseInt(offset) || 0);

    if (project_id) query.where('timesheets.project_id', project_id);
    if (worker_name) query.where('timesheets.worker_name', 'ilike', `%${worker_name}%`);
    if (start_date) query.where('timesheets.work_date', '>=', start_date);
    if (end_date) query.where('timesheets.work_date', '<=', end_date);

    // Scope: PM sees their projects only
    if (req.user.role === ROLES.PROJECT_MANAGER) {
      query.where('projects.pm_id', req.user.id);
    }

    const timesheets = await query;
    const [{ count }] = await db('timesheets').count('* as count');

    res.json({ timesheets, total: parseInt(count, 10) });
  } catch (err) { next(err); }
});

/**
 * GET /api/timesheets/summary
 * Quick summary for dashboard: total hours this week/period.
 */
router.get('/summary', authorize('timesheets:read'), async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;

    const query = db('timesheets')
      .select(
        db.raw('SUM(st_hours) as total_st'),
        db.raw('SUM(ot_hours) as total_ot'),
        db.raw('SUM(dt_hours) as total_dt'),
        db.raw('SUM(potential_revenue) as total_revenue'),
        db.raw('SUM(mileage_cost) as total_mileage'),
        db.raw('COUNT(DISTINCT worker_name) as unique_workers'),
        db.raw('COUNT(DISTINCT project_id) as unique_projects'),
      );

    if (start_date) query.where('work_date', '>=', start_date);
    if (end_date) query.where('work_date', '<=', end_date);

    const [summary] = await query;
    res.json(summary);
  } catch (err) { next(err); }
});

/**
 * GET /api/timesheets/payroll-export
 *
 * Payroll export for accountants. Filterable by:
 *   - project_id (single project)
 *   - pm_id      (admins only — scope to one PM's projects)
 *   - start_date / end_date
 *   - format     (csv or xlsx, default csv)
 *   - view       (detailed or by_worker, default detailed)
 *
 * For PMs, automatically scoped to their own projects.
 */
router.get('/payroll-export', authorize('timesheets:read'), async (req, res, next) => {
  try {
    const { project_id, pm_id, start_date, end_date, format = 'csv', view = 'detailed' } = req.query;

    const filters = { format: view };
    if (project_id) filters.project_id = project_id;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;

    // Scope: PMs see their own projects only
    if (req.user.role === ROLES.PROJECT_MANAGER) {
      filters.pm_id = req.user.id;
    } else if (pm_id && req.user.role === ROLES.ADMIN) {
      filters.pm_id = pm_id;
    }

    const dateSuffix = (start_date && end_date)
      ? `_${start_date}_to_${end_date}`
      : `_${new Date().toISOString().split('T')[0]}`;

    if (format === 'xlsx') {
      const buf = await ExportService.payrollTimesheetsXlsx(filters);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="payroll_timesheets${dateSuffix}.xlsx"`);
      return res.send(Buffer.from(buf));
    }

    // Default: CSV
    const csv = await ExportService.payrollTimesheetsCSV(filters);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll_timesheets${dateSuffix}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
