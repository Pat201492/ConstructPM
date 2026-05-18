/**
 * Admin Routes
 * 
 * Admin-only endpoints for system configuration:
 *   /api/admin/rate-sheet      — CRUD for union rate classifications
 *   /api/admin/globals         — Key/value global variables
 *   /api/admin/templates       — Bid template management (upload .docx per PM)
 *   /api/admin/inbox-access    — Inbox access control (who can upload to each inbox)
 *   /api/admin/delegates       — PM notification delegates
 *   /api/admin/audit           — Audit trail viewer (filterable)
 *   /api/admin/import/targets  — List importable tables + columns
 *   /api/admin/import/parse    — Upload Excel/CSV → parse columns + rows
 *   /api/admin/import          — Bulk import mapped data into target table
 */

const express = require('express');
const { body } = require('express-validator');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const RateSheet = require('../models/RateSheet');
const GlobalVariable = require('../models/GlobalVariable');
const NotificationService = require('../services/NotificationService');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);

// ═══════════════════════════════════════════════════════════
// RATE LOOKUP — open to bid creators (PM, Estimator, Admin)
// ═══════════════════════════════════════════════════════════
//
// GET /api/admin/rate-sheet/local/:union runs BEFORE the admin:manage
// gate because PMs and Estimators need to look up rates while quoting
// bids. Without this, the bid quote page returned 403 for non-admins
// and the rate dropdown stayed empty — diagnosed by Pat seeing 403s
// in the Network tab when logged in as a PM.
//
// Per-route authorize uses 'bids:create' which is granted to admin,
// project_manager, and estimator — exactly the roles that quote bids.
// Other admin routes (rate-sheet POST/PATCH/DELETE, users, globals,
// etc.) stay behind the admin:manage gate below.
router.get('/rate-sheet/local/:union', authorize('bids:create'), async (req, res, next) => {
  try {
    const rates = await RateSheet.getByLocal(req.params.union);
    res.json({ local_union: req.params.union, rates });
  } catch (err) { next(err); }
});

// All routes BELOW this line require admin:manage.
router.use(authorize('admin:manage'));

// ═══════════════════════════════════════════════════════════
// RATE SHEET (admin CRUD)
// ═══════════════════════════════════════════════════════════

// GET /api/admin/rate-sheet — list all rates (optionally filter by local)
router.get('/rate-sheet', async (req, res, next) => {
  try {
    const { local_union, classification } = req.query;
    const result = await RateSheet.findAll({ local_union, classification });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/admin/rate-sheet — create a rate entry
router.post('/rate-sheet',
  [
    body('local_union').trim().notEmpty(),
    body('classification').trim().notEmpty(),
    body('st_rate').isFloat({ min: 0 }),
    body('ot_rate').isFloat({ min: 0 }),
    body('dt_rate').isFloat({ min: 0 }),
  ],
  async (req, res, next) => {
    try {
      const { local_union, classification, st_rate, ot_rate, dt_rate } = req.body;
      const rate = await RateSheet.create({ local_union, classification, st_rate, ot_rate, dt_rate });
      res.status(201).json(rate);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Rate already exists for this local + classification' });
      next(err);
    }
  }
);

// PATCH /api/admin/rate-sheet/:id — update a rate
router.patch('/rate-sheet/:id', async (req, res, next) => {
  try {
    const allowed = ['local_union', 'classification', 'st_rate', 'ot_rate', 'dt_rate'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const rate = await RateSheet.update(req.params.id, data);
    if (!rate) return res.status(404).json({ error: 'Rate not found' });
    res.json(rate);
  } catch (err) { next(err); }
});

// DELETE /api/admin/rate-sheet/:id — delete a rate
router.delete('/rate-sheet/:id', async (req, res, next) => {
  try {
    const deleted = await RateSheet.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rate not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// POST /api/admin/rate-sheet/bulk — bulk upsert (insert or update by local+classification)
router.post('/rate-sheet/bulk', async (req, res, next) => {
  try {
    const { rates } = req.body;
    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ error: 'rates array required' });
    }
    const results = await RateSheet.bulkUpsert(rates);
    res.json({ upserted: results.length, rates: results });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// GLOBAL VARIABLES
// ═══════════════════════════════════════════════════════════

// GET /api/admin/globals — list all global variables
router.get('/globals', async (req, res, next) => {
  try {
    const variables = await GlobalVariable.getAll();
    res.json({ variables });
  } catch (err) { next(err); }
});

// GET /api/admin/globals/:key — get a specific variable
router.get('/globals/:key', async (req, res, next) => {
  try {
    const value = await GlobalVariable.get(req.params.key);
    if (value === null) return res.status(404).json({ error: 'Variable not found' });
    res.json({ key: req.params.key, value });
  } catch (err) { next(err); }
});

// PUT /api/admin/globals/:key — set a variable (create or update)
router.put('/globals/:key',
  [body('value').exists().withMessage('Value is required')],
  async (req, res, next) => {
    try {
      // Feature flag keys (`feature.*`) are superadmin-only. Regular
      // firm admins can edit every other global variable freely. This
      // is the enforcement point that backs the Superadmin sidebar
      // tab — the UI hides Feature Toggles from non-superadmins, and
      // this is the server-side guarantee that they can't be set even
      // by someone who knows the endpoint.
      if (req.params.key.startsWith('feature.')) {
        const me = await db('users').where('id', req.user.id).first();
        if (!me?.is_superadmin) {
          return res.status(403).json({ error: 'Feature flags can only be modified by a superadmin.' });
        }
      }

      const result = await GlobalVariable.set(req.params.key, req.body.value, req.body.description);

      // Clear storage cache if a storage path was changed
      if (req.params.key.startsWith('storage_')) {
        try {
          const LocalBackend = require('../services/storage/LocalBackend');
          LocalBackend.clearCache();
        } catch {}
      }

      res.json(result);
    } catch (err) { next(err); }
  }
);

// DELETE /api/admin/globals/:key — delete a variable
router.delete('/globals/:key', async (req, res, next) => {
  try {
    const deleted = await GlobalVariable.delete(req.params.key);
    if (!deleted) return res.status(404).json({ error: 'Variable not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// STORAGE PATH MANAGEMENT
// ═══════════════════════════════════════════════════════════

// GET /api/admin/storage/status — current paths + write test
router.get('/storage/status', async (req, res, next) => {
  try {
    const LocalBackend = require('../services/storage/LocalBackend');
    const fsPromises = require('fs').promises;
    const path = require('path');

    const basePath = await LocalBackend.getBase();
    const bidsPath = await LocalBackend.getCategoryPath('bids');
    const projectsPath = await LocalBackend.getCategoryPath('projects');
    const templatesPath = await LocalBackend.getCategoryPath('templates');

    // Test write access on each path
    async function testWrite(p) {
      try {
        await fsPromises.mkdir(p, { recursive: true });
        const testFile = path.join(p, '.write_test_' + Date.now());
        await fsPromises.writeFile(testFile, 'test');
        await fsPromises.unlink(testFile);
        return { path: p, writable: true };
      } catch (err) {
        return { path: p, writable: false, error: err.message };
      }
    }

    const results = {
      base: await testWrite(basePath),
      bids: await testWrite(bidsPath),
      projects: await testWrite(projectsPath),
      templates: await testWrite(templatesPath),
      storage_type: process.env.STORAGE_TYPE || 'local',
      env_base: process.env.STORAGE_BASE_PATH || './storage',
    };

    res.json(results);
  } catch (err) { next(err); }
});

// POST /api/admin/storage/test-path — test if a custom path is writable
router.post('/storage/test-path', async (req, res, next) => {
  try {
    const { path: testPath } = req.body;
    if (!testPath) return res.status(400).json({ error: 'path required' });

    const fsPromises = require('fs').promises;
    const pathMod = require('path');

    try {
      await fsPromises.mkdir(testPath, { recursive: true });
      const testFile = pathMod.join(testPath, '.write_test_' + Date.now());
      await fsPromises.writeFile(testFile, 'test');
      await fsPromises.unlink(testFile);
      res.json({ path: testPath, writable: true, message: 'Path is accessible and writable' });
    } catch (err) {
      res.json({ path: testPath, writable: false, error: err.message });
    }
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════

const AuditService = require('../services/AuditService');

// GET /api/admin/audit — query audit log (filterable)
router.get('/audit', authorize('admin:audit_log'), async (req, res, next) => {
  try {
    const { table_name, record_id, changed_by, change_type, start_date, end_date, limit, offset } = req.query;
    const result = await AuditService.query({
      table_name, record_id, changed_by, change_type, start_date, end_date,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/admin/audit/tables — distinct table names for filter dropdown
router.get('/audit/tables', authorize('admin:audit_log'), async (req, res, next) => {
  try {
    const tables = await AuditService.getTables();
    res.json({ tables });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// INBOX ACCESS CONTROL
// ═══════════════════════════════════════════════════════════

// GET /api/admin/inbox-access — list all inbox access rules
router.get('/inbox-access', async (req, res, next) => {
  try {
    const rules = await db('inbox_access')
      .select('inbox_access.*', db.raw("users.first_name || ' ' || users.last_name as user_name"))
      .leftJoin('users', 'inbox_access.user_id', 'users.id')
      .orderBy('inbox_type');
    res.json({ rules });
  } catch (err) { next(err); }
});

// POST /api/admin/inbox-access — add access rule (by user or role)
router.post('/inbox-access', async (req, res, next) => {
  try {
    const { inbox_type, user_id, role } = req.body;
    if (!inbox_type) return res.status(400).json({ error: 'inbox_type required' });
    if (!user_id && !role) return res.status(400).json({ error: 'user_id or role required' });

    const [rule] = await db('inbox_access').insert({ inbox_type, user_id: user_id || null, role: role || null }).returning('*');
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

// DELETE /api/admin/inbox-access/:id — remove access rule
router.delete('/inbox-access/:id', async (req, res, next) => {
  try {
    await db('inbox_access').where({ id: req.params.id }).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PM NOTIFICATION DELEGATES
// ═══════════════════════════════════════════════════════════

// GET /api/admin/delegates — list all PM → delegate mappings
router.get('/delegates', async (req, res, next) => {
  try {
    const delegates = await db('pm_notification_delegates')
      .select('pm_notification_delegates.*',
        db.raw("pm.first_name || ' ' || pm.last_name as pm_name"),
        db.raw("del.first_name || ' ' || del.last_name as delegate_name"))
      .join('users as pm', 'pm_notification_delegates.pm_user_id', 'pm.id')
      .join('users as del', 'pm_notification_delegates.delegate_user_id', 'del.id');
    res.json({ delegates });
  } catch (err) { next(err); }
});

// POST /api/admin/delegates — create a delegate mapping
router.post('/delegates',
  [body('pm_user_id').isUUID(), body('delegate_user_id').isUUID()],
  async (req, res, next) => {
    try {
      const [delegate] = await db('pm_notification_delegates')
        .insert({ pm_user_id: req.body.pm_user_id, delegate_user_id: req.body.delegate_user_id })
        .returning('*');
      res.status(201).json(delegate);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Delegate already assigned' });
      next(err);
    }
  }
);

// DELETE /api/admin/delegates/:id — remove delegate mapping
router.delete('/delegates/:id', async (req, res, next) => {
  try {
    await db('pm_notification_delegates').where({ id: req.params.id }).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// BID TEMPLATES
// ═══════════════════════════════════════════════════════════

const multer = require('multer');
const templateUpload = multer({ dest: '/tmp/template_uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/admin/templates — list all PM templates
router.get('/templates', async (req, res, next) => {
  try {
    const templates = await db('bid_templates')
      .select('bid_templates.*', db.raw("users.first_name || ' ' || users.last_name as pm_name"))
      .join('users', 'bid_templates.pm_id', 'users.id');
    res.json({ templates });
  } catch (err) { next(err); }
});

// POST /api/admin/templates — upload a template for a PM
router.post('/templates', templateUpload.single('template'), async (req, res, next) => {
  try {
    const { pm_id } = req.body;
    if (!pm_id) return res.status(400).json({ error: 'pm_id required' });
    if (!req.file) return res.status(400).json({ error: 'Template file required' });

    // Store template file
    const FileService = require('../services/FileService');
    const destKey = `templates/bid/${pm_id}_${Date.now()}.docx`;
    const stored = await FileService.storeUploadedFile(req.file.path, destKey);
    try { await require('fs').promises.unlink(req.file.path); } catch {}

    // Upsert template record (one per PM)
    const existing = await db('bid_templates').where({ pm_id }).first();
    let template;
    if (existing) {
      [template] = await db('bid_templates').where({ id: existing.id })
        .update({ file_path: stored.key, created_by: req.user.id, updated_at: db.fn.now() }).returning('*');
    } else {
      [template] = await db('bid_templates')
        .insert({ pm_id, file_path: stored.key, created_by: req.user.id }).returning('*');
    }

    res.status(201).json(template);
  } catch (err) { next(err); }
});

// DELETE /api/admin/templates/:id — remove a template
router.delete('/templates/:id', async (req, res, next) => {
  try {
    await db('bid_templates').where({ id: req.params.id }).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// BULK DATA IMPORT
// ═══════════════════════════════════════════════════════════

const bulkUpload = multer({ dest: '/tmp/bulk_uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /api/admin/import/parse — Upload Excel/CSV, parse columns + sample data
 * Returns: { columns: ['col1','col2',...], sample_rows: [{col1:val,...},...], total_rows: N }
 * The frontend then lets the admin map file columns to DB columns and POST /import
 */
router.post('/import/parse', authorize('admin:bulk_import'), bulkUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File required (.xlsx, .csv)' });
    const ext = require('path').extname(req.file.originalname).toLowerCase();
    let columns = [];
    let rows = [];

    if (ext === '.csv' || ext === '.tsv') {
      // Parse CSV
      const fs = require('fs');
      const content = fs.readFileSync(req.file.path, 'utf-8');
      const delim = ext === '.tsv' ? '\t' : ',';
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) return res.status(400).json({ error: 'Empty file' });

      // Simple CSV parser (handles basic quoting)
      function parseLine(line, d) {
        const result = [];
        let current = '', inQuotes = false;
        for (const ch of line) {
          if (ch === '"') { inQuotes = !inQuotes; continue; }
          if (ch === d && !inQuotes) { result.push(current.trim()); current = ''; continue; }
          current += ch;
        }
        result.push(current.trim());
        return result;
      }

      columns = parseLine(lines[0], delim);
      for (let i = 1; i < lines.length; i++) {
        const vals = parseLine(lines[i], delim);
        const row = {};
        columns.forEach((col, j) => { row[col] = vals[j] || ''; });
        rows.push(row);
      }
    } else if (ext === '.xlsx' || ext === '.xls') {
      // Parse Excel
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount === 0) return res.status(400).json({ error: 'Empty spreadsheet' });

      // First row = headers
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell, colNum) => {
        columns.push(String(cell.value || `Column_${colNum}`).trim());
      });

      // Data rows
      for (let r = 2; r <= sheet.rowCount; r++) {
        const dataRow = sheet.getRow(r);
        const row = {};
        let hasData = false;
        columns.forEach((col, i) => {
          const cell = dataRow.getCell(i + 1);
          const val = cell.value;
          row[col] = val instanceof Date ? val.toISOString().split('T')[0] : (val != null ? String(val) : '');
          if (row[col]) hasData = true;
        });
        if (hasData) rows.push(row);
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use .xlsx or .csv' });
    }

    // Clean up temp file
    require('fs').unlinkSync(req.file.path);

    res.json({
      columns,
      sample_rows: rows.slice(0, 10), // First 10 rows for preview
      total_rows: rows.length,
      all_rows: rows, // Frontend sends this back with column_map in POST /import
    });
  } catch (err) { next(err); }
});

// GET /api/admin/import/targets — list importable tables and their columns
router.get('/import/targets', async (req, res, next) => {
  try {
    const targets = {
      customers: ['name', 'billing_street', 'billing_town', 'billing_state', 'billing_zip'],
      contacts: ['name', 'email', 'phone', 'company', 'customer_id'],
      locations: ['name', 'street', 'town', 'state', 'zip', 'local_union', 'miles_from_hq', 'location_code'],
      // Vendors merged into customers — bulk-import vendor companies via
      // the 'customers' target; vendor contact info via 'contacts'.
      rate_sheet: ['local_union', 'classification', 'st_rate', 'ot_rate', 'dt_rate'],
      equipment: ['barcode_id', 'equipment_name', 'manufacturer', 'equipment_type', 'equipment_subtype', 'equipment_cost', 'certification_date', 'serial_number', 'notes'],
      inventory: ['item_name', 'category', 'sku', 'quantity', 'unit', 'min_stock', 'unit_cost', 'location'],
      // Users — bulk-create accounts. Password is auto-defaulted to
      // 'ChangeMe123!' if the CSV omits it (see /import handler); users
      // are expected to change on first login.
      users: ['email', 'first_name', 'last_name', 'initials', 'role', 'pm_code', 'phone', 'on_schedule', 'password'],
    };
    res.json({ targets });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/import — bulk import data from mapped columns
 * Body: { target: 'customers', rows: [{col1: val1, ...}], column_map: {file_col: db_col} }
 */
router.post('/import', authorize('admin:bulk_import'), async (req, res, next) => {
  try {
    const { target, rows, column_map } = req.body;
    if (!target || !rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'target and rows array required' });
    }

    // 'customer_contacts' kept as a back-compat alias for any caller (or
    // saved import config) that still uses the pre-rename target name.
    // Maps to the renamed 'contacts' table on insert.
    const TARGET_ALIASES = { customer_contacts: 'contacts' };
    const resolvedTarget = TARGET_ALIASES[target] || target;
    const allowedTargets = ['customers', 'contacts', 'locations', 'rate_sheet', 'equipment', 'inventory', 'users'];
    if (!allowedTargets.includes(resolvedTarget)) {
      return res.status(400).json({ error: `Invalid target. Allowed: ${allowedTargets.join(', ')}` });
    }

    // Map columns if column_map provided
    const mappedRows = rows.map(row => {
      if (!column_map) return row;
      const mapped = {};
      for (const [fileCol, dbCol] of Object.entries(column_map)) {
        if (row[fileCol] !== undefined) mapped[dbCol] = row[fileCol];
      }
      return mapped;
    });

    // Auto-generate display addresses for customers and locations.
    // INCLUDES zip in the formatted string — matches the format used by
    // Customer.js / Location.js helpers since the May 2026 refresh
    // (migration 20260510_005).
    if (target === 'customers') {
      for (const row of mappedRows) {
        const cityState = [row.billing_town, row.billing_state].filter(Boolean).join(', ');
        const tail = [cityState, row.billing_zip].filter(Boolean).join(' ');
        row.billing_display_address = [row.billing_street, tail].filter(Boolean).join(', ');
      }
    }
    if (target === 'locations') {
      for (const row of mappedRows) {
        const cityState = [row.town, row.state].filter(Boolean).join(', ');
        const tail = [cityState, row.zip].filter(Boolean).join(' ');
        row.display_address = [row.street, tail].filter(Boolean).join(', ');
      }
    }

    // Users — bulk-create accounts. Password handling: if the CSV
    // includes a `password` column, hash it; otherwise default to
    // ChangeMe123! so admins can hand out the default and have users
    // change on first login. Email is required.
    if (target === 'users') {
      const bcrypt = require('bcryptjs');
      const defaultHash = await bcrypt.hash('ChangeMe123!', 12);
      for (const row of mappedRows) {
        if (row.password) {
          row.password_hash = await bcrypt.hash(String(row.password), 12);
          delete row.password;
        } else {
          row.password_hash = defaultHash;
        }
        if (row.email) row.email = String(row.email).toLowerCase();
        // Coerce on_schedule from CSV's textual booleans
        if (typeof row.on_schedule === 'string') {
          row.on_schedule = /^(true|yes|1|y)$/i.test(row.on_schedule.trim());
        }
        // Default role if absent
        if (!row.role) row.role = 'field_staff';
      }
    }

    // Insert in batches of 100
    let inserted = 0;
    let skipped = 0;
    const batchSize = 100;

    for (let i = 0; i < mappedRows.length; i += batchSize) {
      const batch = mappedRows.slice(i, i + batchSize);
      try {
        await db(resolvedTarget).insert(batch);
        inserted += batch.length;
      } catch (err) {
        // Try row-by-row for this batch to identify duplicates
        for (const row of batch) {
          try {
            await db(resolvedTarget).insert(row);
            inserted++;
          } catch {
            skipped++;
          }
        }
      }
    }

    // Audit log
    await AuditService.log({
      tableName: target,
      recordId: '00000000-0000-0000-0000-000000000000',
      field: 'bulk_import',
      newValue: `${inserted} rows imported, ${skipped} skipped`,
      changeType: 'create',
      changedBy: req.user.id,
    });

    res.json({ target, inserted, skipped, total: rows.length });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// ROLE MANAGEMENT
// ═══════════════════════════════════════════════════════════

// All available tabs (for the checkbox UI)
const ALL_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bids', label: 'Bids' },
  { id: 'projects', label: 'Projects' },
  { id: 'financials', label: 'Invoices & POs' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'timesheets', label: 'Timesheets' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'oil-samples', label: 'Oil Samples' },
  { id: 'field-notes', label: 'Field Notes' },
  { id: 'exports', label: 'Data Export' },
  { id: 'admin', label: 'Admin' },
];

// GET /api/admin/roles — list all role configurations
router.get('/roles', async (req, res, next) => {
  try {
    const roles = await db('role_configurations').orderBy('is_system', 'desc').orderBy('role_name');
    // Parse JSON fields
    roles.forEach(r => {
      if (typeof r.allowed_tabs === 'string') r.allowed_tabs = JSON.parse(r.allowed_tabs);
      if (typeof r.permissions === 'string') r.permissions = JSON.parse(r.permissions);
    });
    res.json({ roles, available_tabs: ALL_TABS });
  } catch (err) { next(err); }
});

// GET /api/admin/roles/:roleName — get single role config
router.get('/roles/:roleName', async (req, res, next) => {
  try {
    const role = await db('role_configurations').where('role_name', req.params.roleName).first();
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (typeof role.allowed_tabs === 'string') role.allowed_tabs = JSON.parse(role.allowed_tabs);
    if (typeof role.permissions === 'string') role.permissions = JSON.parse(role.permissions);
    res.json({ role, available_tabs: ALL_TABS });
  } catch (err) { next(err); }
});

// PATCH /api/admin/roles/:roleName — update role tab visibility
router.patch('/roles/:roleName', async (req, res, next) => {
  try {
    const { allowed_tabs, display_name, description, on_schedule_default } = req.body;
    const updates = { updated_at: db.fn.now() };
    if (allowed_tabs) updates.allowed_tabs = JSON.stringify(allowed_tabs);
    if (display_name) updates.display_name = display_name;
    if (description !== undefined) updates.description = description;
    if (on_schedule_default !== undefined) updates.on_schedule_default = !!on_schedule_default;

    const [role] = await db('role_configurations')
      .where('role_name', req.params.roleName)
      .update(updates)
      .returning('*');
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json(role);
  } catch (err) { next(err); }
});

// POST /api/admin/roles — create a custom role
router.post('/roles', async (req, res, next) => {
  try {
    const { role_name, display_name, allowed_tabs, description } = req.body;
    if (!role_name || !display_name) return res.status(400).json({ error: 'role_name and display_name required' });

    // Validate role_name format (lowercase, underscores only, max 30 chars)
    if (!/^[a-z][a-z0-9_]{1,29}$/.test(role_name)) {
      return res.status(400).json({ error: 'role_name must be 2-30 lowercase letters, numbers, and underscores only' });
    }

    // Check if already exists
    const existing = await db('role_configurations').where('role_name', role_name).first();
    if (existing) return res.status(409).json({ error: 'Role already exists' });

    // Add to PostgreSQL enum so users can be assigned this role
    // SAFETY: role_name is validated above to only contain [a-z0-9_] — no injection risk
    try {
      await db.raw(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS '${role_name}'`);
    } catch (err) {
      // IF NOT EXISTS not supported in older PG — ignore duplicate errors
      if (!err.message.includes('already exists')) throw err;
    }

    // Create role configuration
    const [role] = await db('role_configurations').insert({
      role_name,
      display_name,
      allowed_tabs: JSON.stringify(allowed_tabs || ['notifications']),
      permissions: JSON.stringify([]),
      is_system: false,
      description: description || null,
    }).returning('*');

    res.status(201).json(role);
  } catch (err) { next(err); }
});

// DELETE /api/admin/roles/:roleName — delete a custom role (system roles protected)
router.delete('/roles/:roleName', async (req, res, next) => {
  try {
    const role = await db('role_configurations').where('role_name', req.params.roleName).first();
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(400).json({ error: 'Cannot delete system role' });

    // Check no users have this role
    const usersWithRole = await db('users').where('role', req.params.roleName).count('* as count').first();
    if (parseInt(usersWithRole.count) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${usersWithRole.count} user(s) still assigned this role` });
    }

    await db('role_configurations').where('role_name', req.params.roleName).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PER-USER ACCESS CONFIGURATION
// ═══════════════════════════════════════════════════════════

// GET /api/admin/users/:id/access — get user's access config
router.get('/users/:id/access', async (req, res, next) => {
  try {
    const user = await db('users').select('id','first_name','last_name','role','tab_overrides','access_config').where('id', req.params.id).first();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const roleConfig = await db('role_configurations').where('role_name', user.role).first();
    if (roleConfig) {
      if (typeof roleConfig.allowed_tabs === 'string') roleConfig.allowed_tabs = JSON.parse(roleConfig.allowed_tabs);
    }

    // Get bid assignments
    const bidAssignments = await db('bid_assignments')
      .select('bid_assignments.bid_id', 'bids.bid_number', 'bids.project_scope')
      .join('bids', 'bid_assignments.bid_id', 'bids.id')
      .where('bid_assignments.user_id', req.params.id);

    // Get project assignments
    const projectAssignments = await db('project_assignments')
      .select('project_assignments.project_id', 'projects.name')
      .join('projects', 'project_assignments.project_id', 'projects.id')
      .where('project_assignments.user_id', req.params.id);

    res.json({
      user,
      role_defaults: roleConfig || null,
      user_tab_overrides: user.tab_overrides ? (typeof user.tab_overrides === 'string' ? JSON.parse(user.tab_overrides) : user.tab_overrides) : null,
      user_access_config: user.access_config ? (typeof user.access_config === 'string' ? JSON.parse(user.access_config) : user.access_config) : {},
      bid_assignments: bidAssignments,
      project_assignments: projectAssignments,
      available_tabs: ALL_TABS,
    });
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id/access — update user's access config
router.patch('/users/:id/access', async (req, res, next) => {
  try {
    const { tab_overrides, access_config } = req.body;
    const updates = { updated_at: db.fn.now() };

    // tab_overrides: null to reset to role default, or array of tab IDs
    if (tab_overrides !== undefined) {
      updates.tab_overrides = tab_overrides === null ? null : JSON.stringify(tab_overrides);
    }

    // access_config: {bid_visibility, project_visibility}
    if (access_config !== undefined) {
      updates.access_config = access_config === null ? null : JSON.stringify(access_config);
    }

    const [user] = await db('users').where('id', req.params.id).update(updates).returning('*');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ updated: true, user });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// BID ASSIGNMENTS (explicit bid access grants)
// ═══════════════════════════════════════════════════════════

// POST /api/admin/users/:id/bid-assignments — assign bids to user
router.post('/users/:id/bid-assignments', async (req, res, next) => {
  try {
    const { bid_id } = req.body;
    if (!bid_id) return res.status(400).json({ error: 'bid_id required' });

    const existing = await db('bid_assignments').where({ bid_id, user_id: req.params.id }).first();
    if (existing) return res.status(409).json({ error: 'Already assigned' });

    const [assignment] = await db('bid_assignments').insert({ bid_id, user_id: req.params.id }).returning('*');
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// DELETE /api/admin/users/:id/bid-assignments/:bidId — remove bid assignment
router.delete('/users/:id/bid-assignments/:bidId', async (req, res, next) => {
  try {
    await db('bid_assignments').where({ bid_id: req.params.bidId, user_id: req.params.id }).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/project-assignments — assign project to user
router.post('/users/:id/project-assignments', async (req, res, next) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const existing = await db('project_assignments').where({ project_id, user_id: req.params.id }).first();
    if (existing) return res.status(409).json({ error: 'Already assigned' });

    const [assignment] = await db('project_assignments').insert({ project_id, user_id: req.params.id }).returning('*');
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// DELETE /api/admin/users/:id/project-assignments/:projectId — remove project assignment
router.delete('/users/:id/project-assignments/:projectId', async (req, res, next) => {
  try {
    await db('project_assignments').where({ project_id: req.params.projectId, user_id: req.params.id }).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PASSWORD RESET (admin-initiated)
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/admin/users/:id/password-reset
 *
 * Admin generates a one-time password reset link for another user.
 * The link contains a random token; the token's bcrypt hash is stored
 * server-side, never the plaintext. The user's current password stays
 * active until they complete the reset (per spec).
 *
 * Response: { link, expiresAt, delivery }
 *   - link: full URL to put in the reset email
 *   - expiresAt: ISO timestamp when the token becomes invalid
 *   - delivery: 'email' | 'console' (based on whether email is configured)
 *
 * Rate limit: 5 active (unused, unexpired) reset tokens per user at a time.
 * Older tokens are NOT invalidated; they just count against the cap.
 * Prevents accidental spam.
 */
router.post('/users/:id/password-reset', async (req, res, next) => {
  try {
    // 1. Load target user
    const user = await db('users').where({ id: req.params.id }).first();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.active) return res.status(400).json({ error: 'User is deactivated; reactivate before resetting password' });

    // 2. Rate-limit check: max 5 active (unused + unexpired) tokens per user
    const activeCount = await db('password_resets')
      .where('user_id', user.id)
      .whereNull('used_at')
      .where('expires_at', '>', db.fn.now())
      .count('* as n')
      .first();
    if (parseInt(activeCount.n, 10) >= 5) {
      return res.status(429).json({
        error: 'Too many active reset links for this user',
        message: 'Wait for existing links to expire or be used before generating another.',
      });
    }

    // 3. Generate token — format: <resetId>.<secret>
    //    The id lets the consume endpoint look up exactly one row to verify against,
    //    and bcrypt-compare the secret portion. No scanning all active resets.
    const secret = crypto.randomBytes(32).toString('base64url');
    const tokenHash = await bcrypt.hash(secret, 10);

    // 4. Read expiry hours from global variable (default 24)
    const expiryGlobal = await db('global_variables').where('key', 'password_reset_expiry_hours').first();
    const expiryHours = parseInt(expiryGlobal?.value || '24', 10);
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);

    // 5. Determine delivery channel
    const emailConfigured = !!(
      (process.env.EMAIL_PROVIDER === 'sendgrid' && process.env.SENDGRID_API_KEY) ||
      (process.env.EMAIL_PROVIDER === 'ses' && process.env.SES_REGION)
    );
    const deliveryMethod = emailConfigured ? 'email' : 'console';

    // 6. Persist the reset record
    const [reset] = await db('password_resets').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by_admin_id: req.user.id,
      delivery_method: deliveryMethod,
      client_ip: req.ip,
    }).returning('*');

    // 7. Build the link — token format: <resetId>.<secret>
    //    Frontend picks up ?reset=<token> on the login page and shows the reset form
    const token = `${reset.id}.${secret}`;
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${baseUrl}/?reset=${token}`;

    // 8. Deliver — email if configured, otherwise just log to console
    const subject = 'Password reset for ConstructPM';
    const bodyText = `Hello ${user.first_name || 'there'},

An administrator has initiated a password reset for your ConstructPM account.

Click this link to set a new password:
${link}

This link will expire at ${expiresAt.toISOString()} (${expiryHours} hours from now).
Your current password stays active until you complete the reset.

If you did not request this, you can safely ignore this email — no changes have been made to your account.

— ConstructPM`;

    if (emailConfigured) {
      try {
        // Reuse NotificationService's email senders
        await NotificationService._deliverEmail(user.email, {
          title: subject,
          body: bodyText,
          action_url: link,
        });
        console.log(`[PasswordReset] Email sent to ${user.email} (reset id ${reset.id})`);
      } catch (err) {
        console.error(`[PasswordReset] Email send failed: ${err.message} — link is still valid`);
      }
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[PasswordReset] EMAIL NOT CONFIGURED — link printed below');
      console.log(`[PasswordReset] To:      ${user.email}`);
      console.log(`[PasswordReset] Subject: ${subject}`);
      console.log(`[PasswordReset] Link:    ${link}`);
      console.log(`[PasswordReset] Expires: ${expiresAt.toISOString()}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    // 9. Audit trail
    try {
      await db('audit_log').insert({
        table_name: 'password_resets',
        record_id: reset.id,
        action: 'insert',
        field_name: 'reset_initiated',
        new_value: `target_user=${user.email}`,
        user_id: req.user.id,
        ip_address: req.ip,
      });
    } catch { /* audit optional — don't fail the reset if audit insert fails */ }

    // 10. Respond
    res.json({
      success: true,
      link: deliveryMethod === 'console' ? link : undefined, // Only return link when admin needs to copy it
      expiresAt: expiresAt.toISOString(),
      delivery: deliveryMethod,
      message: deliveryMethod === 'email'
        ? `Reset link emailed to ${user.email}.`
        : 'Reset link printed to server console (email not configured).',
    });
  } catch (err) { next(err); }
});

module.exports = router;
