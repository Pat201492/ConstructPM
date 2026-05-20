/**
 * Email Template Service
 *
 * Loads rows from the `email_templates` table and renders subject + body
 * with Mustache-flavoured `{{var}}` / `{{{var}}}` substitution.
 *
 *   {{var}}    HTML-escaped value         (default — safe for user input)
 *   {{{var}}}  Raw value, no escape       (only use when the value is
 *                                          already HTML — e.g. a runner-
 *                                          built table block)
 *
 * Missing variables render as empty string and are not an error — keeps
 * a template author from breaking the run by referencing a not-yet-wired
 * variable. The list of unresolved keys is returned alongside the output
 * so callers/tests can surface it if they want.
 *
 * No caching in v1: single-row PK lookups are cheap and avoids stale-
 * cache foot-guns across processes.
 */

const db = require('../config/database');

const EmailTemplateService = {
  /**
   * Load a template by key.
   * Returns null if no row exists — callers should fall back gracefully.
   */
  async get(key) {
    if (!key) return null;
    const row = await db('email_templates').where('key', key).first();
    if (!row) return null;
    return {
      ...row,
      variables: typeof row.variables === 'string' ? JSON.parse(row.variables) : (row.variables || []),
    };
  },

  /**
   * List every template (admin editor).
   */
  async list() {
    const rows = await db('email_templates').orderBy('name');
    return rows.map(r => ({
      ...r,
      variables: typeof r.variables === 'string' ? JSON.parse(r.variables) : (r.variables || []),
    }));
  },

  /**
   * Update an editable subset of fields. `updated_by` is taken from the
   * authenticated user passed in. Returns the updated row (serialised).
   */
  async update(key, patch, userId) {
    const allowed = ['name', 'subject', 'body_html', 'body_text', 'variables'];
    const update = {};
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      if (k === 'variables') {
        const v = patch.variables;
        if (!Array.isArray(v)) throw new Error('variables must be an array');
        update.variables = JSON.stringify(v);
      } else {
        update[k] = patch[k];
      }
    }
    if (Object.keys(update).length === 0) throw new Error('No fields to update');

    update.updated_by = userId || null;
    update.updated_at = db.fn.now();

    const [row] = await db('email_templates').where('key', key).update(update).returning('*');
    if (!row) throw new Error(`No template with key "${key}"`);
    return {
      ...row,
      variables: typeof row.variables === 'string' ? JSON.parse(row.variables) : (row.variables || []),
    };
  },

  /**
   * Render a template by key. Returns { subject, html, text, unresolved[] }.
   * Throws if the template doesn't exist (callers shouldn't render against
   * a missing template — that's a bug, not a recoverable state).
   *
   * When `userId` is supplied, an entry in `email_template_user_overrides`
   * (user_id, key) is consulted first; non-null fields on the override row
   * supersede the admin row's subject/body_html/body_text. Null fields
   * inherit from the admin row, so a user can override just the subject
   * and keep the admin body (or vice versa).
   *
   * `subject` is rendered WITHOUT HTML-escape — it lands in the Subject:
   * header, not the body, and HTML entities are literal there ("Acme & Co"
   * must come through as "Acme & Co", not "Acme &amp; Co"). `body_html`
   * and `body_text` are rendered with the default escape behaviour.
   */
  async render(key, vars = {}, userId = null) {
    const tpl = await this.get(key);
    if (!tpl) throw new Error(`Email template not found: ${key}`);

    let subjectSrc = tpl.subject || '';
    let htmlSrc = tpl.body_html || '';
    let textSrc = tpl.body_text || null;

    if (userId) {
      const override = await db('email_template_user_overrides')
        .where({ user_id: userId, key })
        .first();
      if (override) {
        if (override.subject != null) subjectSrc = override.subject;
        if (override.body_html != null) htmlSrc = override.body_html;
        if (override.body_text != null) textSrc = override.body_text;
      }
    }

    const unresolved = new Set();
    const subject = renderString(subjectSrc, vars, unresolved, { escape: false });
    const html = renderString(htmlSrc, vars, unresolved);
    const text = textSrc ? renderString(textSrc, vars, unresolved, { escape: false }) : null;
    return { subject, html, text, unresolved: [...unresolved] };
  },

  /**
   * Render a template against its own declared `variables[].sample` values
   * — used by the admin preview endpoint so authors can see their work
   * without wiring real data.
   */
  async preview(key, overrides = {}) {
    const tpl = await this.get(key);
    if (!tpl) throw new Error(`Email template not found: ${key}`);
    const sampleVars = {};
    for (const v of tpl.variables || []) {
      if (v && typeof v.key === 'string') sampleVars[v.key] = v.sample == null ? '' : v.sample;
    }
    const merged = { ...sampleVars, ...overrides };
    return this.render(key, merged);
  },

  /**
   * Fetch a user's override row for a template, or null if none. Caller
   * is expected to be the user themselves (route gate, not service-level).
   */
  async getUserOverride(userId, key) {
    if (!userId || !key) return null;
    const row = await db('email_template_user_overrides')
      .where({ user_id: userId, key })
      .first();
    return row || null;
  },

  /**
   * Upsert a user's override. `patch` may contain any of subject /
   * body_html / body_text — null clears that field back to inherit. Other
   * fields not present in `patch` are left untouched on an existing row.
   * Throws if `key` does not exist in email_templates.
   */
  async setUserOverride(userId, key, patch) {
    if (!userId) throw new Error('userId required');
    const tpl = await this.get(key);
    if (!tpl) throw new Error(`Email template not found: ${key}`);

    const allowed = ['subject', 'body_html', 'body_text'];
    const update = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, k)) update[k] = patch[k];
    }

    const existing = await db('email_template_user_overrides')
      .where({ user_id: userId, key })
      .first();

    if (existing) {
      if (Object.keys(update).length === 0) return existing;
      update.updated_at = db.fn.now();
      const [row] = await db('email_template_user_overrides')
        .where({ user_id: userId, key })
        .update(update)
        .returning('*');
      return row;
    }

    // No existing row + nothing to write would just create an all-null
    // row that's indistinguishable from "no override". Skip the insert
    // and report null so the caller knows nothing was persisted.
    if (Object.keys(update).length === 0) return null;

    const [row] = await db('email_template_user_overrides')
      .insert({ user_id: userId, key, ...update })
      .returning('*');
    return row;
  },

  /**
   * Drop a user's override row entirely (back to admin default).
   */
  async clearUserOverride(userId, key) {
    if (!userId || !key) return 0;
    return db('email_template_user_overrides')
      .where({ user_id: userId, key })
      .del();
  },

  /**
   * Preview a user-scoped render against the template's declared samples.
   * `overrides` is an unsaved patch the UI sends so the user can see what
   * their in-flight edit will look like without persisting it.
   */
  async previewWithOverride(key, userId, overrides = {}) {
    const tpl = await this.get(key);
    if (!tpl) throw new Error(`Email template not found: ${key}`);
    const sampleVars = {};
    for (const v of tpl.variables || []) {
      if (v && typeof v.key === 'string') sampleVars[v.key] = v.sample == null ? '' : v.sample;
    }

    // Field resolution order: admin default → persisted user override
    // (null fields inherit) → unsaved preview patch. In the patch we
    // distinguish ABSENT (key not present → keep prior) from NULL
    // (explicit clear → snap back to admin default for that field) so
    // the UI can preview a "reset to default" without persisting it.
    let subjectSrc = tpl.subject || '';
    let htmlSrc = tpl.body_html || '';
    let textSrc = tpl.body_text || null;

    const persisted = userId ? await this.getUserOverride(userId, key) : null;
    if (persisted) {
      if (persisted.subject != null) subjectSrc = persisted.subject;
      if (persisted.body_html != null) htmlSrc = persisted.body_html;
      if (persisted.body_text != null) textSrc = persisted.body_text;
    }

    if (overrides && typeof overrides === 'object') {
      const has = (k) => Object.prototype.hasOwnProperty.call(overrides, k);
      if (has('subject')) subjectSrc = overrides.subject == null ? (tpl.subject || '') : overrides.subject;
      if (has('body_html')) htmlSrc = overrides.body_html == null ? (tpl.body_html || '') : overrides.body_html;
      if (has('body_text')) textSrc = overrides.body_text == null ? (tpl.body_text || null) : overrides.body_text;
    }

    const unresolved = new Set();
    const subject = renderString(subjectSrc, sampleVars, unresolved, { escape: false });
    const html = renderString(htmlSrc, sampleVars, unresolved);
    const text = textSrc ? renderString(textSrc, sampleVars, unresolved, { escape: false }) : null;
    return { subject, html, text, unresolved: [...unresolved] };
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

// Single-pass alternation so a raw `{{{var}}}` whose VALUE happens to
// contain a `{{...}}` substring isn't re-substituted by a second pass.
// The triple branch is listed first; on overlap, JS regex engines pick
// the longer match, which is the triple. The double branch only fires
// on text that didn't match the triple.
const MUSTACHE_RE = /\{\{\{\s*([a-zA-Z_][\w]*)\s*\}\}\}|\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;

function renderString(input, vars, unresolved, opts = {}) {
  if (typeof input !== 'string' || input.length === 0) return '';
  const escape = opts.escape !== false; // default: escape
  return input.replace(MUSTACHE_RE, (_m, rawName, escName) => {
    const name = rawName || escName;
    const isRaw = !!rawName;
    const val = vars[name];
    if (val === undefined || val === null) { unresolved.add(name); return ''; }
    const s = String(val);
    return (isRaw || !escape) ? s : escapeHtml(s);
  });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = EmailTemplateService;
// Exposed for unit testing — renderString is the core escape + substitution
// helper and the location of the bugs the v0 implementation shipped with
// (subject double-escape, triple-mustache double-substitution). Keep the
// underscore prefix so it's clear this isn't a stable public API.
module.exports._renderString = renderString;
module.exports._escapeHtml = escapeHtml;
