/**
 * Saved & scheduled exports — CRUD + manual trigger.
 *
 *   GET    /api/exports/schedules           List (owner-scoped; admin sees all)
 *   POST   /api/exports/schedules           Create
 *   GET    /api/exports/schedules/:id       Get one
 *   PATCH  /api/exports/schedules/:id       Update
 *   DELETE /api/exports/schedules/:id       Remove
 *   POST   /api/exports/schedules/:id/trigger   Run now, return delivery summary
 *
 * Auth: requires `exports:read` (matches the existing builder routes). All
 * write actions further require the user to be the owner OR admin. Listing
 * is filtered to the user's own rows unless they're admin.
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const cronParser = require('cron-parser');

const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const db = require('../config/database');
const M = require('../services/exportMetadata');
const SavedExportRunner = require('../services/SavedExportRunner');

const router = express.Router();

router.use(authenticate);
router.use(authorize('exports:read'));

// ─── helpers ────────────────────────────────────────────────────────────

function isAdmin(user) { return user?.role === 'admin'; }

function scopedQuery(req) {
  const q = db('saved_exports');
  return isAdmin(req.user) ? q : q.where('owner_user_id', req.user.id);
}

async function fetchOwnedOrAdmin(req, id) {
  const row = await db('saved_exports').where('id', id).first();
  if (!row) return { row: null, err: { status: 404, msg: 'Not found' } };
  if (!isAdmin(req.user) && row.owner_user_id !== req.user.id) {
    return { row: null, err: { status: 403, msg: 'Not yours' } };
  }
  return { row, err: null };
}

function nextRunFromCron(cron, from = new Date()) {
  return cronParser.parseExpression(cron, { currentDate: from }).next().toDate();
}

function validatePayload(req, { partial = false } = {}) {
  const errs = [];
  const b = req.body || {};
  const out = {};

  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || b.name.trim().length === 0) errs.push('name must be a non-empty string');
    else out.name = b.name.trim();
  } else if (!partial) errs.push('name is required');

  if (b.source !== undefined) {
    if (!M.getSource(b.source)) errs.push(`source "${b.source}" is not a known export source`);
    else out.source = b.source;
  } else if (!partial) errs.push('source is required');

  if (b.columns !== undefined) {
    if (!Array.isArray(b.columns) || b.columns.length === 0) errs.push('columns must be a non-empty array');
    else {
      const src = b.source || out.source;
      if (src) {
        const allowed = M.allowedColumnKeys(src);
        const invalid = b.columns.filter(c => !allowed.has(c));
        if (invalid.length > 0) errs.push(`invalid columns for "${src}": ${invalid.join(', ')}`);
      }
      out.columns = JSON.stringify(b.columns);
    }
  } else if (!partial) errs.push('columns is required');

  if (b.filters !== undefined) {
    if (b.filters && typeof b.filters === 'object' && !Array.isArray(b.filters)) {
      out.filters = JSON.stringify(b.filters);
    } else if (b.filters === null) {
      out.filters = JSON.stringify({});
    } else errs.push('filters must be an object');
  }

  if (b.cron !== undefined) {
    if (b.cron === null || b.cron === '') {
      out.cron = null;
      out.next_run_at = null;
    } else if (typeof b.cron === 'string') {
      try {
        const next = nextRunFromCron(b.cron);
        out.cron = b.cron;
        out.next_run_at = next;
      } catch (e) { errs.push(`invalid cron: ${e.message}`); }
    } else errs.push('cron must be a string or null');
  }

  if (b.recipients !== undefined) {
    if (!Array.isArray(b.recipients)) errs.push('recipients must be an array of user UUIDs');
    else out.recipients = JSON.stringify(b.recipients);
  } else if (!partial) {
    out.recipients = JSON.stringify([]);
  }

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') errs.push('enabled must be a boolean');
    else out.enabled = b.enabled;
  }

  return { out, errs };
}

function serialize(row) {
  if (!row) return row;
  return {
    ...row,
    columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
    filters: typeof row.filters === 'string' ? JSON.parse(row.filters) : (row.filters || {}),
    recipients: typeof row.recipients === 'string' ? JSON.parse(row.recipients) : (row.recipients || []),
  };
}

// ─── LIST ───────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const rows = await scopedQuery(req).orderBy('created_at', 'desc');
    res.json({ schedules: rows.map(serialize) });
  } catch (err) { next(err); }
});

// ─── GET ONE ────────────────────────────────────────────────────────────

router.get('/:id', [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });
    res.json({ schedule: serialize(row) });
  } catch (err) { next(err); }
});

// ─── CREATE ─────────────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { out, errs } = validatePayload(req, { partial: false });
    if (errs.length) return res.status(400).json({ error: 'Validation error', details: errs });

    const insert = {
      ...out,
      owner_user_id: req.user.id,
      // Defaults if not present
      enabled: out.enabled !== undefined ? out.enabled : true,
      filters: out.filters !== undefined ? out.filters : JSON.stringify({}),
    };

    const [row] = await db('saved_exports').insert(insert).returning('*');
    res.status(201).json({ schedule: serialize(row) });
  } catch (err) { next(err); }
});

// ─── UPDATE ─────────────────────────────────────────────────────────────

router.patch('/:id', [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });

    const { out, errs } = validatePayload(req, { partial: true });
    if (errs.length) return res.status(400).json({ error: 'Validation error', details: errs });
    if (Object.keys(out).length === 0) return res.status(400).json({ error: 'No fields to update' });

    // If columns changed but source didn't, re-validate columns against the existing source
    if (out.columns !== undefined && out.source === undefined) {
      const allowed = M.allowedColumnKeys(row.source);
      const cols = JSON.parse(out.columns);
      const invalid = cols.filter(c => !allowed.has(c));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `invalid columns for "${row.source}": ${invalid.join(', ')}` });
      }
    }

    out.updated_at = db.fn.now();
    const [updated] = await db('saved_exports').where('id', req.params.id).update(out).returning('*');
    res.json({ schedule: serialize(updated) });
  } catch (err) { next(err); }
});

// ─── DELETE ─────────────────────────────────────────────────────────────

router.delete('/:id', [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });
    await db('saved_exports').where('id', row.id).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── TRIGGER (manual) ───────────────────────────────────────────────────

router.post('/:id/trigger', [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });

    const result = await SavedExportRunner.run(row);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
