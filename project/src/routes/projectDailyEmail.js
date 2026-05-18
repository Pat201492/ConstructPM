/**
 * Per-project daily-briefing config — CRUD-ish + manual trigger.
 *
 * Mounted at /api/projects/:projectId/daily-email (mergeParams: true).
 *
 *   GET   /                Returns the config row, or a defaults object if
 *                          no row exists yet (so the UI can render the form
 *                          with sane initial values).
 *   PUT   /                Upserts the config (single row per project).
 *   POST  /trigger         Runs the briefing right now, returns delivery
 *                          summary { delivered, failed, skipped, recipientsResolved, status }.
 *
 * Auth: admin or the project's PM. Anyone else gets 403.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const db = require('../config/database');
const ProjectBriefingRunner = require('../services/ProjectBriefingRunner');

const router = express.Router({ mergeParams: true });
router.use(authenticate);

const DEFAULTS = {
  enabled: false,
  send_hour_utc: 13,
  include_pm: true,
  include_scheduler: true,
  include_staff: true,
  extra_recipient_user_ids: [],
  template_key: 'project_daily_briefing',
};

// Resolve project + auth gate. Loads the project once, attaches it
// + the resolved authorization to res.locals for the handler.
async function loadAndGate(req, res, next) {
  const projectId = req.params.projectId;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  try {
    const project = await db('projects').where('id', projectId).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const isAdmin = req.user.role === 'admin';
    const isPM = project.pm_id === req.user.id;
    if (!isAdmin && !isPM) return res.status(403).json({ error: 'Only the project PM or an admin can manage this config' });
    res.locals.project = project;
    next();
  } catch (err) { next(err); }
}

router.use(loadAndGate);

function serialize(row) {
  if (!row) return row;
  return {
    ...row,
    extra_recipient_user_ids: typeof row.extra_recipient_user_ids === 'string'
      ? JSON.parse(row.extra_recipient_user_ids)
      : (row.extra_recipient_user_ids || []),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const row = await db('project_daily_email_configs').where('project_id', res.locals.project.id).first();
    if (!row) {
      // Hand back defaults so the UI can render the form for first-time
      // setup; PUT will INSERT.
      return res.json({ config: { project_id: res.locals.project.id, ...DEFAULTS }, exists: false });
    }
    res.json({ config: serialize(row), exists: true });
  } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const allowed = ['enabled', 'send_hour_utc', 'include_pm', 'include_scheduler', 'include_staff', 'extra_recipient_user_ids', 'template_key'];
    const update = {};
    const errors = [];
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (k === 'extra_recipient_user_ids') {
        if (!Array.isArray(req.body[k])) errors.push('extra_recipient_user_ids must be an array');
        else update[k] = JSON.stringify(req.body[k]);
      } else if (k === 'send_hour_utc') {
        const n = Number(req.body[k]);
        if (!Number.isInteger(n) || n < 0 || n > 23) errors.push('send_hour_utc must be an integer 0–23');
        else update[k] = n;
      } else if (['enabled', 'include_pm', 'include_scheduler', 'include_staff'].includes(k)) {
        if (typeof req.body[k] !== 'boolean') errors.push(`${k} must be a boolean`);
        else update[k] = req.body[k];
      } else {
        update[k] = req.body[k];
      }
    }
    if (errors.length) return res.status(400).json({ error: 'Validation error', details: errors });

    const existing = await db('project_daily_email_configs').where('project_id', res.locals.project.id).first();
    let row;
    if (existing) {
      update.updated_at = db.fn.now();
      [row] = await db('project_daily_email_configs').where('id', existing.id).update(update).returning('*');
    } else {
      const insert = {
        project_id: res.locals.project.id,
        ...DEFAULTS,
        extra_recipient_user_ids: JSON.stringify(DEFAULTS.extra_recipient_user_ids),
        ...update,
      };
      [row] = await db('project_daily_email_configs').insert(insert).returning('*');
    }
    res.json({ config: serialize(row) });
  } catch (err) { next(err); }
});

router.post('/trigger', async (req, res, next) => {
  try {
    // Ensure a config row exists — manual trigger reads it for
    // include_* + extras + template_key.
    const existing = await db('project_daily_email_configs').where('project_id', res.locals.project.id).first();
    if (!existing) return res.status(400).json({ error: 'No config saved yet — PUT /api/projects/:id/daily-email first' });
    const result = await ProjectBriefingRunner.run(res.locals.project.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
