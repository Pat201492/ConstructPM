/**
 * Saved Export Fan-out Runner — PR #20.
 *
 * Runs a single `saved_exports` row in fan-out mode: one filtered run +
 * email per user matching the configured role, plus an optional
 * consolidated email to the admin recipient list.
 *
 *   savedExport.fanout_mode             = 'per_user_role'
 *   savedExport.fanout_role             role name → SELECT users WHERE role=…
 *   savedExport.fanout_filter_column    SQL ref filtered with each user's id
 *   savedExport.export_formats          array subset of ['csv','xlsx','pdf']
 *   savedExport.admin_consolidation     true → also generate unfiltered run
 *   savedExport.admin_recipients        user UUIDs for the consolidated email
 *
 * For each in-scope user:
 *   1. ExportBuilder.execute(source, columns, filters + scope_column/_user_id)
 *   2. If rowCount === 0 → send summary-only email, no attachment, mark skipped
 *   3. Else generate every configured format → email each format as attachment
 *
 * Admin consolidation (after the user loop):
 *   1. Build sections array: one section per user with rows (filtered run)
 *   2. Generate xlsx (one sheet per user) + pdf (one section per user) per
 *      `export_formats` choices
 *   3. Email admin_recipients with both attachments
 *
 * Failure isolation: one user's failure does not abort the run. Per-user
 * outcomes accumulated into the run summary and stamped into last_error
 * like the default runner does.
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const db = require('../config/database');
const ExportBuilder = require('./ExportBuilder');
const M = require('./exportMetadata');
const NotificationService = require('./NotificationService');
const EmailTemplateService = require('./EmailTemplateService');
const ExportFileGenerator = require('./ExportFileGenerator');

const ALLOWED_FORMATS = new Set(['csv', 'xlsx', 'pdf']);
const FORMAT_MIME = {
  csv:  'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:  'application/pdf',
};
const FORMAT_EXT = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };

const SavedExportFanoutRunner = {
  async run(savedExport /*, overrides */) {
    // overrides ignored in fan-out mode — composing a single message for
    // a multi-recipient fan-out doesn't have a coherent meaning; the
    // schedule's role + per-export email config drives delivery.

    let status = 'failed';
    let delivered = 0, failed = 0, skipped = 0;
    let rowCount = 0;
    const errors = [];
    const tmpPaths = [];

    try {
      await stamp(savedExport.id, 'running', null);

      // ── Config & validation ─────────────────────────────────────
      const scopeDef = M.findUserScopeColumn(savedExport.source, savedExport.fanout_filter_column);
      if (!scopeDef) throw new Error(`fanout_filter_column "${savedExport.fanout_filter_column}" is not a declared user-scope column for source "${savedExport.source}"`);
      if (!savedExport.fanout_role) throw new Error('fanout_role is required when fanout_mode = per_user_role');

      const formats = normFormats(savedExport.export_formats);
      if (formats.length === 0) throw new Error('export_formats must include at least one of csv/xlsx/pdf');

      // ── Look up in-scope users ──────────────────────────────────
      const users = await db('users')
        .where({ role: savedExport.fanout_role, active: true })
        .whereNotNull('email')
        .select('id', 'first_name', 'last_name', 'email');
      if (users.length === 0) {
        status = 'no_recipients';
        await stamp(savedExport.id, status, `No active users with role "${savedExport.fanout_role}"`);
        return { delivered: 0, failed: 0, skipped: 0, rowCount: 0, status };
      }

      const columns = normJsonArray(savedExport.columns);
      const filters = normJsonObject(savedExport.filters);
      const whenUtc = new Date().toISOString().replace('T', ' ').replace(/\..*$/, '');

      // Sections used for admin consolidation (one per user). Populated
      // as each user's run completes; only used if admin_consolidation.
      const adminSections = [];

      // ── Per-user fan-out ────────────────────────────────────────
      for (const user of users) {
        const sectionName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
        try {
          const result = await ExportBuilder.execute(savedExport.source, columns, {
            ...filters,
            scope_column: savedExport.fanout_filter_column,
            scope_user_id: user.id,
          });
          const userRows = result.rows || [];
          const userHeaders = result.headers || [];
          rowCount += userRows.length;

          if (userRows.length === 0) {
            // Empty PM — summary email, no attachment.
            const subject = await renderSubject(savedExport, {
              name: `${savedExport.name} — ${sectionName}`,
              source: savedExport.source,
              rowCount: 0,
              whenUtc,
            });
            const html = await renderBody(savedExport, {
              name: savedExport.name,
              source: savedExport.source,
              rowCount: 0,
              whenUtc,
            }, { emptyNote: `No rows in your scope of "${savedExport.name}" this run.` });
            const res = await NotificationService.sendEmail({ to: user.email, subject, html });
            if (res && res.delivered) delivered++; else { failed++; if (res?.reason) errors.push(`${user.email}: ${res.reason}`); }
            skipped++; // counted as "skipped" attachment, even though email still went
            adminSections.push({ name: sectionName, headers: userHeaders, rows: [] });
            continue;
          }

          // Has rows — generate every chosen format and email each.
          const filenameBase = `${slug(savedExport.name)}_${slug(sectionName)}_${ymd()}`;
          const section = { name: sectionName, headers: userHeaders, rows: userRows };
          adminSections.push(section);

          const attachments = await buildAttachments(section, formats, filenameBase, tmpPaths);

          const subject = await renderSubject(savedExport, {
            name: `${savedExport.name} — ${sectionName}`,
            source: savedExport.source,
            rowCount: userRows.length,
            whenUtc,
          });
          const html = await renderBody(savedExport, {
            name: savedExport.name,
            source: savedExport.source,
            rowCount: userRows.length,
            whenUtc,
          });

          // nodemailer / NotificationService.sendEmailWithAttachment only
          // takes ONE file. For multi-format we send N emails to the same
          // recipient — one per format — so each provider stays simple.
          // Cheaper alternative would be a multi-attachment helper on
          // NotificationService, but that's a separate refactor.
          let userDelivered = 0, userFailed = 0;
          for (const att of attachments) {
            const res = await NotificationService.sendEmailWithAttachment({
              to: user.email,
              subject: attachments.length > 1 ? `${subject} (${att.format.toUpperCase()})` : subject,
              html,
              filePath: att.path,
              filename: att.filename,
              contentType: att.contentType,
            });
            if (res && res.delivered) userDelivered++; else { userFailed++; if (res?.reason) errors.push(`${user.email} (${att.format}): ${res.reason}`); }
          }
          if (userFailed === 0) delivered++; else failed++;
        } catch (err) {
          failed++;
          errors.push(`${user.email}: ${err.message}`);
        }
      }

      // ── Admin consolidation (optional) ──────────────────────────
      if (savedExport.admin_consolidation) {
        const adminUserIds = normJsonArray(savedExport.admin_recipients);
        const adminUsers = adminUserIds.length === 0 ? [] : await db('users')
          .whereIn('id', adminUserIds).where('active', true).whereNotNull('email').select('email');
        const adminEmails = adminUsers.map(u => u.email);
        if (adminEmails.length === 0) {
          errors.push('admin_consolidation: no active admin recipients with email — consolidation skipped');
        } else {
          try {
            const filenameBase = `${slug(savedExport.name)}_consolidated_${ymd()}`;
            // Consolidation only makes sense for multi-section formats.
            // CSV is single-section by definition; we emit one CSV
            // concatenating all sections with separator rows so the file
            // is still useful.
            const csvAttachments = formats.includes('csv') ? [await buildConsolidatedCSV(adminSections, filenameBase, tmpPaths)] : [];
            const xlsxAttachments = formats.includes('xlsx') ? [await buildAttachment(adminSections, 'xlsx', filenameBase, tmpPaths)] : [];
            const pdfAttachments = formats.includes('pdf') ? [await buildAttachment(adminSections, 'pdf', filenameBase, tmpPaths)] : [];
            const attachments = [...csvAttachments, ...xlsxAttachments, ...pdfAttachments];

            const subject = await renderSubject(savedExport, {
              name: `${savedExport.name} — Consolidated`,
              source: savedExport.source,
              rowCount,
              whenUtc,
            });
            const html = await renderBody(savedExport, {
              name: `${savedExport.name} (Consolidated)`,
              source: savedExport.source,
              rowCount,
              whenUtc,
            }, { sectionCount: adminSections.length });

            for (const att of attachments) {
              const res = await NotificationService.sendEmailWithAttachment({
                to: adminEmails,
                subject: attachments.length > 1 ? `${subject} (${att.format.toUpperCase()})` : subject,
                html,
                filePath: att.path,
                filename: att.filename,
                contentType: att.contentType,
              });
              if (res && res.delivered) delivered++; else { failed++; if (res?.reason) errors.push(`admin (${att.format}): ${res.reason}`); }
            }
          } catch (err) {
            failed++;
            errors.push(`admin_consolidation: ${err.message}`);
          }
        }
      }

      if (failed === 0) status = 'ok';
      else if (delivered > 0) status = 'partial';
      else status = 'failed';

      const errorMsg = buildErrorSummary(failed, skipped, errors);
      await stamp(savedExport.id, status, errorMsg);
      return { delivered, failed, skipped, rowCount, status, error: errorMsg };
    } catch (err) {
      const errorMsg = err.message || String(err);
      await stamp(savedExport.id, 'failed', errorMsg);
      return { delivered, failed, skipped, rowCount, status: 'failed', error: errorMsg };
    } finally {
      for (const p of tmpPaths) {
        fs.unlink(p).catch(() => {});
      }
    }
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

async function stamp(id, status, error) {
  await db('saved_exports').where('id', id).update({
    last_run_at: new Date(),
    last_status: status,
    last_error: error || null,
    updated_at: db.fn.now(),
  });
}

async function buildAttachments(section, formats, filenameBase, tmpPaths) {
  const out = [];
  for (const fmt of formats) {
    out.push(await buildAttachment([section], fmt, filenameBase, tmpPaths));
  }
  return out;
}

async function buildAttachment(sections, fmt, filenameBase, tmpPaths) {
  let buf;
  if (fmt === 'csv') {
    // CSV always operates on a single (collapsed) section; if multiple
    // sections supplied here we concatenate with a separator row.
    if (sections.length === 1) {
      buf = Buffer.from(ExportFileGenerator.toCSV(sections[0]), 'utf8');
    } else {
      const lines = [];
      sections.forEach((s, i) => {
        if (i > 0) lines.push('');
        lines.push(`# ${s.name}`);
        lines.push(ExportFileGenerator.toCSV(s));
      });
      buf = Buffer.from(lines.join('\r\n'), 'utf8');
    }
  } else if (fmt === 'xlsx') {
    buf = await ExportFileGenerator.toXLSX(sections);
  } else if (fmt === 'pdf') {
    buf = await ExportFileGenerator.toPDF(sections, { alwaysShowSectionHeading: sections.length > 1 });
  } else {
    throw new Error(`Unknown export format: ${fmt}`);
  }
  const filename = `${filenameBase}.${FORMAT_EXT[fmt]}`;
  const tmp = await ExportFileGenerator.writeTemp(buf, filename);
  tmpPaths.push(tmp);
  return { format: fmt, filename, path: tmp, contentType: FORMAT_MIME[fmt] };
}

async function buildConsolidatedCSV(sections, filenameBase, tmpPaths) {
  return buildAttachment(sections, 'csv', filenameBase, tmpPaths);
}

async function renderSubject(savedExport, vars) {
  if (savedExport.email_subject) {
    return substitute(savedExport.email_subject, vars);
  }
  // Fallback to legacy template path (PR #18 added email_subject column
  // but kept the template as fallback for null rows).
  const r = await EmailTemplateService.render('saved_export_email', vars);
  return r.subject;
}

async function renderBody(savedExport, vars, opts = {}) {
  let html;
  if (savedExport.email_body_html) {
    html = substitute(savedExport.email_body_html, vars, { escapeHtml: true });
  } else {
    const r = await EmailTemplateService.render('saved_export_email', vars);
    html = r.html;
  }
  if (opts.emptyNote) {
    html += `<p style="color:#888;font-style:italic">${escapeHtml(opts.emptyNote)}</p>`;
  }
  if (opts.sectionCount != null) {
    html += `<p style="color:#888;font-size:12px">Consolidated across ${opts.sectionCount} recipients.</p>`;
  }
  return html;
}

function substitute(template, vars, opts = {}) {
  return String(template).replace(/\{\{\{?\s*([a-zA-Z_][\w]*)\s*\}?\}\}/g, (_m, name) => {
    const v = vars[name];
    if (v == null) return '';
    const s = String(v);
    return opts.escapeHtml ? escapeHtml(s) : s;
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normFormats(v) {
  const arr = normJsonArray(v);
  const out = [];
  for (const f of arr) {
    if (typeof f === 'string' && ALLOWED_FORMATS.has(f.toLowerCase()) && !out.includes(f.toLowerCase())) {
      out.push(f.toLowerCase());
    }
  }
  // Default to csv for legacy rows missing the column.
  return out.length > 0 ? out : ['csv'];
}

function normJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function normJsonObject(v) {
  if (!v) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch { return {}; } }
  return {};
}

function slug(s) {
  return String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
}
function ymd() {
  return new Date().toISOString().split('T')[0];
}

function buildErrorSummary(failed, skipped, errors) {
  const summary = [];
  if (failed > 0) summary.push(`${failed} failed`);
  if (skipped > 0) summary.push(`${skipped} skipped (empty)`);
  let out = summary.length > 0 ? summary.join(', ') : null;
  if (errors.length > 0) {
    const sample = [...new Set(errors)].slice(0, 3).join('; ');
    const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
    out = `${out ?? 'errors'} — ${sample}${more}`;
  }
  return out;
}

module.exports = SavedExportFanoutRunner;
