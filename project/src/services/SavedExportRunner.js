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
const EmailComposeService = require('./EmailComposeService');
const SavedExportFanoutRunner = require('./SavedExportFanoutRunner');

const SavedExportRunner = {
  /**
   * @param {object} savedExport  Row from saved_exports
   * @param {object} [overrides]  Optional compose-modal overrides:
   *   { override_subject?, override_body_html?, override_to?, extra_cc? }.
   *   When any are present, the runner takes the "composed" path: resolves
   *   {{var}} tokens against live data + sends one bulk email (to all
   *   override_to addresses, with extra_cc on the CC line) instead of the
   *   default per-recipient template-driven fan-out.
   */
  async run(savedExport, overrides = {}) {
    // PR #20: delegate to the fan-out runner when the row is configured
    // for it. Compose-modal overrides are ignored in fan-out mode (per
    // the runner's own comment).
    if (savedExport.fanout_mode === 'per_user_role') {
      return SavedExportFanoutRunner.run(savedExport, overrides);
    }

    let status = 'failed';
    let errorMsg = null;
    const deliveryErrors = [];
    let delivered = 0, failed = 0, skipped = 0, rowCount = 0;
    let tmpPath = null;

    try {
      // Stamp 'running' upfront so retries after a crash mid-send don't
      // double-deliver. FileWatcher's saved-export tick advances
      // next_run_at after each fire regardless of outcome, so the upfront
      // stamp is mostly for UI hygiene — the row reflects "currently
      // running" while ExportBuilder/emailing is in flight, instead of
      // staying on the previous status until the end.
      await this._stamp(savedExport.id, 'running', null);

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

      const filename = `${slug(savedExport.name)}_${ymd()}.csv`;
      const whenUtc = new Date().toISOString().replace('T', ' ').replace(/\..*$/, '');

      const composed = !!(overrides.override_subject || overrides.override_body_html
        || (Array.isArray(overrides.override_to) && overrides.override_to.length > 0)
        || (Array.isArray(overrides.extra_cc) && overrides.extra_cc.length > 0));

      if (composed) {
        // Compose path: resolve user-edited subject/body against live data
        // + send ONE bulk email (To: override_to OR saved recipients;
        // CC: extra_cc). No per-recipient fan-out — the user explicitly
        // composed a single message for a chosen audience.
        const composeVars = await EmailComposeService.getVars(
          'saved_export_run',
          { saved_export_id: savedExport.id },
          { rowCount, whenUtc },
        );
        const subject = overrides.override_subject
          ? EmailComposeService.resolveWithVars(overrides.override_subject, composeVars, { escape: false })
          : EmailComposeService.resolveWithVars(`[ConstructPM] {{name}}`, composeVars, { escape: false });
        const html = overrides.override_body_html
          ? EmailComposeService.resolveWithVars(overrides.override_body_html, composeVars, { escape: true })
          : (await EmailTemplateService.render('saved_export_email', composeVars)).html;

        // Recipients: explicit override list OR fall back to the saved
        // recipient_ids (resolved to active emails).
        let toList;
        if (Array.isArray(overrides.override_to) && overrides.override_to.length > 0) {
          toList = overrides.override_to.map(s => String(s).trim()).filter(Boolean);
        } else {
          const recipientIds = normalizeJsonArray(savedExport.recipients);
          const recipients = recipientIds.length === 0 ? [] : await db('users')
            .whereIn('id', recipientIds).where('active', true).whereNotNull('email').select('email');
          skipped = recipientIds.length - recipients.length;
          toList = recipients.map(r => r.email).filter(Boolean);
        }
        const ccList = Array.isArray(overrides.extra_cc)
          ? overrides.extra_cc.map(s => String(s).trim()).filter(Boolean)
          : [];

        if (toList.length === 0) {
          status = 'no_recipients';
          await this._stamp(savedExport.id, status, null);
          return { delivered: 0, failed: 0, skipped, rowCount, status };
        }

        const res = await NotificationService.sendEmailWithAttachment({
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          html,
          filePath: tmpPath,
          filename,
          contentType: 'text/csv',
        });
        if (res && res.delivered) {
          delivered = toList.length;
        } else {
          failed = toList.length;
          if (res && res.reason) deliveryErrors.push(res.reason);
        }
      } else {
        // ── Default (template-driven) path: per-recipient fan-out ────
        const recipientIds = normalizeJsonArray(savedExport.recipients);
        const recipients = recipientIds.length === 0 ? [] : await db('users')
          .whereIn('id', recipientIds)
          .where('active', true)
          .select('id', 'email');

        skipped = recipientIds.length - recipients.length;

        // Subject + body come from the admin-editable `saved_export_email`
        // template (see migration 20260518_011_email_templates). Rendered
        // once; reused for every recipient.
        const rendered = await EmailTemplateService.render('saved_export_email', {
          name: savedExport.name,
          source: savedExport.source,
          rowCount,
          whenUtc,
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
