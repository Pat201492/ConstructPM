/**
 * Role-Based Access Control Configuration
 *
 * Six user roles + 1 placeholder. Field Staff is mobile-only (no web UI).
 * Scheduler is a placeholder for future scheduling features (no permissions yet).
 * Used by the authorize() middleware to gate routes.
 */

const ROLES = {
  ADMIN: 'admin',
  PROJECT_MANAGER: 'project_manager',
  ESTIMATOR: 'estimator',
  ACCOUNTING: 'accounting',
  SHOP_STAFF: 'shop_staff',   // Combined shop manager + shop staff
  FIELD_STAFF: 'field_staff',
  SCHEDULER: 'scheduler',
};

const PERMISSIONS = {
  // ── User Management ──────────────────────────────────────
  'users:create':   [ROLES.ADMIN],
  'users:read':     [ROLES.ADMIN],
  'users:update':   [ROLES.ADMIN],
  'users:delete':   [ROLES.ADMIN],

  // ── Bids ─────────────────────────────────────────────────
  'bids:create':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR],
  'bids:read':      [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR, ROLES.ACCOUNTING],
  'bids:update':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR],
  'bids:delete':    [ROLES.ADMIN],
  'bids:mark_won':  [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR],

  // ── Projects ─────────────────────────────────────────────
  'projects:create':  [ROLES.ADMIN],
  'projects:read':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR, ROLES.ACCOUNTING, ROLES.SHOP_STAFF, ROLES.FIELD_STAFF],
  'projects:update':  [ROLES.ADMIN, ROLES.PROJECT_MANAGER],
  'projects:close':   [ROLES.ADMIN, ROLES.PROJECT_MANAGER],
  'projects:delete':  [ROLES.ADMIN],

  // ── Invoices (Revenue) ───────────────────────────────────
  'invoices:create':  [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],
  'invoices:read':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],
  'invoices:update':  [ROLES.ADMIN, ROLES.ACCOUNTING],
  'invoices:approve': [ROLES.ADMIN, ROLES.ACCOUNTING],

  // ── Purchase Orders (Cost) ───────────────────────────────
  'purchase_orders:create':  [ROLES.ADMIN, ROLES.PROJECT_MANAGER],
  'purchase_orders:read':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING, ROLES.SHOP_STAFF],
  'purchase_orders:receive': [ROLES.ADMIN, ROLES.SHOP_STAFF],

  // ── Contracts ────────────────────────────────────────────
  'contracts:create':  [ROLES.ADMIN, ROLES.PROJECT_MANAGER],
  'contracts:read':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],

  // ── Timesheets (admin confirms, not PM) ──────────────────
  'timesheets:upload':   [ROLES.ADMIN],
  'timesheets:confirm':  [ROLES.ADMIN],
  'timesheets:read':     [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],

  // ── Inventory (consumable materials) ─────────────────────
  'inventory:create':   [ROLES.ADMIN, ROLES.SHOP_STAFF],
  'inventory:read':     [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING, ROLES.SHOP_STAFF],
  'inventory:update':   [ROLES.ADMIN, ROLES.SHOP_STAFF],
  'inventory:allocate': [ROLES.ADMIN, ROLES.SHOP_STAFF],

  // ── Equipment (serialized assets) ────────────────────────
  'equipment:read':     [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.SHOP_STAFF],
  'equipment:manage':   [ROLES.ADMIN, ROLES.SHOP_STAFF], // CRUD, maintenance, documents
  'equipment:request':  [ROLES.ADMIN, ROLES.PROJECT_MANAGER], // Create equipment requests
  'equipment:fulfill':  [ROLES.ADMIN, ROLES.SHOP_STAFF], // Scan barcodes, assign, return

  // ── Extractions (AI review) ──────────────────────────────
  'extractions:read':    [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],
  'extractions:confirm': [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],

  // ── Notifications ────────────────────────────────────────
  'notifications:read': [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR, ROLES.ACCOUNTING, ROLES.SHOP_STAFF, ROLES.FIELD_STAFF],

  // ── Files & Inboxes ──────────────────────────────────────
  'files:upload':   [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR, ROLES.ACCOUNTING],
  'files:download': [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ESTIMATOR, ROLES.ACCOUNTING, ROLES.SHOP_STAFF, ROLES.FIELD_STAFF],
  'inbox:upload':   [ROLES.ADMIN, ROLES.ACCOUNTING], // Configurable via inbox_access table

  // ── Field Notes ────────────────────────────────────────
  'field_notes:read':   [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING, ROLES.FIELD_STAFF],
  'field_notes:create': [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.FIELD_STAFF],
  'field_notes:update': [ROLES.ADMIN, ROLES.FIELD_STAFF],
  'field_notes:delete': [ROLES.ADMIN, ROLES.FIELD_STAFF],

  // ── Oil Samples ────────────────────────────────────────
  'oil_samples:read':   [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.FIELD_STAFF],
  'oil_samples:create': [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.FIELD_STAFF],
  'oil_samples:update': [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.FIELD_STAFF],
  'oil_samples:delete': [ROLES.ADMIN],

  // ── Exports ──────────────────────────────────────────────
  'exports:read':   [ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.ACCOUNTING],

  // ── Admin ────────────────────────────────────────────────
  'admin:manage':      [ROLES.ADMIN], // Global vars, rate sheet, templates, inbox access
  'admin:bulk_import': [ROLES.ADMIN], // Excel/CSV data import
  'admin:audit_log':   [ROLES.ADMIN], // View audit trail
};

module.exports = { ROLES, PERMISSIONS };
