/**
 * Export Builder
 * 
 * Defines exportable sources with cross-table joins.
 * User picks a source, selects columns from any related table, applies filters.
 * Backend builds the query with proper joins and returns CSV.
 * 
 * Example: Export invoices with project name + customer billing address + PM name
 * Source: "invoices"
 * Columns: ["invoices.invoice_number", "invoices.amount", "projects.name", 
 *           "customers.billing_street", "customers.billing_town", "users_pm.first_name"]
 */

const db = require('../config/database');

// ═══════════════════════════════════════════════════════════
// SOURCE DEFINITIONS
// ═══════════════════════════════════════════════════════════

const SOURCES = {
  invoices: {
    label: 'Invoices',
    table: 'invoices',
    columns: [
      { key: 'invoices.invoice_number', label: 'Invoice Number' },
      { key: 'invoices.invoice_date', label: 'Invoice Date' },
      { key: 'invoices.amount', label: 'Amount' },
      { key: 'invoices.status', label: 'Invoice Status' },
      { key: 'invoices.customer', label: 'Invoice Customer Name' },
      { key: 'invoices.notes', label: 'Notes' },
      { key: 'invoices.payment_due_date', label: 'Payment Due Date' },
      { key: 'invoices.payment_received_date', label: 'Payment Received Date' },
      { key: 'invoices.payment_received_amount', label: 'Payment Received' },
      { key: 'invoices.created_at', label: 'Invoice Created' },
    ],
    joins: {
      projects: { type: 'left', on: ['invoices.project_id', 'projects.id'] },
      customers: { type: 'left', on: ['projects.customer_id', 'customers.id'], requires: 'projects' },
      locations: { type: 'left', on: ['projects.location_id', 'locations.id'], requires: 'projects' },
      'users as users_pm': { type: 'left', on: ['projects.pm_id', 'users_pm.id'], requires: 'projects' },
    },
    dateColumn: 'invoices.invoice_date',
    defaultSort: 'invoices.invoice_date',
  },

  purchase_orders: {
    label: 'Purchase Orders',
    table: 'purchase_orders',
    columns: [
      { key: 'purchase_orders.po_number', label: 'PO Number' },
      { key: 'purchase_orders.order_date', label: 'Order Date' },
      { key: 'purchase_orders.vendor', label: 'Vendor' },
      { key: 'purchase_orders.total', label: 'PO Total' },
      { key: 'purchase_orders.tax_amount', label: 'Tax' },
      { key: 'purchase_orders.shipping_amount', label: 'Shipping' },
      { key: 'purchase_orders.status', label: 'PO Status' },
      { key: 'purchase_orders.notes', label: 'Notes' },
      { key: 'purchase_orders.delivery_date', label: 'Delivery Date' },
      { key: 'purchase_orders.created_at', label: 'PO Created' },
    ],
    joins: {
      projects: { type: 'left', on: ['purchase_orders.project_id', 'projects.id'] },
      customers: { type: 'left', on: ['projects.customer_id', 'customers.id'], requires: 'projects' },
      locations: { type: 'left', on: ['projects.location_id', 'locations.id'], requires: 'projects' },
      'users as users_pm': { type: 'left', on: ['projects.pm_id', 'users_pm.id'], requires: 'projects' },
    },
    dateColumn: 'purchase_orders.order_date',
    defaultSort: 'purchase_orders.order_date',
  },

  timesheets: {
    label: 'Timesheets',
    table: 'timesheets',
    columns: [
      { key: 'timesheets.work_date', label: 'Week Ending' },
      { key: 'timesheets.week_ending', label: 'Week Ending Date' },
      { key: 'timesheets.days_worked', label: 'Days Worked' },
      { key: 'timesheets.worker_name', label: 'Worker Name' },
      { key: 'timesheets.classification', label: 'Classification' },
      { key: 'timesheets.st_hours', label: 'ST Hours' },
      { key: 'timesheets.ot_hours', label: 'OT Hours' },
      { key: 'timesheets.dt_hours', label: 'DT Hours' },
      { key: 'timesheets.billing_rate_st', label: 'ST Rate' },
      { key: 'timesheets.billing_rate_ot', label: 'OT Rate' },
      { key: 'timesheets.billing_rate_dt', label: 'DT Rate' },
      { key: 'timesheets.potential_revenue', label: 'Revenue' },
      { key: 'timesheets.miles_driven', label: 'Miles Driven' },
      { key: 'timesheets.mileage_cost', label: 'Mileage Cost' },
      { key: 'timesheets.per_diem_rate', label: 'Per Diem Rate' },
      { key: 'timesheets.per_diem_total', label: 'Per Diem Total' },
      { key: 'timesheets.created_at', label: 'Entry Created' },
    ],
    joins: {
      projects: { type: 'left', on: ['timesheets.project_id', 'projects.id'] },
      customers: { type: 'left', on: ['projects.customer_id', 'customers.id'], requires: 'projects' },
      locations: { type: 'left', on: ['projects.location_id', 'locations.id'], requires: 'projects' },
      'users as users_pm': { type: 'left', on: ['projects.pm_id', 'users_pm.id'], requires: 'projects' },
    },
    dateColumn: 'timesheets.work_date',
    defaultSort: 'timesheets.work_date',
  },

  projects: {
    label: 'Projects',
    table: 'projects',
    columns: [
      { key: 'projects.name', label: 'Project Name' },
      { key: 'projects.status', label: 'Project Status' },
      { key: 'projects.contract_value', label: 'Contract Value' },
      { key: 'projects.contract_type', label: 'Contract Type' },
      { key: 'projects.payment_terms', label: 'Payment Terms' },
      { key: 'projects.year', label: 'Year' },
      { key: 'projects.start_date', label: 'Start Date' },
      { key: 'projects.end_date', label: 'End Date' },
      { key: 'projects.folder_path', label: 'Folder Path' },
      { key: 'projects.created_at', label: 'Project Created' },
    ],
    joins: {
      customers: { type: 'left', on: ['projects.customer_id', 'customers.id'] },
      locations: { type: 'left', on: ['projects.location_id', 'locations.id'] },
      'users as users_pm': { type: 'left', on: ['projects.pm_id', 'users_pm.id'] },
    },
    dateColumn: 'projects.created_at',
    defaultSort: 'projects.name',
  },

  bids: {
    label: 'Bids',
    table: 'bids',
    columns: [
      { key: 'bids.bid_number', label: 'Bid Number' },
      { key: 'bids.bid_date', label: 'Bid Date' },
      { key: 'bids.status', label: 'Bid Status' },
      { key: 'bids.project_scope', label: 'Scope' },
      { key: 'bids.bid_amount', label: 'Bid Amount' },
      { key: 'bids.subtotal', label: 'Subtotal' },
      { key: 'bids.markup_pct', label: 'Markup %' },
      { key: 'bids.local_union', label: 'Local Union' },
      { key: 'bids.project_length_days', label: 'Project Length (days)' },
      { key: 'bids.created_at', label: 'Bid Created' },
    ],
    joins: {
      customers: { type: 'left', on: ['bids.customer_id', 'customers.id'] },
      locations: { type: 'left', on: ['bids.location_id', 'locations.id'] },
      'users as users_est': { type: 'left', on: ['bids.estimator_id', 'users_est.id'] },
      customer_contacts: { type: 'left', on: ['bids.customer_contact_id', 'customer_contacts.id'] },
    },
    dateColumn: 'bids.bid_date',
    defaultSort: 'bids.bid_date',
  },

  equipment: {
    label: 'Equipment',
    table: 'equipment',
    columns: [
      { key: 'equipment.barcode_id', label: 'Barcode' },
      { key: 'equipment.equipment_name', label: 'Equipment Name' },
      { key: 'equipment.manufacturer', label: 'Manufacturer' },
      { key: 'equipment.equipment_type', label: 'Type' },
      { key: 'equipment.status', label: 'Status' },
      { key: 'equipment.equipment_cost', label: 'Daily Cost' },
      { key: 'equipment.certification_date', label: 'Cert Expiry' },
      { key: 'equipment.cert_expiry_alert_days', label: 'Cert Alert (days)' },
      { key: 'equipment.current_location', label: 'Current Location' },
      { key: 'equipment.notes', label: 'Notes' },
    ],
    joins: {},
    dateColumn: 'equipment.created_at',
    defaultSort: 'equipment.equipment_name',
  },
};

// Related table columns available through joins
const RELATED_COLUMNS = {
  projects: [
    { key: 'projects.name', label: 'Project Name' },
    { key: 'projects.status', label: 'Project Status' },
    { key: 'projects.contract_value', label: 'Contract Value' },
    { key: 'projects.contract_type', label: 'Contract Type' },
    { key: 'projects.payment_terms', label: 'Project Payment Terms' },
    { key: 'projects.year', label: 'Project Year' },
    { key: 'projects.start_date', label: 'Project Start' },
    { key: 'projects.end_date', label: 'Project End' },
  ],
  customers: [
    { key: 'customers.name', label: 'Customer Name' },
    { key: 'customers.billing_street', label: 'Billing Street' },
    { key: 'customers.billing_town', label: 'Billing Town' },
    { key: 'customers.billing_state', label: 'Billing State' },
    { key: 'customers.billing_zip', label: 'Billing Zip' },
  ],
  locations: [
    { key: 'locations.name', label: 'Location Name' },
    { key: 'locations.street', label: 'Location Street' },
    { key: 'locations.town', label: 'Location Town' },
    { key: 'locations.state', label: 'Location State' },
    { key: 'locations.zip', label: 'Location Zip' },
    { key: 'locations.local_union', label: 'Local Union' },
    { key: 'locations.miles_from_hq', label: 'Miles from HQ' },
  ],
  'users as users_pm': [
    { key: 'users_pm.first_name', label: 'PM First Name' },
    { key: 'users_pm.last_name', label: 'PM Last Name' },
    { key: 'users_pm.email', label: 'PM Email' },
  ],
  'users as users_est': [
    { key: 'users_est.first_name', label: 'Estimator First Name' },
    { key: 'users_est.last_name', label: 'Estimator Last Name' },
    { key: 'users_est.email', label: 'Estimator Email' },
  ],
  customer_contacts: [
    { key: 'customer_contacts.name', label: 'Contact Name' },
    { key: 'customer_contacts.email', label: 'Contact Email' },
    { key: 'customer_contacts.phone', label: 'Contact Phone' },
    { key: 'customer_contacts.company', label: 'Contact Company' },
  ],
};

// ═══════════════════════════════════════════════════════════
// EXPORT BUILDER
// ═══════════════════════════════════════════════════════════

const ExportBuilder = {
  /**
   * Get available sources and their columns (for the UI)
   */
  getSources() {
    const result = {};
    for (const [key, source] of Object.entries(SOURCES)) {
      const groups = [{ group: source.label, columns: source.columns }];

      // Add joinable related table columns
      for (const [joinKey, joinDef] of Object.entries(source.joins)) {
        const relCols = RELATED_COLUMNS[joinKey];
        if (relCols) {
          const groupLabel = joinKey.replace('users as users_pm', 'Project Manager')
            .replace('users as users_est', 'Estimator')
            .replace('customer_contacts', 'Contact')
            .replace(/^\w/, c => c.toUpperCase());
          groups.push({ group: groupLabel, columns: relCols });
        }
      }

      result[key] = { label: source.label, groups };
    }
    return result;
  },

  /**
   * Build and execute the export query
   * 
   * @param {string} source - Source key (invoices, projects, etc.)
   * @param {string[]} columns - Array of "table.column" keys to include
   * @param {object} filters - { start_date, end_date, status, search }
   * @returns {{ headers: string[], rows: any[][] }}
   */
  async execute(source, columns, filters = {}) {
    const sourceDef = SOURCES[source];
    if (!sourceDef) throw new Error('Unknown source: ' + source);

    if (!columns || columns.length === 0) {
      // Default: all primary columns
      columns = sourceDef.columns.map(c => c.key);
    }

    // Validate columns: every requested column must exist either on the source's
    // own column list or in RELATED_COLUMNS for one of this source's joins.
    const allowedCols = new Set(sourceDef.columns.map(c => c.key));
    for (const joinKey of Object.keys(sourceDef.joins)) {
      const relCols = RELATED_COLUMNS[joinKey];
      if (relCols) for (const c of relCols) allowedCols.add(c.key);
    }
    const invalidCols = columns.filter(c => !allowedCols.has(c));
    if (invalidCols.length > 0) {
      throw new Error(`Invalid column(s) for source "${source}": ${invalidCols.join(', ')}`);
    }

    // Determine which joins are needed based on selected columns
    const neededJoins = new Set();
    for (const col of columns) {
      const tablePart = col.split('.')[0];
      // Check if this column requires a join
      for (const [joinKey, joinDef] of Object.entries(sourceDef.joins)) {
        const joinTableAlias = joinKey.includes(' as ') ? joinKey.split(' as ')[1] : joinKey;
        if (tablePart === joinTableAlias || tablePart === joinKey.split(' as ')[0]) {
          neededJoins.add(joinKey);
          // If this join requires another join, add it
          if (joinDef.requires) {
            for (const [k, v] of Object.entries(sourceDef.joins)) {
              const alias = k.includes(' as ') ? k.split(' as ')[1] : k;
              if (alias === joinDef.requires || k.split(' as ')[0] === joinDef.requires) {
                neededJoins.add(k);
              }
            }
          }
        }
      }
    }

    // Build select with aliases to avoid column name collisions
    const selects = columns.map(col => {
      const allCols = [...sourceDef.columns];
      for (const relCols of Object.values(RELATED_COLUMNS)) allCols.push(...relCols);
      const def = allCols.find(c => c.key === col);
      const alias = def ? def.label.replace(/[^a-zA-Z0-9_ ]/g, '').replace(/ /g, '_') : col.replace('.', '_');
      return db.raw(`?? as ??`, [col, alias]);
    });

    // Build query
    let query = db(sourceDef.table).select(selects);

    // Apply joins in dependency order
    const applied = new Set();
    function applyJoin(joinKey) {
      if (applied.has(joinKey)) return;
      const joinDef = sourceDef.joins[joinKey];
      if (!joinDef) return;
      // Apply required join first
      if (joinDef.requires) {
        for (const [k] of Object.entries(sourceDef.joins)) {
          const alias = k.includes(' as ') ? k.split(' as ')[1] : k;
          if (alias === joinDef.requires || k.split(' as ')[0] === joinDef.requires) {
            applyJoin(k);
          }
        }
      }
      query = query.leftJoin(joinKey, joinDef.on[0], joinDef.on[1]);
      applied.add(joinKey);
    }
    for (const joinKey of neededJoins) applyJoin(joinKey);

    // Apply filters
    if (filters.start_date && sourceDef.dateColumn) {
      query = query.where(sourceDef.dateColumn, '>=', filters.start_date);
    }
    if (filters.end_date && sourceDef.dateColumn) {
      query = query.where(sourceDef.dateColumn, '<=', filters.end_date);
    }
    if (filters.status) {
      query = query.where(sourceDef.table + '.status', filters.status);
    }

    // Sort
    query = query.orderBy(sourceDef.defaultSort, 'desc').limit(parseInt(filters.limit) || 10000);

    const rows = await query;

    // Build headers from column labels
    const headers = columns.map(col => {
      const allCols = [...sourceDef.columns];
      for (const relCols of Object.values(RELATED_COLUMNS)) allCols.push(...relCols);
      const def = allCols.find(c => c.key === col);
      return def ? def.label : col;
    });

    // Build row data
    const data = rows.map(row => {
      return headers.map(header => {
        const alias = header.replace(/[^a-zA-Z0-9_ ]/g, '').replace(/ /g, '_');
        return row[alias] ?? '';
      });
    });

    return { headers, rows: data, total: data.length };
  },
};

module.exports = ExportBuilder;
