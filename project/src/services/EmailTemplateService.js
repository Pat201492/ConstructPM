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
   * `subject` is rendered WITHOUT HTML-escape — it lands in the Subject:
   * header, not the body, and HTML entities are literal there ("Acme & Co"
   * must come through as "Acme & Co", not "Acme &amp; Co"). `body_html`
   * and `body_text` are rendered with the default escape behaviour.
   */
  async render(key, vars = {}) {
    const tpl = await this.get(key);
    if (!tpl) throw new Error(`Email template not found: ${key}`);
    const unresolved = new Set();
    const subject = renderString(tpl.subject || '', vars, unresolved, { escape: false });
    const html = renderString(tpl.body_html || '', vars, unresolved);
    const text = tpl.body_text ? renderString(tpl.body_text, vars, unresolved, { escape: false }) : null;
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
