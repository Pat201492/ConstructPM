/**
 * Saved & scheduled exports — CRUD + manual trigger.
 *
 *   GET    /api/exports/schedules           List (owner-scoped; admin sees all)
 *   POST   /api/exports/schedules           Create                       [exports:manage]
 *   GET    /api/exports/schedules/:id       Get one
 *   PATCH  /api/exports/schedules/:id       Update                       [exports:manage]
 *   DELETE /api/exports/schedules/:id       Remove                       [exports:manage]
 *   POST   /api/exports/schedules/:id/trigger   Run now                  [exports:read]
 *
 * Auth: all routes require `exports:read`. Write actions additionally
 * require `exports:manage` (admin + project_manager). Accounting is
 * read-only — they can list/get/trigger their own rows but not create,
 * edit, or delete them. Owner-or-admin gate applies on top for per-row
 * access. Listing is filtered to the user's own rows unless they're admin.
 */

const express = require('express');
const { param, validationResult } = require('express-validator');
const { parseExpression } = require('cron-parser');

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
  return parseExpression(cron, { currentDate: from }).next().toDate();
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

  // Per-export email config (PR #18). Each field is optional and null-able:
  // null clears the value back to inherit (PR #19 falls back to the
  // legacy `saved_export_email` template when any of these is null).
  // Body columns are TEXT (unbounded) but the inline editor is meant for
  // a delivery email, not a CMS — cap at 64KB so a pathological paste
  // can't bloat the row or DoS the row UI.
  const BODY_MAX = 64 * 1024;
  for (const k of ['email_subject', 'email_body_html', 'email_body_text']) {
    if (b[k] === undefined) continue;
    if (b[k] === null) { out[k] = null; continue; }
    if (typeof b[k] !== 'string') { errs.push(`${k} must be a string or null`); continue; }
    if (k === 'email_subject' && b[k].length > 500) {
      errs.push('email_subject must be 500 characters or fewer');
      continue;
    }
    if (k !== 'email_subject' && b[k].length > BODY_MAX) {
      errs.push(`${k} must be ${BODY_MAX} characters or fewer`);
      continue;
    }
    out[k] = b[k];
  }

  // Fan-out config (PR #20).
  const effectiveSource = b.source || out.source;
  if (b.fanout_mode !== undefined) {
    if (b.fanout_mode !== 'none' && b.fanout_mode !== 'per_user_role') {
      errs.push('fanout_mode must be "none" or "per_user_role"');
    } else {
      out.fanout_mode = b.fanout_mode;
    }
  }
  if (b.fanout_role !== undefined) {
    if (b.fanout_role !== null && typeof b.fanout_role !== 'string') errs.push('fanout_role must be a string or null');
    else out.fanout_role = b.fanout_role;
  }
  if (b.fanout_filter_column !== undefined) {
    if (b.fanout_filter_column === null) {
      out.fanout_filter_column = null;
    } else if (typeof b.fanout_filter_column !== 'string') {
      errs.push('fanout_filter_column must be a string or null');
    } else if (effectiveSource) {
      const def = M.findUserScopeColumn(effectiveSource, b.fanout_filter_column);
      if (!def) errs.push(`fanout_filter_column "${b.fanout_filter_column}" is not a declared user-scope column for source "${effectiveSource}"`);
      else out.fanout_filter_column = b.fanout_filter_column;
    } else {
      out.fanout_filter_column = b.fanout_filter_column;
    }
  }
  if (b.admin_consolidation !== undefined) {
    if (typeof b.admin_consolidation !== 'boolean') errs.push('admin_consolidation must be a boolean');
    else out.admin_consolidation = b.admin_consolidation;
  }
  if (b.admin_recipients !== undefined) {
    if (!Array.isArray(b.admin_recipients)) errs.push('admin_recipients must be an array of user UUIDs');
    else out.admin_recipients = JSON.stringify(b.admin_recipients);
  }
  if (b.export_formats !== undefined) {
    if (!Array.isArray(b.export_formats)) errs.push('export_formats must be an array');
    else {
      const allowed = new Set(['csv', 'xlsx', 'pdf']);
      const invalid = b.export_formats.filter(f => !allowed.has(f));
      if (invalid.length > 0) errs.push(`invalid export_formats: ${invalid.join(', ')}`);
      else if (b.export_formats.length === 0) errs.push('export_formats must include at least one of csv/xlsx/pdf');
      else out.export_formats = JSON.stringify([...new Set(b.export_formats)]);
    }
  }
  // Cross-field: when fanout_mode is being set to per_user_role in this
  // request, require role + filter_column in the same payload. PATCH
  // callers must bundle the three together so the row never lands in an
  // invalid state mid-update.
  if (b.fanout_mode === 'per_user_role') {
    if (!out.fanout_role) errs.push('fanout_role is required when fanout_mode = per_user_role');
    if (!out.fanout_filter_column) errs.push('fanout_filter_column is required when fanout_mode = per_user_role');
  }

  return { out, errs };
}

// Keep owner_user_id when the caller is admin (so the all-rows view can
// label whose row is whose); strip it for non-admin owners — they already
// know it's theirs, and the UI never reads it.
function serialize(row, { includeOwner = false } = {}) {
  if (!row) return row;
  const out = {
    ...row,
    columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
    filters: typeof row.filters === 'string' ? JSON.parse(row.filters) : (row.filters || {}),
    recipients: typeof row.recipients === 'string' ? JSON.parse(row.recipients) : (row.recipients || []),
    admin_recipients: typeof row.admin_recipients === 'string' ? JSON.parse(row.admin_recipients) : (row.admin_recipients || []),
    export_formats: typeof row.export_formats === 'string' ? JSON.parse(row.export_formats) : (row.export_formats || ['csv']),
  };
  if (!includeOwner) delete out.owner_user_id;
  return out;
}

// ─── LIST ───────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const rows = await scopedQuery(req).orderBy('created_at', 'desc');
    const includeOwner = isAdmin(req.user);
    res.json({ schedules: rows.map(r => serialize(r, { includeOwner })) });
  } catch (err) { next(err); }
});

// ─── GET ONE ────────────────────────────────────────────────────────────

router.get('/:id', [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });
    res.json({ schedule: serialize(row, { includeOwner: isAdmin(req.user) }) });
  } catch (err) { next(err); }
});

// ─── CREATE ─────────────────────────────────────────────────────────────

router.post('/', authorize('exports:manage'), async (req, res, next) => {
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
    res.status(201).json({ schedule: serialize(row, { includeOwner: isAdmin(req.user) }) });
  } catch (err) { next(err); }
});

// ─── UPDATE ─────────────────────────────────────────────────────────────

router.patch('/:id', authorize('exports:manage'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });

    const { out, errs } = validatePayload(req, { partial: true });
    if (errs.length) return res.status(400).json({ error: 'Validation error', details: errs });
    if (Object.keys(out).length === 0) return res.status(400).json({ error: 'No fields to update' });

    // Cross-field column/source validation. validatePayload only checks
    // columns against b.source when both are in the same payload. Cover
    // the other two cases here against the effective post-update source:
    //   1. columns provided alone → validate vs. existing row.source
    //   2. source provided alone → validate row.columns vs. new source
    const effectiveSource = out.source !== undefined ? out.source : row.source;
    const columnsToCheck = out.columns !== undefined
      ? JSON.parse(out.columns)
      : (out.source !== undefined ? normalizeJsonArrayLocal(row.columns) : null);
    if (columnsToCheck) {
      const allowed = M.allowedColumnKeys(effectiveSource);
      const invalid = columnsToCheck.filter(c => !allowed.has(c));
      if (invalid.length > 0) {
        return res.status(400).json({
          error: out.source !== undefined && out.columns === undefined
            ? `existing columns are invalid for new source "${effectiveSource}": ${invalid.join(', ')} — update columns in the same request`
            : `invalid columns for "${effectiveSource}": ${invalid.join(', ')}`,
        });
      }
    }

    out.updated_at = db.fn.now();
    const [updated] = await db('saved_exports').where('id', req.params.id).update(out).returning('*');
    res.json({ schedule: serialize(updated, { includeOwner: isAdmin(req.user) }) });
  } catch (err) { next(err); }
});

// ─── DELETE ─────────────────────────────────────────────────────────────

router.delete('/:id', authorize('exports:manage'), [param('id').isUUID()], async (req, res, next) => {
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
// Intentionally gated by `exports:read` (not `exports:manage`) so accounting
// — who can read but not author — can still fire their own saved exports.
// Also intentionally ignores `enabled`: a paused row's schedule doesn't
// fire, but a manual trigger is the user explicitly asking it to run now.
router.post('/:id/trigger', [param('id').isUUID()], async (req, res, next) => {
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) return res.status(400).json({ error: 'Validation error', details: v.array() });
    const { row, err } = await fetchOwnedOrAdmin(req, req.params.id);
    if (err) return res.status(err.status).json({ error: err.msg });

    // Optional compose-modal overrides. Each is plain JSON; the runner
    // validates / falls back to defaults on its own. Strings may contain
    // `{{var}}` tokens that the runner resolves via EmailComposeService
    // against the live saved-export context.
    const overrides = {
      override_subject:   typeof req.body?.override_subject   === 'string' ? req.body.override_subject   : undefined,
      override_body_html: typeof req.body?.override_body_html === 'string' ? req.body.override_body_html : undefined,
      override_to:        Array.isArray(req.body?.override_to) ? req.body.override_to : undefined,
      extra_cc:           Array.isArray(req.body?.extra_cc)    ? req.body.extra_cc    : undefined,
    };

    const result = await SavedExportRunner.run(row, overrides);
    res.json(result);
  } catch (err) { next(err); }
});

// Small local helper for the cross-field column check above. Mirrors the
// shape of SavedExportRunner.normalizeJsonArray without the dependency.
function normalizeJsonArrayLocal(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

module.exports = router;
