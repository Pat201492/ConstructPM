/**
 * Export Metadata — single source of truth for both the UI column picker
 * and the SQL builder.
 *
 * Concepts
 * ─────────
 * - SOURCE         A starting table. Has `native` columns (its own fields) and
 *                  `joins` (aliased references to related tables).
 * - JOINABLE       Per-target-table column list. Whatever a target table
 *                  exposes here is what every join to it can pull. Same
 *                  table can be joined multiple times under different aliases
 *                  (Customer Contact vs Site Contact both join `contacts`).
 * - ENRICHMENT     Columns computed post-query in JS, not SELECTed in SQL.
 *                  Used for 1:many lookups like project_numbers.
 *
 * Column key format (relative to source)
 * ──────────────────────────────────────
 *   Native:   `<column>`              e.g. `name`, `contract_value`
 *   Joined:   `<alias>.<column>`      e.g. `customer_contact.phone`, `pm.first_name`
 *   Enriched: `<enrichment>.<key>`    e.g. `project_numbers.primary`, `project_numbers.all`
 *
 * Adding a column: edit the appropriate list. Adding a join: add to the
 * source's `joins`; the target's JOINABLE columns become available
 * automatically. Adding a source: add an entry to SOURCES and supply a
 * curated native column list. See docs/EXPORT_METADATA.md for examples.
 */

// ═══════════════════════════════════════════════════════════
// JOINABLE — columns exposed through ANY join to each table
// ═══════════════════════════════════════════════════════════

const JOINABLE = {
  customers: [
    { key: 'name', label: 'Name' },
    { key: 'billing_street', label: 'Billing Street' },
    { key: 'billing_town', label: 'Billing Town' },
    { key: 'billing_state', label: 'Billing State' },
    { key: 'billing_zip', label: 'Billing Zip' },
    { key: 'billing_display_address', label: 'Billing Address (display)' },
    { key: 'notes', label: 'Notes' },
  ],
  locations: [
    { key: 'name', label: 'Name' },
    { key: 'street', label: 'Street' },
    { key: 'town', label: 'Town' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'Zip' },
    { key: 'display_address', label: 'Address (display)' },
    { key: 'local_union', label: 'Local Union' },
    { key: 'miles_from_hq', label: 'Miles from HQ' },
  ],
  users: [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'initials', label: 'Initials' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role' },
  ],
  contacts: [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'company', label: 'Company' },
    { key: 'contact_code', label: 'Contact ID' },
  ],
  projects: [
    { key: 'name', label: 'Project Name' },
    { key: 'year', label: 'Year' },
    { key: 'status', label: 'Status' },
    { key: 'contract_type', label: 'Contract Type' },
    { key: 'contract_value', label: 'Contract Value' },
    { key: 'payment_terms', label: 'Payment Terms' },
    { key: 'local_union', label: 'Local Union' },
    { key: 'start_date', label: 'Start Date' },
    { key: 'end_date', label: 'End Date' },
  ],
  bids: [
    { key: 'bid_number', label: 'Bid Number' },
    { key: 'project_scope', label: 'Scope' },
    { key: 'status', label: 'Status' },
    { key: 'bid_amount', label: 'Bid Amount' },
    { key: 'bid_date', label: 'Bid Date' },
    { key: 'won_date', label: 'Won Date' },
  ],
};

// ═══════════════════════════════════════════════════════════
// SHARED ENRICHMENTS — post-query lookups keyed by an ID column
// ═══════════════════════════════════════════════════════════
//
// project_numbers is 1:many with user-extensible labels. We expose:
//   - `primary` — the number where label='Primary' (the common ask)
//   - `all`     — a `Label: Number; Label: Number; …` join of every entry,
//                 so user-defined labels (Customer PO #, Internal #, …)
//                 survive without code changes.
//
// Any source whose `projectIdColumn` is set will get these columns offered.

const PROJECT_NUMBER_COLUMNS = [
  { key: 'project_numbers.primary', label: 'Primary #' },
  { key: 'project_numbers.all', label: 'All Project Numbers' },
];

// ═══════════════════════════════════════════════════════════
// SOURCES — entry points for an export
// ═══════════════════════════════════════════════════════════
//
// Each source declares:
//   table             — SQL table name (also the alias used in column refs)
//   label             — UI display name
//   native[]          — { key, label, col? } own-table columns. `col` defaults
//                       to `<table>.<key>`.
//   joins{}           — aliased relations. Each: { target, on, via? }
//                       `on` is a raw SQL ON clause. `via` names another join
//                       in the same map that must be added first.
//   projectIdColumn?  — SQL ref to a project_id column on this source (or one
//                       of its joined tables). Presence enables project_numbers
//                       enrichment for this source.
//   dateColumn?       — SQL ref used by start_date/end_date filters
//   defaultSort?      — SQL ref used as default ORDER BY

const SOURCES = {
  projects: {
    table: 'projects',
    label: 'Projects',
    native: [
      { key: 'name', label: 'Project Name' },
      { key: 'year', label: 'Year' },
      { key: 'status', label: 'Status' },
      { key: 'contract_type', label: 'Contract Type' },
      { key: 'contract_value', label: 'Contract Value' },
      { key: 'contract_man_hours', label: 'Contract Man-Hours' },
      { key: 'payment_terms', label: 'Payment Terms' },
      { key: 'local_union', label: 'Local Union' },
      { key: 'miles_from_hq', label: 'Miles from HQ' },
      { key: 'address', label: 'Address' },
      { key: 'description', label: 'Description' },
      { key: 'start_date', label: 'Start Date' },
      { key: 'end_date', label: 'End Date' },
      { key: 'created_at', label: 'Created' },
      { key: 'updated_at', label: 'Updated' },
    ],
    joins: {
      customer:         { target: 'customers', on: 'projects.customer_id = customer.id' },
      location:         { target: 'locations', on: 'projects.location_id = location.id' },
      pm:               { target: 'users',     on: 'projects.pm_id = pm.id' },
      customer_contact: { target: 'contacts',  on: 'projects.customer_contact_id = customer_contact.id' },
      site_contact:     { target: 'contacts',  on: 'projects.site_contact_id = site_contact.id' },
      won_bid:          { target: 'bids',      on: 'projects.bid_id = won_bid.id' },
    },
    projectIdColumn: 'projects.id',
    dateColumn: 'projects.start_date',
    defaultSort: 'projects.name',
  },

  bids: {
    table: 'bids',
    label: 'Bids',
    native: [
      { key: 'bid_number', label: 'Bid Number' },
      { key: 'bid_date', label: 'Bid Date' },
      { key: 'due_date', label: 'Due Date' },
      { key: 'won_date', label: 'Won Date' },
      { key: 'archived_date', label: 'Archived Date' },
      { key: 'status', label: 'Status' },
      { key: 'project_scope', label: 'Scope' },
      { key: 'description', label: 'Description' },
      { key: 'bid_amount', label: 'Bid Amount' },
      { key: 'subtotal', label: 'Subtotal' },
      { key: 'total_labor_cost', label: 'Labor Cost' },
      { key: 'total_mileage_cost', label: 'Mileage Cost' },
      { key: 'markup_pct', label: 'Markup %' },
      { key: 'project_length_days', label: 'Project Length (days)' },
      { key: 'local_union', label: 'Local Union' },
      { key: 'miles_from_hq', label: 'Miles from HQ' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {
      customer:         { target: 'customers', on: 'bids.customer_id = customer.id' },
      location:         { target: 'locations', on: 'bids.location_id = location.id' },
      estimator:        { target: 'users',     on: 'bids.estimator_id = estimator.id' },
      customer_contact: { target: 'contacts',  on: 'bids.customer_contact_id = customer_contact.id' },
      site_contact:     { target: 'contacts',  on: 'bids.site_contact_id = site_contact.id' },
    },
    dateColumn: 'bids.bid_date',
    defaultSort: 'bids.bid_date',
  },

  invoices: {
    table: 'invoices',
    label: 'Invoices',
    native: [
      { key: 'invoice_number', label: 'Invoice Number' },
      { key: 'customer', label: 'Invoice Customer (from doc)' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'invoice_date', label: 'Invoice Date' },
      { key: 'payment_due_date', label: 'Payment Due' },
      { key: 'payment_received_date', label: 'Payment Received' },
      { key: 'payment_received_amount', label: 'Payment Received Amount' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {
      project:          { target: 'projects',  on: 'invoices.project_id = project.id' },
      customer:         { target: 'customers', on: 'project.customer_id = customer.id', via: 'project' },
      location:         { target: 'locations', on: 'project.location_id = location.id', via: 'project' },
      pm:               { target: 'users',     on: 'project.pm_id = pm.id',             via: 'project' },
      customer_contact: { target: 'contacts',  on: 'project.customer_contact_id = customer_contact.id', via: 'project' },
      site_contact:     { target: 'contacts',  on: 'project.site_contact_id = site_contact.id',         via: 'project' },
      confirmed_by:     { target: 'users',     on: 'invoices.confirmed_by = confirmed_by.id' },
    },
    projectIdColumn: 'invoices.project_id',
    dateColumn: 'invoices.invoice_date',
    defaultSort: 'invoices.invoice_date',
  },

  purchase_orders: {
    table: 'purchase_orders',
    label: 'Purchase Orders',
    native: [
      { key: 'po_number', label: 'PO Number' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'total', label: 'Total' },
      { key: 'status', label: 'Status' },
      { key: 'order_date', label: 'Order Date' },
      { key: 'delivery_date', label: 'Delivery Date' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {
      project:      { target: 'projects',  on: 'purchase_orders.project_id = project.id' },
      customer:     { target: 'customers', on: 'project.customer_id = customer.id', via: 'project' },
      location:     { target: 'locations', on: 'project.location_id = location.id', via: 'project' },
      pm:           { target: 'users',     on: 'project.pm_id = pm.id',             via: 'project' },
      confirmed_by: { target: 'users',     on: 'purchase_orders.confirmed_by = confirmed_by.id' },
    },
    projectIdColumn: 'purchase_orders.project_id',
    dateColumn: 'purchase_orders.order_date',
    defaultSort: 'purchase_orders.order_date',
  },

  timesheets: {
    table: 'timesheets',
    label: 'Timesheets',
    native: [
      { key: 'worker_name', label: 'Worker Name' },
      { key: 'classification', label: 'Classification' },
      { key: 'local_union', label: 'Local Union' },
      { key: 'work_date', label: 'Work Date' },
      { key: 'week_ending', label: 'Week Ending' },
      { key: 'days_worked', label: 'Days Worked' },
      { key: 'st_hours', label: 'ST Hours' },
      { key: 'ot_hours', label: 'OT Hours' },
      { key: 'dt_hours', label: 'DT Hours' },
      { key: 'miles_driven', label: 'Miles Driven' },
      { key: 'mileage_cost', label: 'Mileage Cost' },
      { key: 'per_diem_rate', label: 'Per Diem Rate' },
      { key: 'per_diem_total', label: 'Per Diem Total' },
      { key: 'billing_rate_st', label: 'ST Rate' },
      { key: 'billing_rate_ot', label: 'OT Rate' },
      { key: 'billing_rate_dt', label: 'DT Rate' },
      { key: 'potential_revenue', label: 'Potential Revenue' },
      { key: 'source', label: 'Source' },
      { key: 'approved', label: 'Approved' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {
      project:     { target: 'projects',  on: 'timesheets.project_id = project.id' },
      customer:    { target: 'customers', on: 'project.customer_id = customer.id', via: 'project' },
      location:    { target: 'locations', on: 'project.location_id = location.id', via: 'project' },
      pm:          { target: 'users',     on: 'project.pm_id = pm.id',             via: 'project' },
      approved_by: { target: 'users',     on: 'timesheets.approved_by = approved_by.id' },
    },
    projectIdColumn: 'timesheets.project_id',
    dateColumn: 'timesheets.work_date',
    defaultSort: 'timesheets.work_date',
  },

  equipment: {
    table: 'equipment',
    label: 'Equipment',
    native: [
      { key: 'barcode_id', label: 'Barcode' },
      { key: 'equipment_name', label: 'Equipment Name' },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'equipment_type', label: 'Type' },
      { key: 'equipment_subtype', label: 'Sub-type' },
      { key: 'status', label: 'Status' },
      { key: 'current_location', label: 'Current Location' },
      { key: 'certification_date', label: 'Cert Expiry' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {
      current_project: { target: 'projects', on: 'equipment.current_project_id = current_project.id' },
    },
    defaultSort: 'equipment.equipment_name',
  },

  customers: {
    table: 'customers',
    label: 'Customers',
    native: [
      { key: 'name', label: 'Name' },
      { key: 'billing_street', label: 'Billing Street' },
      { key: 'billing_town', label: 'Billing Town' },
      { key: 'billing_state', label: 'Billing State' },
      { key: 'billing_zip', label: 'Billing Zip' },
      { key: 'billing_display_address', label: 'Billing Address (display)' },
      { key: 'notes', label: 'Notes' },
      { key: 'active', label: 'Active' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {},
    defaultSort: 'customers.name',
  },

  locations: {
    table: 'locations',
    label: 'Locations',
    native: [
      { key: 'name', label: 'Name' },
      { key: 'street', label: 'Street' },
      { key: 'town', label: 'Town' },
      { key: 'state', label: 'State' },
      { key: 'zip', label: 'Zip' },
      { key: 'display_address', label: 'Address (display)' },
      { key: 'local_union', label: 'Local Union' },
      { key: 'miles_from_hq', label: 'Miles from HQ' },
      { key: 'active', label: 'Active' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {},
    defaultSort: 'locations.name',
  },

  contacts: {
    table: 'contacts',
    label: 'Contacts',
    native: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'company', label: 'Company' },
      { key: 'contact_code', label: 'Contact ID' },
      { key: 'active', label: 'Active' },
      { key: 'created_at', label: 'Created' },
    ],
    joins: {
      customer: { target: 'customers', on: 'contacts.customer_id = customer.id' },
    },
    defaultSort: 'contacts.name',
  },
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * UI shape: { [sourceKey]: { label, groups: [{ group, columns: [{key, label}] }] } }
 * Groups are: native columns → each join's columns → enrichments (if any).
 */
function getSourcesForUI() {
  const out = {};
  for (const [srcKey, src] of Object.entries(SOURCES)) {
    const groups = [
      {
        group: src.label,
        columns: src.native.map(c => ({ key: c.key, label: c.label })),
      },
    ];
    for (const [alias, j] of Object.entries(src.joins || {})) {
      const targetCols = JOINABLE[j.target] || [];
      groups.push({
        group: aliasLabel(alias),
        columns: targetCols.map(c => ({ key: `${alias}.${c.key}`, label: c.label })),
      });
    }
    if (src.projectIdColumn) {
      groups.push({
        group: 'Project Numbers',
        columns: PROJECT_NUMBER_COLUMNS.map(c => ({ key: c.key, label: c.label })),
      });
    }
    out[srcKey] = { label: src.label, groups };
  }
  return out;
}

/**
 * Build the user-facing CSV header for a column key, given its source.
 * Native:   "Project Name"
 * Joined:   "Customer Contact: Phone"
 * Enriched: "Primary #"
 */
function headerForColumn(srcKey, colKey) {
  const r = resolveColumn(srcKey, colKey);
  if (!r) return colKey;
  if (r.type === 'native' || r.type === 'enrichment') return r.label;
  return `${aliasLabel(r.alias)}: ${r.label}`;
}

/**
 * Resolve a column key to { type, ...details }. Returns null if unknown.
 *
 * native:     { type: 'native', col: 'projects.name', label }
 * joined:     { type: 'joined', alias, target, col: 'customer_contact.phone', label, join }
 * enrichment: { type: 'enrichment', kind: 'project_numbers', sub: 'primary'|'all', label }
 */
function resolveColumn(srcKey, colKey) {
  const src = SOURCES[srcKey];
  if (!src) return null;

  // Enrichment
  if (colKey.startsWith('project_numbers.')) {
    if (!src.projectIdColumn) return null;
    const sub = colKey.slice('project_numbers.'.length);
    const def = PROJECT_NUMBER_COLUMNS.find(c => c.key === colKey);
    if (!def) return null;
    return { type: 'enrichment', kind: 'project_numbers', sub, label: def.label };
  }

  // Joined
  if (colKey.includes('.')) {
    const [alias, sub] = colKey.split('.', 2);
    const join = src.joins?.[alias];
    if (!join) return null;
    const def = (JOINABLE[join.target] || []).find(c => c.key === sub);
    if (!def) return null;
    return {
      type: 'joined',
      alias,
      target: join.target,
      col: `${alias}.${sub}`,
      label: def.label,
      join,
    };
  }

  // Native
  const def = src.native.find(c => c.key === colKey);
  if (!def) return null;
  return {
    type: 'native',
    col: def.col || `${src.table}.${colKey}`,
    label: def.label,
  };
}

/** Set<string> of every column key valid for this source. */
function allowedColumnKeys(srcKey) {
  const src = SOURCES[srcKey];
  if (!src) return new Set();
  const out = new Set(src.native.map(c => c.key));
  for (const [alias, j] of Object.entries(src.joins || {})) {
    for (const c of JOINABLE[j.target] || []) out.add(`${alias}.${c.key}`);
  }
  if (src.projectIdColumn) {
    for (const c of PROJECT_NUMBER_COLUMNS) out.add(c.key);
  }
  return out;
}

/** Human-friendly group label for a join alias. */
const ALIAS_WORD_OVERRIDES = { pm: 'PM', id: 'ID', po: 'PO' };
function aliasLabel(alias) {
  return alias
    .split('_')
    .map(w => ALIAS_WORD_OVERRIDES[w] || (w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function getSource(srcKey) {
  return SOURCES[srcKey] || null;
}

module.exports = {
  SOURCES,
  JOINABLE,
  PROJECT_NUMBER_COLUMNS,
  getSourcesForUI,
  resolveColumn,
  allowedColumnKeys,
  headerForColumn,
  getSource,
  aliasLabel,
};
