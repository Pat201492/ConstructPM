/**
 * Email Trigger Recipients Service
 *
 * Admin-configured static recipient lists per trigger (per email template
 * key). Used by triggers that need to merge a fixed set of recipients
 * (e.g. shop manager for ticket pickups) with the auto-resolved modular
 * recipients each trigger computes from the row being acted on.
 *
 *   resolve(key, modularEmails) -> { to, cc }
 *
 * Static recipients can be raw emails (`static_emails`) or user UUIDs
 * (`static_user_ids`); UUIDs are resolved to live `users.email` at send
 * time so renaming or deactivating a user is reflected without a config
 * edit. Inactive users are dropped from the resolved list.
 */

const db = require('../config/database');

const EmailTriggerRecipientsService = {
  /**
   * Fetch the static recipient row for a template key, or a zero-state
   * object if none exists. Callers can render the response shape
   * unconditionally.
   */
  async get(key) {
    if (!key) return null;
    const row = await db('email_trigger_recipients').where('key', key).first();
    if (!row) {
      return { key, static_emails: [], static_user_ids: [], cc_emails: [] };
    }
    return {
      key: row.key,
      static_emails: parseJsonArray(row.static_emails),
      static_user_ids: parseJsonArray(row.static_user_ids),
      cc_emails: parseJsonArray(row.cc_emails),
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    };
  },

  /**
   * Upsert the static recipient row for a template key. `patch` may
   * contain any of static_emails / static_user_ids / cc_emails as arrays;
   * fields not present are left untouched on an existing row.
   * Throws if `key` does not exist in email_templates.
   */
  async set(key, patch, updatedBy) {
    if (!key) throw new Error('key required');
    const tpl = await db('email_templates').where('key', key).first();
    if (!tpl) throw new Error(`Email template not found: ${key}`);

    const allowed = ['static_emails', 'static_user_ids', 'cc_emails'];
    const update = {};
    for (const k of allowed) {
      if (!Object.prototype.hasOwnProperty.call(patch || {}, k)) continue;
      const v = patch[k];
      if (!Array.isArray(v)) throw new Error(`${k} must be an array`);
      update[k] = JSON.stringify(v);
    }

    const existing = await db('email_trigger_recipients').where('key', key).first();

    if (existing) {
      if (Object.keys(update).length === 0) return this.get(key);
      update.updated_by = updatedBy || null;
      update.updated_at = db.fn.now();
      await db('email_trigger_recipients').where('key', key).update(update);
      return this.get(key);
    }

    await db('email_trigger_recipients').insert({
      key,
      static_emails: update.static_emails || JSON.stringify([]),
      static_user_ids: update.static_user_ids || JSON.stringify([]),
      cc_emails: update.cc_emails || JSON.stringify([]),
      updated_by: updatedBy || null,
    });
    return this.get(key);
  },

  /**
   * Merge admin static recipients (resolving user UUIDs to live emails)
   * with the caller-supplied modular list. Deduplicates case-insensitively.
   * Returns { to, cc } as deduped arrays of strings — callers feed both
   * directly to NotificationService.sendEmail{,WithAttachment}.
   */
  async resolve(key, modularEmails = []) {
    const row = await this.get(key);
    const userEmails = row.static_user_ids.length > 0
      ? await db('users')
          .whereIn('id', row.static_user_ids)
          .andWhere('active', true)
          .pluck('email')
      : [];
    const to = dedupe([...(modularEmails || []), ...row.static_emails, ...userEmails]);
    const cc = dedupe(row.cc_emails);
    return { to, cc };
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr || []) {
    if (!raw) continue;
    const s = String(raw).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

module.exports = EmailTriggerRecipientsService;
