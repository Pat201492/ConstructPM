/**
 * CSV Export Routes
 *
 * Hardcoded format exports (integration-specific):
 *   GET  /quickbooks/invoices, /quickbooks/timesheets, /quickbooks/purchase-orders
 *   GET  /procore/budget, /procore/invoices, /procore/timecards
 *   GET  /equipment
 *
 * Cross-table column-picker builder (drives the Data Export UI):
 *   GET  /builder/sources           — Sources + grouped joinable columns
 *   POST /builder/preview           — First 20 rows preview
 *   POST /builder/download          — Full CSV download
 */

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const ExportService = require('../services/ExportService');
const ExportBuilder = require('../services/ExportBuilder');
const NotificationService = require('../services/NotificationService');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);
router.use(authorize('exports:read'));

function sendCSV(res, csv, filename) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get('/quickbooks/invoices', async (req, res, next) => {
  try {
    const csv = await ExportService.quickbooksInvoices(req.query);
    sendCSV(res, csv, `qb_invoices_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/quickbooks/timesheets', async (req, res, next) => {
  try {
    const csv = await ExportService.quickbooksTimesheets(req.query);
    sendCSV(res, csv, `qb_timesheets_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/quickbooks/purchase-orders', async (req, res, next) => {
  try {
    const csv = await ExportService.quickbooksPurchaseOrders(req.query);
    sendCSV(res, csv, `qb_purchase_orders_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/procore/budget', async (req, res, next) => {
  try {
    const csv = await ExportService.procoreBudget(req.query);
    sendCSV(res, csv, `procore_budget_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/procore/invoices', async (req, res, next) => {
  try {
    const csv = await ExportService.procoreInvoices(req.query);
    sendCSV(res, csv, `procore_invoices_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/procore/timecards', async (req, res, next) => {
  try {
    const csv = await ExportService.procoreTimecards(req.query);
    sendCSV(res, csv, `procore_timecards_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/equipment', async (req, res, next) => {
  try {
    const csv = await ExportService.equipmentExport(req.query);
    sendCSV(res, csv, `equipment_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CROSS-TABLE EXPORT BUILDER
// ═══════════════════════════════════════════════════════════

// GET /api/exports/builder/sources — all available sources with joinable columns
router.get('/builder/sources', async (req, res, next) => {
  try {
    res.json(ExportBuilder.getSources());
  } catch (err) { next(err); }
});

// GET /api/exports/builder/fanout-config?source=<key> — userScopeColumns + roles
// PR #20: feeds the fan-out config dropdowns on the schedule modal.
router.get('/builder/fanout-config', async (req, res, next) => {
  try {
    const M = require('../services/exportMetadata');
    const db = require('../config/database');
    const source = req.query.source;
    const userScopeColumns = source ? M.getUserScopeColumns(source) : [];
    // Roles in use today — distinct values from the users table (active
    // only). Returning live distinct beats a hardcoded list so newly-
    // added roles surface automatically.
    const roleRows = await db('users').where('active', true).distinct('role').orderBy('role');
    const roles = roleRows.map(r => r.role).filter(Boolean);
    res.json({ userScopeColumns, roles });
  } catch (err) { next(err); }
});

// POST /api/exports/builder/preview — preview first 20 rows
router.post('/builder/preview', async (req, res, next) => {
  try {
    const { source, columns, filters } = req.body;
    if (!source) return res.status(400).json({ error: 'source required' });
    const result = await ExportBuilder.execute(source, columns, { ...filters, limit: 20 });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/exports/builder/download?format=csv|xlsx — full download
// CSV is the default; xlsx returns a binary Buffer with the same headers
// + rows that the CSV path serves. Both share the ExportBuilder result,
// only the encoder differs.
router.post('/builder/download', async (req, res, next) => {
  try {
    const { source, columns, filters } = req.body;
    if (!source) return res.status(400).json({ error: 'source required' });
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ error: `unsupported format "${format}"` });
    }
    // Pass grouping through the filters bag so ExportBuilder + encoders
    // can apply it. Body shape: { grouping: { levels:[...], sortBy, sortDir } }.
    const execFilters = { ...(filters || {}) };
    if (req.body.grouping) execFilters.grouping = req.body.grouping;
    const result = await ExportBuilder.execute(source, columns, execFilters);
    const dateStr = new Date().toISOString().split('T')[0];
    const encOpts = result.grouping ? { grouping: result.grouping } : {};
    if (format === 'xlsx') {
      const buf = await ExportService.toXLSX(result.headers, result.rows, source, encOpts);
      const filename = `${source}_export_${dateStr}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buf));
    }
    if (format === 'pdf') {
      const buf = await ExportService.toPDF(result.headers, result.rows, source, encOpts);
      const filename = `${source}_export_${dateStr}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buf));
    }
    const csv = ExportService.toCSV(result.headers, result.rows);
    sendCSV(res, csv, `${source}_export_${dateStr}.csv`);
  } catch (err) { next(err); }
});

// POST /api/exports/builder/email-me
// "Test this report" — runs an ad-hoc export and emails the result to the
// caller only. Recipient is ALWAYS req.user — the route deliberately
// ignores any client-supplied recipient list so the endpoint can't be
// abused to spam other users.
//
// Body shape (all optional except source + columns):
//   source         — export source key
//   columns        — array of column keys
//   filters        — { start_date?, end_date?, ... } (passed through)
//   formats        — array subset of ['csv','xlsx','pdf']; default ['xlsx']
//   email_subject  — optional override; defaults to "Test: <source>"
//   email_body_html— optional override; defaults to a one-liner with row count
router.post('/builder/email-me', async (req, res, next) => {
  const tmpPaths = [];
  try {
    const { source, columns, filters, formats, email_subject, email_body_html, grouping } = req.body || {};
    if (!source) return res.status(400).json({ error: 'source required' });
    if (!Array.isArray(columns) || columns.length === 0) return res.status(400).json({ error: 'columns required' });
    const fmtRequested = Array.isArray(formats) && formats.length > 0 ? formats : ['xlsx'];
    const allowed = ['csv', 'xlsx', 'pdf'];
    const fmtList = [...new Set(fmtRequested.map(f => String(f).toLowerCase()).filter(f => allowed.includes(f)))];
    if (fmtList.length === 0) return res.status(400).json({ error: 'at least one of csv/xlsx/pdf required' });

    // Recipient = caller. Look up email from active users only — a logged-
    // in user without an email on file (rare; admin without contact) can't
    // self-test until they update their profile.
    // Defence-in-depth: an admin can deactivate a user, but the user's JWT
    // stays valid until expiry. Re-check active here so a deactivated
    // account can't keep self-mailing reports after losing access.
    const me = await db('users').where({ id: req.user.id, active: true }).first('email', 'first_name', 'last_name');
    if (!me || !me.email) return res.status(400).json({ error: 'your account has no email on file (or has been deactivated)' });

    const execFilters = { ...(filters || {}) };
    if (grouping) execFilters.grouping = grouping;
    const result = await ExportBuilder.execute(source, columns, execFilters);
    const rowCount = result.total || 0;
    if (rowCount === 0) return res.status(400).json({ error: 'no rows match — adjust columns / filters and retry' });

    const dateStr = new Date().toISOString().split('T')[0];
    const stem = `${source}_test_${dateStr}`;
    const attachments = [];
    for (const fmt of fmtList) {
      const built = await buildTmpAttachment(fmt, result.headers, result.rows, source, stem, result.grouping || null);
      attachments.push(built);
      tmpPaths.push(built.filePath);
    }

    const subject = (email_subject && email_subject.trim()) || `Test export: ${source}`;
    const body = (email_body_html && email_body_html.trim())
      || `<p>Test export <strong>${escapeHtml(source)}</strong> — ${rowCount} row${rowCount === 1 ? '' : 's'} attached.</p>`;
    const tagFormat = attachments.length > 1;

    let delivered = 0;
    let failed = 0;
    const errors = [];
    for (const att of attachments) {
      const tagged = tagFormat ? `${subject} (${att.fmt.toUpperCase()})` : subject;
      try {
        const r = await NotificationService.sendEmailWithAttachment({
          to: me.email,
          subject: tagged,
          html: body,
          filePath: att.filePath,
          filename: att.filename,
          contentType: att.contentType,
        });
        if (r && r.delivered) delivered++;
        else { failed++; if (r && r.reason) errors.push(r.reason); }
      } catch (err) {
        failed++;
        errors.push(err.message);
      }
    }
    res.json({ delivered, failed, rowCount, formats: fmtList, to: me.email, errors });
  } catch (err) {
    next(err);
  } finally {
    for (const p of tmpPaths) fs.unlink(p).catch(() => {});
  }
});

// Local helper — mirrors SavedExportRunner._buildAttachment but unbound
// to a saved row. Writes temp file, returns send-ready descriptor.
async function buildTmpAttachment(fmt, headers, rows, source, stem, grouping) {
  const tmpStem = path.join(
    os.tmpdir(),
    `email-me-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  const encOpts = grouping ? { grouping } : {};
  if (fmt === 'csv') {
    const filePath = `${tmpStem}.csv`;
    await fs.writeFile(filePath, ExportService.toCSV(headers, rows), 'utf8');
    return { fmt, filePath, filename: `${stem}.csv`, contentType: 'text/csv' };
  }
  if (fmt === 'xlsx') {
    const filePath = `${tmpStem}.xlsx`;
    const buf = await ExportService.toXLSX(headers, rows, source, encOpts);
    await fs.writeFile(filePath, Buffer.from(buf));
    return {
      fmt, filePath, filename: `${stem}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  if (fmt === 'pdf') {
    const filePath = `${tmpStem}.pdf`;
    const buf = await ExportService.toPDF(headers, rows, source, encOpts);
    await fs.writeFile(filePath, Buffer.from(buf));
    return { fmt, filePath, filename: `${stem}.pdf`, contentType: 'application/pdf' };
  }
  throw new Error(`Unsupported format: ${fmt}`);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

module.exports = router;
