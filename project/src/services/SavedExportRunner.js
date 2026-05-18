/**
 * Saved Export Runner
 *
 * Executes a single `saved_exports` row end-to-end:
 *   1. Run ExportBuilder.execute(source, columns, filters)
 *   2. Build CSV via ExportService.toCSV
 *   3. Write CSV to a temp file
 *   4. For each recipient (user_id → active user's email): send via
 *      NotificationService.sendEmailWithAttachment
 *   5. Stamp last_run_at / last_status / last_error
 *   6. Clean up the temp file
 *
 * The runner does NOT compute next_run_at — that's the FileWatcher's job
 * (or the manual-trigger route, which leaves next_run_at alone).
 *
 * Returns { delivered, failed, skipped, rowCount, status, error? }.
 * `status` mirrors what was written to last_status: 'ok' | 'partial' |
 * 'failed' | 'no_rows'.
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const db = require('../config/database');
const ExportBuilder = require('./ExportBuilder');
const ExportService = require('./ExportService');
const NotificationService = require('./NotificationService');
const EmailTemplateService = require('./EmailTemplateService');

const SavedExportRunner = {
  async run(savedExport) {
    let status = 'failed';
    let errorMsg = null;
    const deliveryErrors = [];
    let delivered = 0, failed = 0, skipped = 0, rowCount = 0;
    let tmpPath = null;

    try {
      // 1+2. Run the export and build CSV
      const columns = normalizeJsonArray(savedExport.columns);
      const filters = normalizeJsonObject(savedExport.filters);
      const result = await ExportBuilder.execute(savedExport.source, columns, filters);
      rowCount = result.total || 0;

      if (rowCount === 0) {
        status = 'no_rows';
        await this._stamp(savedExport.id, status, null);
        return { delivered: 0, failed: 0, skipped: 0, rowCount: 0, status };
      }

      const csv = ExportService.toCSV(result.headers, result.rows);

      // 3. Temp file
      tmpPath = path.join(os.tmpdir(), `saved-export-${savedExport.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.csv`);
      await fs.writeFile(tmpPath, csv, 'utf8');

      // 4. Recipients — look up live (skip deactivated)
      const recipientIds = normalizeJsonArray(savedExport.recipients);
      const recipients = recipientIds.length === 0 ? [] : await db('users')
        .whereIn('id', recipientIds)
        .where('active', true)
        .select('id', 'email');

      skipped = recipientIds.length - recipients.length;

      const filename = `${slug(savedExport.name)}_${ymd()}.csv`;
      // Subject + body come from the admin-editable `saved_export_email`
      // template (see migration 20260518_011_email_templates). Rendered
      // once; reused for every recipient.
      const rendered = await EmailTemplateService.render('saved_export_email', {
        name: savedExport.name,
        source: savedExport.source,
        rowCount,
        whenUtc: new Date().toISOString().replace('T', ' ').replace(/\..*$/, ''),
      });
      const subject = rendered.subject;
      const html = rendered.html;

      for (const r of recipients) {
        if (!r.email) {
          failed++;
          deliveryErrors.push(`${r.id}: no email on file`);
          continue;
        }
        try {
          const res = await NotificationService.sendEmailWithAttachment({
            to: r.email,
            subject,
            html,
            filePath: tmpPath,
            filename,
            contentType: 'text/csv',
          });
          if (res && res.delivered) delivered++;
          else {
            failed++;
            if (res && res.reason) deliveryErrors.push(`${r.email}: ${res.reason}`);
          }
        } catch (err) {
          failed++;
          deliveryErrors.push(`${r.email}: ${err.message}`);
        }
      }

      // 5. Status determination
      if (failed === 0 && skipped === 0) status = 'ok';
      else if (delivered > 0) status = 'partial';
      else status = 'failed';

      // Build the last_error summary: counts first (so the UI badge stays
      // short), then up to a few distinct delivery errors for diagnosis.
      // Truncate the detail tail so a 100-recipient export with 100
      // different failures doesn't blow out the text column.
      const summary = [];
      if (failed > 0) summary.push(`${failed} failed`);
      if (skipped > 0) summary.push(`${skipped} skipped (inactive)`);
      let stampError = summary.length > 0 ? summary.join(', ') : null;
      if (deliveryErrors.length > 0) {
        const sample = [...new Set(deliveryErrors)].slice(0, 3).join('; ');
        const more = deliveryErrors.length > 3 ? ` (+${deliveryErrors.length - 3} more)` : '';
        stampError = `${stampError ?? 'delivery errors'} — ${sample}${more}`;
      }
      errorMsg = stampError;

      await this._stamp(savedExport.id, status, stampError);
      return { delivered, failed, skipped, rowCount, status, error: stampError };
    } catch (err) {
      errorMsg = err.message || String(err);
      await this._stamp(savedExport.id, 'failed', errorMsg);
      return { delivered, failed, skipped, rowCount, status: 'failed', error: errorMsg };
    } finally {
      // 6. Cleanup
      if (tmpPath) {
        fs.unlink(tmpPath).catch(() => {});
      }
    }
  },

  async _stamp(id, status, error) {
    await db('saved_exports').where('id', id).update({
      last_run_at: new Date(),
      last_status: status,
      last_error: error || null,
      updated_at: db.fn.now(),
    });
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

function normalizeJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
function normalizeJsonObject(v) {
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
module.exports = SavedExportRunner;
