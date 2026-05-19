/**
 * Email Compose Service
 *
 * Powers the compose modal that sits between "user clicks send" and the
 * actual email fan-out at Scheduler → Email Day to Staff and Saved
 * Exports → Run now.
 *
 * Two responsibilities:
 *
 *   getCatalog(context, ids)
 *       Returns a list of variables available in the given send context,
 *       each with a sample value resolved from live data, plus default
 *       To/Subject/Body pre-fills (auto-resolved recipients + the active
 *       template for that surface). Powers the variable picker in the UI.
 *
 *   resolve(context, ids, rawString, runtimeExtras?, opts?)
 *       Substitutes `{{var}}` tokens in `rawString` against the live data
 *       for the context. Runtime extras (e.g. rowCount, whenUtc that only
 *       exist at actual-send time) are merged on top of the DB-derived
 *       vars before substitution. `opts.escape` controls HTML-escaping
 *       of values — true (default) for body, false for subject.
 *
 * Context shapes (v1):
 *
 *   email_day_to_staff   ids: { project_id, date }
 *   saved_export_run     ids: { saved_export_id }
 *
 * Equipment-ticket-pickup is deferred — added when that branch lands.
 */

const db = require('../config/database');

const EmailComposeService = {
  async getCatalog(context, ids = {}) {
    if (context === 'email_day_to_staff') return getEmailDayCatalog(ids);
    if (context === 'saved_export_run') return getSavedExportCatalog(ids);
    throw new Error(`Unknown compose context: ${context}`);
  },

  async getVars(context, ids = {}, runtimeExtras = {}) {
    if (context === 'email_day_to_staff') {
      const L = await emailDayLookups(ids);
      return { ...emailDayVarsFromLookups(L, ids.date), ...runtimeExtras };
    }
    if (context === 'saved_export_run') {
      return computeSavedExportVars(ids, runtimeExtras);
    }
    throw new Error(`Unknown compose context: ${context}`);
  },

  async resolve(context, ids, rawString, runtimeExtras = {}, opts = {}) {
    const vars = await this.getVars(context, ids, runtimeExtras);
    return substitute(rawString, vars, opts);
  },

  // Synchronous resolve when the caller already has the vars dict — saves
  // a round-trip when resolving multiple strings (subject + body + …).
  resolveWithVars(rawString, vars, opts = {}) {
    return substitute(rawString, vars, opts);
  },
};

// ─── Email Day to Staff context ───────────────────────────────────────

async function emailDayLookups(ids) {
  const { project_id, date } = ids;
  if (!project_id) throw new Error('email_day_to_staff requires project_id');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('email_day_to_staff requires date in YYYY-MM-DD');

  const project = await db('projects').where('id', project_id).first();
  if (!project) throw new Error(`Project not found: ${project_id}`);

  // Parallel: PM + 4 entity joins + project numbers + crew + day note. Each
  // is a single-row PK/composite lookup so the total wall-clock is ~one
  // round-trip. Resists race conditions because nothing here writes.
  const [pm, customer, location, customer_contact, site_contact, all_numbers, crew, dayNoteRow] = await Promise.all([
    project.pm_id ? db('users').where('id', project.pm_id).first(['first_name', 'last_name', 'email', 'initials']) : null,
    project.customer_id ? db('customers').where('id', project.customer_id).first() : null,
    project.location_id ? db('locations').where('id', project.location_id).first() : null,
    project.customer_contact_id ? db('contacts').where('id', project.customer_contact_id).first() : null,
    project.site_contact_id ? db('contacts').where('id', project.site_contact_id).first() : null,
    db('project_numbers').where({ project_id }),
    db('worker_assignments as wa')
      .leftJoin('users', 'wa.worker_id', 'users.id')
      .where({ 'wa.project_id': project_id, 'wa.work_date': date })
      .select('wa.worker_id', 'users.email', db.raw("users.first_name || ' ' || users.last_name as name")),
    db('project_day_notes').where({ project_id, work_date: date }).first(),
  ]);

  return { project, pm, customer, location, customer_contact, site_contact, all_numbers, crew, day_note: dayNoteRow?.notes || '' };
}

function emailDayVarsFromLookups(L, date) {
  const primary = (L.all_numbers || []).find(pn => pn.label === 'Primary');
  const vars = {
    'project.name': L.project.name || '',
    'project.year': L.project.year || '',
    'project.status': L.project.status || '',
    'project.contract_value': L.project.contract_value || '',
    'project.contract_type': L.project.contract_type || '',
    'project.address': L.project.address || '',
    'project.primary_number': primary?.number || '',
    'pm.first_name': L.pm?.first_name || '',
    'pm.last_name': L.pm?.last_name || '',
    'pm.email': L.pm?.email || '',
    'pm.initials': L.pm?.initials || '',
    'customer.name': L.customer?.name || '',
    'customer.billing_display_address': L.customer?.billing_display_address || '',
    'location.name': L.location?.name || '',
    'location.display_address': L.location?.display_address || '',
    'location.local_union': L.location?.local_union || '',
    'customer_contact.name': L.customer_contact?.name || '',
    'customer_contact.email': L.customer_contact?.email || '',
    'customer_contact.phone': L.customer_contact?.phone || '',
    'site_contact.name': L.site_contact?.name || '',
    'site_contact.email': L.site_contact?.email || '',
    'site_contact.phone': L.site_contact?.phone || '',
    date,
    'crew.count': L.crew.length,
    'crew.names': L.crew.map(c => c.name).filter(Boolean).join(', '),
    'crew.emails': L.crew.map(c => c.email).filter(Boolean).join(', '),
    day_note: L.day_note || '',
  };

  // Dynamic project-number variables — one var per non-Primary label
  // currently in the data. Labels get slugged for use in the var key
  // (e.g. "Customer PO #" → project_numbers.customer_po).
  for (const pn of L.all_numbers || []) {
    if (pn.label === 'Primary') continue;
    vars[`project_numbers.${slugLabel(pn.label)}`] = pn.number;
  }

  // ── Legacy aliases ──────────────────────────────────────────────────
  // The email_day_to_staff template seeded in migration 011/013 uses
  // pre-compose variable names ({{project_number}}, {{project_name}},
  // {{location}}, {{crew_count}}, {{crew_names}}, {{day_notes}}). When a
  // user opens that template in the compose modal, the pre-filled body
  // still contains those legacy tokens. Map them to the canonical values
  // so substitution Just Works regardless of which key form a template
  // author chose. New templates should use the canonical structured keys
  // (`project.primary_number`, etc.) — the catalog only exposes those.
  vars.project_number = vars['project.primary_number'];
  vars.project_name = vars['project.name'];
  vars.location = vars['project.address'];
  vars.crew_count = vars['crew.count'];
  vars.crew_names = vars['crew.names'];
  vars.day_notes = vars.day_note;

  return vars;
}

async function getEmailDayCatalog(ids) {
  const L = await emailDayLookups(ids);
  const vars = emailDayVarsFromLookups(L, ids.date);

  const catalogVars = [
    cv('project.name', 'Project: Name', vars['project.name']),
    cv('project.primary_number', 'Project: Primary #', vars['project.primary_number']),
    cv('project.year', 'Project: Year', vars['project.year']),
    cv('project.status', 'Project: Status', vars['project.status']),
    cv('project.address', 'Project: Address', vars['project.address']),
    cv('project.contract_type', 'Project: Contract Type', vars['project.contract_type']),

    cv('pm.first_name', 'PM: First Name', vars['pm.first_name']),
    cv('pm.last_name', 'PM: Last Name', vars['pm.last_name']),
    cv('pm.email', 'PM: Email', vars['pm.email'], { emailable: true }),
    cv('pm.initials', 'PM: Initials', vars['pm.initials']),

    cv('customer.name', 'Customer: Name', vars['customer.name']),
    cv('customer.billing_display_address', 'Customer: Billing Address', vars['customer.billing_display_address']),

    cv('customer_contact.name', 'Customer Contact: Name', vars['customer_contact.name']),
    cv('customer_contact.email', 'Customer Contact: Email', vars['customer_contact.email'], { emailable: true }),
    cv('customer_contact.phone', 'Customer Contact: Phone', vars['customer_contact.phone']),

    cv('site_contact.name', 'Site Contact: Name', vars['site_contact.name']),
    cv('site_contact.email', 'Site Contact: Email', vars['site_contact.email'], { emailable: true }),
    cv('site_contact.phone', 'Site Contact: Phone', vars['site_contact.phone']),

    cv('location.name', 'Location: Name', vars['location.name']),
    cv('location.display_address', 'Location: Address', vars['location.display_address']),
    cv('location.local_union', 'Location: Local Union', vars['location.local_union']),

    cv('date', 'Date', vars.date),
    cv('crew.count', 'Crew: Count', vars['crew.count']),
    cv('crew.names', 'Crew: Names (comma)', vars['crew.names']),
    cv('day_note', 'Day Note', vars.day_note),
  ];

  // Dynamic SPN entries — one chip per non-Primary label in the data.
  for (const pn of L.all_numbers || []) {
    if (pn.label === 'Primary') continue;
    const key = `project_numbers.${slugLabel(pn.label)}`;
    catalogVars.push(cv(key, `Project Number: ${pn.label}`, pn.number));
  }

  // Defaults: auto-resolved To (the crew), Subject + Body from the
  // email_day_to_staff template. The modal pre-fills with these and
  // the user tweaks before Send.
  const tpl = await db('email_templates').where('key', 'email_day_to_staff').first();
  const defaultTo = (L.crew || [])
    .filter(c => c.email)
    .map(c => ({ id: c.worker_id, email: c.email, label: c.name || c.email }));

  return {
    vars: catalogVars,
    defaults: {
      to: defaultTo,
      subject: tpl?.subject || '',
      body_html: tpl?.body_html || '',
    },
  };
}

// ─── Saved Export Run context ─────────────────────────────────────────

async function getSavedExportCatalog(ids) {
  const { saved_export_id } = ids;
  if (!saved_export_id) throw new Error('saved_export_run requires saved_export_id');

  const se = await db('saved_exports').where('id', saved_export_id).first();
  if (!se) throw new Error(`Saved export not found: ${saved_export_id}`);

  const owner = se.owner_user_id
    ? await db('users').where('id', se.owner_user_id).first(['first_name', 'last_name', 'email'])
    : null;

  const recipientIds = parseJsonArray(se.recipients);
  const recipients = recipientIds.length === 0
    ? []
    : await db('users')
        .whereIn('id', recipientIds).where('active', true).whereNotNull('email')
        .select('id', 'email', db.raw("first_name || ' ' || last_name as name"));

  const sampleWhen = new Date().toISOString().replace('T', ' ').replace(/\..*$/, '');

  const catalogVars = [
    cv('name', 'Export Name', se.name),
    cv('source', 'Export Source', se.source),
    cv('rowCount', 'Row count (filled at send)', 0),
    cv('whenUtc', 'Send timestamp (filled at send)', sampleWhen),
    cv('owner.first_name', 'Owner: First Name', owner?.first_name || ''),
    cv('owner.last_name', 'Owner: Last Name', owner?.last_name || ''),
    cv('owner.email', 'Owner: Email', owner?.email || '', { emailable: true }),
  ];

  const tpl = await db('email_templates').where('key', 'saved_export_email').first();
  const defaultTo = recipients.map(r => ({ id: r.id, email: r.email, label: r.name || r.email }));

  return {
    vars: catalogVars,
    defaults: {
      to: defaultTo,
      subject: tpl?.subject || '',
      body_html: tpl?.body_html || '',
    },
  };
}

async function computeSavedExportVars(ids, runtimeExtras) {
  const { saved_export_id } = ids;
  if (!saved_export_id) throw new Error('saved_export_run requires saved_export_id');
  const se = await db('saved_exports').where('id', saved_export_id).first();
  if (!se) throw new Error(`Saved export not found: ${saved_export_id}`);

  const owner = se.owner_user_id
    ? await db('users').where('id', se.owner_user_id).first(['first_name', 'last_name', 'email'])
    : null;

  return {
    name: se.name,
    source: se.source,
    rowCount: runtimeExtras.rowCount ?? 0,
    whenUtc: runtimeExtras.whenUtc ?? new Date().toISOString().replace('T', ' ').replace(/\..*$/, ''),
    'owner.first_name': owner?.first_name || '',
    'owner.last_name': owner?.last_name || '',
    'owner.email': owner?.email || '',
    ...runtimeExtras,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

function cv(key, label, sample, extra = {}) {
  return { key, label, sample: sample == null ? '' : String(sample), emailable: !!extra.emailable };
}

function substitute(rawString, vars, opts = {}) {
  if (typeof rawString !== 'string' || rawString.length === 0) return '';
  const escape = opts.escape !== false; // default: escape (body)
  return rawString.replace(/\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    const s = String(v);
    return escape ? escapeHtml(s) : s;
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

function slugLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'label';
}

function parseJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

module.exports = EmailComposeService;
// Exposed for unit testing.
module.exports._substitute = substitute;
module.exports._escapeHtml = escapeHtml;
module.exports._slugLabel = slugLabel;
