/**
 * Migration: email_day_to_staff — crew email states the single crew day AND
 * the whole project's run span.
 *
 * Issue #68. The body must read:
 *
 *   "You're on the crew for {{project_name}} ({{project_number}}) on {{date}}.
 *    The project runs from {{project_start_date}} to {{project_end_date}}."
 *
 * followed by the existing location / site contact / crew / notes lines. It
 * must NEVER phrase it as "you are on the crew from X to Y" — the single crew
 * day ({{date}}) and the project run span are two distinct statements.
 *
 * Follows the pattern of 20260522_010_refresh_email_template_defaults.js:
 * ONLY a row whose body still matches the previous canonical default is
 * rewritten, so an admin-customised template is left untouched. Each field
 * (body_html, body_text) is gated independently against its prior default.
 *
 * `down` restores the previous default (again, only where the body still
 * matches the new default this migration wrote).
 *
 * NOTE: the Site-Contact line contains a literal em-dash (—). This file is
 * UTF-8; do not re-save it through an ANSI-codepage shell redirect.
 */

// Previous canonical default (from migration 010).
const PREV_HTML =
  "<p>You're on the crew for <strong>{{project_name}}</strong> ({{project_number}}) on <strong>{{date}}</strong>.</p>\n"
  + '<p><strong>Location:</strong> {{{location.map_link}}}</p>\n'
  + '<p><strong>Site Contact:</strong> {{site_contact.name}} — {{site_contact.phone}}</p>\n'
  + '<p><strong>Crew ({{crew_count}}):</strong> {{crew_names}}</p>\n'
  + '<p>{{day_notes}}</p>';

const PREV_TEXT =
  "You're on the crew for {{project_name}} ({{project_number}}) on {{date}}.\n"
  + 'Location: {{location}}\n'
  + 'Crew ({{crew_count}}): {{crew_names}}\n'
  + '{{day_notes}}';

// New canonical default — adds the project run-span sentence.
const NEW_HTML =
  "<p>You're on the crew for <strong>{{project_name}}</strong> ({{project_number}}) on <strong>{{date}}</strong>. The project runs from <strong>{{project_start_date}}</strong> to <strong>{{project_end_date}}</strong>.</p>\n"
  + '<p><strong>Location:</strong> {{{location.map_link}}}</p>\n'
  + '<p><strong>Site Contact:</strong> {{site_contact.name}} — {{site_contact.phone}}</p>\n'
  + '<p><strong>Crew ({{crew_count}}):</strong> {{crew_names}}</p>\n'
  + '<p>{{day_notes}}</p>';

const NEW_TEXT =
  "You're on the crew for {{project_name}} ({{project_number}}) on {{date}}. The project runs from {{project_start_date}} to {{project_end_date}}.\n"
  + 'Location: {{location}}\n'
  + 'Crew ({{crew_count}}): {{crew_names}}\n'
  + '{{day_notes}}';

// Variables to surface in the admin Templates picker alongside the rest.
const NEW_VARS = [
  { key: 'project_start_date', label: 'Project start date (same format as Date)', sample: '2026-06-01' },
  { key: 'project_end_date', label: 'Project end date (computed from length in working days)', sample: '2026-06-05' },
];

function ensureVars(rawVariables, additions) {
  let vars = [];
  try { vars = typeof rawVariables === 'string' ? JSON.parse(rawVariables) : (rawVariables || []); } catch { vars = []; }
  for (const a of additions) {
    if (!vars.some(v => v && v.key === a.key)) vars.push(a);
  }
  return vars;
}

// Rewrite from `fromHtml`/`fromText` → `toHtml`/`toText`, gating each field
// independently so an admin who customised only one is left untouched.
async function rewrite(knex, { fromHtml, fromText, toHtml, toText, addVars }) {
  const row = await knex('email_templates').where({ key: 'email_day_to_staff' }).first();
  if (!row) {
    console.log('  (email_day_to_staff template missing — skipping)');
    return;
  }

  const patch = {};
  if (row.body_html === fromHtml) patch.body_html = toHtml;
  if (row.body_text === fromText) patch.body_text = toText;

  if (Object.keys(patch).length === 0) {
    console.log('  (email_day_to_staff body differs from the expected default — left unchanged)');
    return;
  }

  if (addVars) patch.variables = JSON.stringify(ensureVars(row.variables, addVars));
  patch.updated_at = knex.fn.now();

  await knex('email_templates').where({ key: 'email_day_to_staff' }).update(patch);
  console.log('  ✅ email_day_to_staff body updated with project run-span wording');
}

exports.up = async function (knex) {
  await rewrite(knex, {
    fromHtml: PREV_HTML,
    fromText: PREV_TEXT,
    toHtml: NEW_HTML,
    toText: NEW_TEXT,
    addVars: NEW_VARS,
  });
};

exports.down = async function (knex) {
  await rewrite(knex, {
    fromHtml: NEW_HTML,
    fromText: NEW_TEXT,
    toHtml: PREV_HTML,
    toText: PREV_TEXT,
    addVars: null,
  });
};
