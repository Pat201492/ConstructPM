/**
 * Equipment Routes
 * 
 * Web + Mobile API for equipment management:
 *   GET    /                     — List all (grouped by location option)
 *   GET    /types                — Equipment type categories
 *   GET    /expiring             — Certifications expiring soon
 *   GET    /display-board        — Shop floor display (filled vs unfilled orders)
 *   GET    /:id                  — Detail + checkout history + documents
 *   POST   /                     — Create equipment item (admin)
 *   PATCH  /:id                  — Update item (admin)
 *   GET    /barcode/:code        — Lookup by barcode (mobile scan)
 *   POST   /:id/checkout         — Check out to project
 *   POST   /:id/return           — Return to shop
 *   POST   /:id/maintenance      — Flag for maintenance
 *   POST   /:id/clear-maintenance — Clear maintenance flag
 *   POST   /:id/documents        — Attach document (calibration cert, etc.)
 *   GET    /requests              — List equipment requests
 *   POST   /requests              — Create request (PM)
 *   GET    /requests/:id          — Request detail with line items
 *   POST   /requests/:id/assign   — Assign barcode to line item (shop staff scan)
 *   POST   /requests/:id/fill     — Mark request as filled
 */

const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const Equipment = require('../models/Equipment');
const db = require('../config/database');

// pg returns DATE columns as JS Date objects. Writing them straight back
// into an UPDATE via knex stringifies them as "Tue May 18 2026..." which
// pg rejects as invalid date syntax. Convert through UTC getters when
// the value is a Date; pass strings through unchanged.
function ymd(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}
const FileService = require('../services/FileService');
const NotificationService = require('../services/NotificationService');

const router = express.Router();
router.use(authenticate);

const docUpload = multer({ dest: '/tmp/equip_docs/', limits: { fileSize: 20 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════════════
// LIST & LOOKUP
// ═══════════════════════════════════════════════════════════

// List all equipment (optionally grouped by location)
router.get('/', authorize('equipment:read'), async (req, res, next) => {
  try {
    if (req.query.grouped === 'true') {
      const result = await Equipment.findGroupedByLocation();
      return res.json(result);
    }
    const { status, equipment_type, search, project_id, limit, offset } = req.query;
    const result = await Equipment.findAll({
      status, equipment_type, search, project_id,
      limit: parseInt(limit) || 100, offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Equipment types (for filter dropdown)
router.get('/types', authorize('equipment:read'), async (req, res, next) => {
  try {
    const types = await Equipment.getTypes();
    res.json({ types });
  } catch (err) { next(err); }
});

// Certifications expiring soon
router.get('/expiring', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const items = await Equipment.getExpiringCertifications(days);
    res.json({ items, days_ahead: days });
  } catch (err) { next(err); }
});

// Display board — today's requests with filled/unfilled status
router.get('/display-board', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const requests = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as requested_by_name"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .join('users', 'equipment_requests.requested_by', 'users.id')
      .whereIn('equipment_requests.status', ['open', 'partially_filled', 'filled'])
      .where('equipment_requests.created_at', '>=', today)
      .orderBy('equipment_requests.created_at', 'desc');

    // Get line items for all requests in one query (avoids N+1)
    const reqIds = requests.map(r => r.id);
    const allLines = reqIds.length > 0
      ? await db('equipment_request_lines')
          .select('equipment_request_lines.*', 'equipment.barcode_id', 'equipment.equipment_name as assigned_equipment_name')
          .leftJoin('equipment', 'equipment_request_lines.assigned_equipment_id', 'equipment.id')
          .whereIn('request_id', reqIds)
      : [];
    const linesByReq = {};
    for (const l of allLines) { if (!linesByReq[l.request_id]) linesByReq[l.request_id] = []; linesByReq[l.request_id].push(l); }
    for (const req of requests) {
      req.lines = linesByReq[req.id] || [];
      req.total_lines = req.lines.length;
      req.filled_lines = req.lines.filter(l => l.assigned_equipment_id).length;
    }

    res.json({ requests });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// DETAIL & BARCODE
// ═══════════════════════════════════════════════════════════

// Lookup by barcode (mobile scan)
router.get('/barcode/:code', authorize('equipment:read'), async (req, res, next) => {
  try {
    const item = await Equipment.findByBarcode(req.params.code);
    if (!item) return res.status(404).json({ error: 'Equipment not found for this barcode' });
    const history = await Equipment.getCheckoutHistory(item.id);
    const documents = await Equipment.getDocuments(item.id);
    res.json({ ...item, checkout_history: history, documents });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// MOBILE CONTRACT ENDPOINTS
// ═══════════════════════════════════════════════════════════
// See docs/MOBILE_APP_CONTRACTS.md. The app is a separate project;
// these are the backend surface it consumes. Defined before /:id so
// Express doesn't treat "mobile" as an id.

// Barcode equipment entry — mobile scans a barcode, fills the form.
// Mandatory: manufacturer, equipment_name, equipment_type,
// equipment_subtype. Optional: certification_date, maintenance date.
// If the barcode already exists this UPDATES it (re-tagging), else
// creates. Mandatory-field enforcement is server-side too (the app
// blocks submit, but never trust only the client).
router.post('/mobile/entry', authorize('equipment:read'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const missing = ['barcode_id', 'manufacturer', 'equipment_name', 'equipment_type', 'equipment_subtype']
      .filter(k => !b[k] || !String(b[k]).trim());
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }
    const existing = await Equipment.findByBarcode(b.barcode_id);
    const payload = {
      barcode_id: String(b.barcode_id).trim(),
      manufacturer: b.manufacturer,
      equipment_name: b.equipment_name,
      equipment_type: b.equipment_type,
      equipment_subtype: b.equipment_subtype,
      certification_date: b.certification_date || null,
    };
    let item;
    if (existing) {
      item = await Equipment.update(existing.id, payload);
    } else {
      item = await Equipment.create({ ...payload, equipment_cost: 0, cert_expiry_alert_days: 30 });
    }
    res.status(existing ? 200 : 201).json({ item, created: !existing });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Barcode already exists' });
    next(err);
  }
});

// Return to shop by scanned barcode. Unconditional (unlike the
// checkout-state-gated /:id/return): mobile scans, equipment goes back
// to 'shop', status_change_date stamped today. Mirrors the spec's
// "scan → location back to shop + date".
router.post('/mobile/return', authorize('equipment:read'), async (req, res, next) => {
  try {
    const code = (req.body?.barcode_id || req.body?.code || '').toString().trim();
    if (!code) return res.status(400).json({ error: 'barcode_id required' });
    const item = await Equipment.findByBarcode(code);
    if (!item) return res.status(404).json({ error: 'Equipment not found for this barcode' });
    const today = new Date().toISOString().slice(0, 10);
    // Also flip status back to 'available' so the master list shows
    // the piece as in-shop and the in-shop picker can offer it again.
    // The previous version only updated location, leaving status as
    // 'checked_out' indefinitely after a return scan.
    await db('equipment').where('id', item.id).update({
      status: 'available',
      current_location: 'shop',
      current_project_id: null,
      status_change_date: today,
      updated_at: db.fn.now(),
    });
    res.json({ ok: true, barcode_id: code, status: 'available', location: 'shop', status_change_date: today });
  } catch (err) { next(err); }
});

// Maintenance lookup by scanned barcode → that equipment's record
// table (so the mobile maintenance tab can show it after a scan, with
// the EquipNum visible per the spec).
router.get('/mobile/maintenance/:code', authorize('equipment:read'), async (req, res, next) => {
  try {
    const item = await Equipment.findByBarcode(req.params.code);
    if (!item) return res.status(404).json({ error: 'Equipment not found for this barcode' });
    const records = await db('equipment_maintenance_records')
      .where('equipment_id', item.id)
      .orderBy([{ column: 'date_of_service', order: 'desc' }, { column: 'created_at', order: 'desc' }]);
    res.json({
      equipment: {
        id: item.id, barcode_id: item.barcode_id, equipment_name: item.equipment_name,
        equipment_type: item.equipment_type, equipment_subtype: item.equipment_subtype,
        service_date: item.service_date, rolled_cert_date: item.rolled_cert_date, flag: item.flag,
      },
      records,
    });
  } catch (err) { next(err); }
});

// Detail by ID
router.get('/:id', authorize('equipment:read'), async (req, res, next) => {
  try {
    const item = await Equipment.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Equipment not found' });
    const history = await Equipment.getCheckoutHistory(item.id);
    const documents = await Equipment.getDocuments(item.id);
    res.json({ ...item, checkout_history: history, documents });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CRUD (admin)
// ═══════════════════════════════════════════════════════════

router.post('/', authorize('equipment:manage'),
  [body('barcode_id').trim().notEmpty(), body('equipment_name').trim().notEmpty()],
  async (req, res, next) => {
    try {
      const { barcode_id, equipment_name, manufacturer, equipment_type, equipment_subtype, equipment_cost, certification_date, cert_expiry_alert_days } = req.body;
      const item = await Equipment.create({
        barcode_id, equipment_name, manufacturer, equipment_type, equipment_subtype,
        equipment_cost: equipment_cost || 0,
        certification_date: certification_date || null,
        cert_expiry_alert_days: cert_expiry_alert_days || 30,
      });
      res.status(201).json(item);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Barcode already exists' });
      next(err);
    }
  }
);

router.patch('/:id', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const allowed = ['barcode_id', 'equipment_name', 'manufacturer', 'equipment_type', 'equipment_subtype', 'equipment_cost', 'certification_date', 'cert_expiry_alert_days', 'notes'];
    const data = {};
    for (const key of allowed) { if (req.body[key] !== undefined) data[key] = req.body[key]; }
    const item = await Equipment.update(req.params.id, data);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// DELETE /:id — remove an equipment item.
//
// Safety checks before deletion:
//   - Must not currently be checked out (suggest 'retired' status instead)
//   - Refuse if there's checkout history (would orphan history rows;
//     the right move is to mark the equipment 'retired' so reports
//     stay coherent)
//
// To bypass the history check (dangerous — loses audit trail), pass
// ?force=true in the query string. Admin-only via the equipment:manage
// permission, which is also gated at the route level.
router.delete('/:id', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const item = await db('equipment').where('id', req.params.id).first();
    if (!item) return res.status(404).json({ error: 'Not found' });

    if (item.status === 'checked_out') {
      return res.status(409).json({
        error: 'Cannot delete equipment that is currently checked out. Return it first, or change its status to "retired" if it is no longer in service.',
      });
    }

    if (req.query.force !== 'true') {
      const hasHistory = await db('equipment_checkout_log').where('equipment_id', req.params.id).first();
      if (hasHistory) {
        return res.status(409).json({
          error: 'This equipment has checkout history. Deleting it would orphan those records. Mark the equipment as "retired" via the edit pop-up to preserve the audit trail, or pass ?force=true to delete anyway.',
        });
      }
    }

    await db('equipment').where('id', req.params.id).del();
    res.json({ deleted: true, id: req.params.id });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CHECKOUT / RETURN / MAINTENANCE
// ═══════════════════════════════════════════════════════════

router.post('/:id/checkout', authorize('equipment:fulfill'),
  [body('project_id').isUUID()],
  async (req, res, next) => {
    try {
      const item = await Equipment.checkout(req.params.id, req.body.project_id, req.user.id, req.body.request_line_id);
      res.json({ item, message: 'Equipment checked out' });
    } catch (err) {
      if (err.message.includes('maintenance') || err.message.includes('already')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

router.post('/:id/return', authorize('equipment:fulfill'), async (req, res, next) => {
  try {
    const item = await Equipment.returnToShop(req.params.id, req.user.id);
    res.json({ item, message: 'Equipment returned to shop' });
  } catch (err) {
    if (err.message.includes('not checked out')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/maintenance', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const item = await Equipment.flagMaintenance(req.params.id);
    res.json({ item, message: 'Flagged for maintenance' });
  } catch (err) { next(err); }
});

router.post('/:id/clear-maintenance', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const item = await Equipment.clearMaintenance(req.params.id);
    res.json({ item, message: 'Maintenance cleared' });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// MAINTENANCE RECORDS  (one table, presented per-equipment)
// ═══════════════════════════════════════════════════════════
//
// Rollup rules (Pat's spec), recomputed on every add/delete:
//   equipment.service_date     = MAX(date_of_service)         [most recent]
//   equipment.rolled_cert_date = MAX(cert_date) if any cert_date is in the
//                                future, else the cert_date closest to today
//   equipment.flag             = flag of the most recent record (by
//                                date_of_service, tiebreak created_at)
async function recomputeEquipmentRollups(equipmentId) {
  const recs = await db('equipment_maintenance_records')
    .where('equipment_id', equipmentId)
    .orderBy([{ column: 'date_of_service', order: 'desc' }, { column: 'created_at', order: 'desc' }]);

  if (recs.length === 0) {
    await db('equipment').where('id', equipmentId).update({
      service_date: null, rolled_cert_date: null, flag: null,
    });
    return;
  }

  // service_date = most recent date_of_service. ymd() because the raw
  // value from pg is a JS Date; writing it back unconverted is what
  // produced the "invalid input syntax for type date: Tue May 18" crash
  // when adding a maintenance record.
  const serviceDate = ymd(recs[0].date_of_service);

  // flag = most recent record's flag (recs already sorted newest-first)
  const flag = recs[0].flag || null;

  // rolled_cert_date: furthest-future cert if any future, else nearest
  // to today (past). Compare on date only.
  const todayStr = new Date().toISOString().slice(0, 10);
  const certs = recs.map(r => ymd(r.cert_date)).filter(Boolean);
  let rolledCert = null;
  if (certs.length) {
    const future = certs.filter(d => d >= todayStr).sort(); // ascending
    if (future.length) {
      rolledCert = future[future.length - 1]; // furthest future
    } else {
      // all in the past — nearest to today = the latest past date
      rolledCert = certs.sort()[certs.length - 1];
    }
  }

  await db('equipment').where('id', equipmentId).update({
    service_date: serviceDate,
    rolled_cert_date: rolledCert,
    flag,
  });
}

// GET /api/equipment/:id/maintenance-records — that equipment's table
router.get('/:id/maintenance-records', authorize('equipment:read'), async (req, res, next) => {
  try {
    const equip = await db('equipment').where('id', req.params.id).first();
    if (!equip) return res.status(404).json({ error: 'Equipment not found' });
    const records = await db('equipment_maintenance_records')
      .where('equipment_id', req.params.id)
      .orderBy([{ column: 'date_of_service', order: 'desc' }, { column: 'created_at', order: 'desc' }]);
    res.json({
      equipment: {
        id: equip.id, barcode_id: equip.barcode_id, equipment_name: equip.equipment_name,
        equipment_type: equip.equipment_type, equipment_subtype: equip.equipment_subtype,
        service_date: equip.service_date, rolled_cert_date: equip.rolled_cert_date, flag: equip.flag,
      },
      records,
    });
  } catch (err) { next(err); }
});

// POST /api/equipment/:id/maintenance-records — add an entry
router.post('/:id/maintenance-records', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const equip = await db('equipment').where('id', req.params.id).first();
    if (!equip) return res.status(404).json({ error: 'Equipment not found' });

    const today = new Date().toISOString().slice(0, 10);
    const { date_of_service, entered_by_name, cert_date, notes, flag } = req.body || {};

    // entered_by defaults to the current user (editable — if the client
    // sent a name, trust it; otherwise stamp the signed-in user).
    let enteredName = entered_by_name;
    if (!enteredName) {
      const me = await db('users').where('id', req.user.id).first();
      enteredName = me ? `${me.first_name} ${me.last_name}`.trim() : null;
    }

    const cleanFlag = ['red', 'yellow'].includes(flag) ? flag : null;

    const [rec] = await db('equipment_maintenance_records').insert({
      equipment_id: req.params.id,
      date_of_service: date_of_service || today,
      entered_by_name: enteredName,
      entered_by_id: req.user.id,
      cert_date: cert_date || null,
      notes: notes ? String(notes) : null,
      flag: cleanFlag,
    }).returning('*');

    await recomputeEquipmentRollups(req.params.id);
    res.status(201).json({ record: rec });
  } catch (err) { next(err); }
});

// PATCH /api/equipment/:id/maintenance-records/:recordId — edit entry
router.patch('/:id/maintenance-records/:recordId', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const allowed = ['date_of_service', 'entered_by_name', 'cert_date', 'notes', 'flag'];
    const data = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (data.flag !== undefined && !['red', 'yellow', null, ''].includes(data.flag)) {
      delete data.flag;
    }
    if (data.flag === '') data.flag = null;
    data.updated_at = db.fn.now();
    const updated = await db('equipment_maintenance_records')
      .where({ id: req.params.recordId, equipment_id: req.params.id })
      .update(data).returning('*');
    if (!updated.length) return res.status(404).json({ error: 'Record not found' });
    await recomputeEquipmentRollups(req.params.id);
    res.json({ record: updated[0] });
  } catch (err) { next(err); }
});

// POST /api/equipment/:id/clear-flag — clear the rolled-up flag.
// Pat's rule: the flag icon's ONLY action is Clear. A worsening flag is
// handled by filing a NEW maintenance record (which carries its own
// flag); you never "upgrade" via the icon. Clearing writes a marker
// record so history shows the flag was resolved and the rollup picks
// up "no flag" as the most recent state.
router.post('/:id/clear-flag', authorize('equipment:manage'), async (req, res, next) => {
  try {
    const equip = await db('equipment').where('id', req.params.id).first();
    if (!equip) return res.status(404).json({ error: 'Equipment not found' });
    const today = new Date().toISOString().slice(0, 10);
    const me = await db('users').where('id', req.user.id).first();
    // Insert a no-flag record dated today so it becomes the most recent
    // and the rollup resolves flag → null. Carries forward the current
    // cert so rolled_cert_date isn't lost.
    await db('equipment_maintenance_records').insert({
      equipment_id: req.params.id,
      date_of_service: today,
      entered_by_name: me ? `${me.first_name} ${me.last_name}`.trim() : null,
      entered_by_id: req.user.id,
      cert_date: equip.rolled_cert_date || null,
      notes: 'Flag cleared',
      flag: null,
    });
    await recomputeEquipmentRollups(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// DOCUMENTS (calibration certs, inspection reports)
// ═══════════════════════════════════════════════════════════

router.post('/:id/documents', authorize('equipment:manage'), docUpload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Document file required' });
    const { document_type, document_date, notes } = req.body;

    const destKey = `equipment_docs/${req.params.id}/${Date.now()}_${req.file.originalname}`;
    const stored = await FileService.storeUploadedFile(req.file.path, destKey);

    // Clean up temp file
    try { await require('fs').promises.unlink(req.file.path); } catch {}

    const [doc] = await db('equipment_documents').insert({
      equipment_id: req.params.id,
      document_type: document_type || 'other',
      file_path: stored.key,
      uploaded_by: req.user.id,
      document_date: document_date || null,
      notes: notes || null,
    }).returning('*');

    res.status(201).json(doc);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// EQUIPMENT REQUESTS
// ═══════════════════════════════════════════════════════════

// List requests (optionally filter by status)
// Mobile convenience endpoints for equipment requests
router.get('/requests/all', authorize('equipment:read'), async (req, res, next) => {
  try {
    const requests = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("u1.first_name || ' ' || u1.last_name as requester_name"),
        db.raw("u2.first_name || ' ' || u2.last_name as foreman_name"),
        db.raw("(SELECT COUNT(*) FROM equipment_request_lines WHERE request_id = equipment_requests.id)::int as line_count"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .join('users as u1', 'equipment_requests.requested_by', 'u1.id')
      .leftJoin('users as u2', 'equipment_requests.assigned_foreman_id', 'u2.id')
      .orderBy('equipment_requests.created_at', 'desc')
      .limit(50);
    res.json({ requests });
  } catch (err) { next(err); }
});

router.get('/requests/mine', authorize('equipment:read'), async (req, res, next) => {
  try {
    const requests = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("(SELECT COUNT(*) FROM equipment_request_lines WHERE request_id = equipment_requests.id)::int as line_count"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .where('equipment_requests.requested_by', req.user.id)
      .orderBy('equipment_requests.created_at', 'desc')
      .limit(50);
    res.json({ requests });
  } catch (err) { next(err); }
});

router.get('/requests/open', authorize('equipment:read'), async (req, res, next) => {
  try {
    const requests = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("u1.first_name || ' ' || u1.last_name as requester_name"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .join('users as u1', 'equipment_requests.requested_by', 'u1.id')
      .whereIn('equipment_requests.status', ['open', 'partially_filled'])
      .orderBy('equipment_requests.created_at', 'desc');

    // Fetch lines for each request
    for (const r of requests) {
      r.lines = await db('equipment_request_lines')
        .select('equipment_request_lines.*',
          'equipment.barcode_id', 'equipment.equipment_name as assigned_name')
        .leftJoin('equipment', 'equipment_request_lines.assigned_equipment_id', 'equipment.id')
        .where('request_id', r.id);
    }
    res.json({ requests });
  } catch (err) { next(err); }
});

// General request list (filter by query params)
router.get('/requests', authorize('equipment:read'), async (req, res, next) => {
  try {
    const query = db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as requested_by_name"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .join('users', 'equipment_requests.requested_by', 'users.id')
      .orderBy('equipment_requests.created_at', 'desc');

    if (req.query.status) query.where('equipment_requests.status', req.query.status);
    if (req.query.project_id) query.where('equipment_requests.project_id', req.query.project_id);

    const requests = await query;
    res.json({ requests });
  } catch (err) { next(err); }
});

// Create request (PM)
router.post('/requests', authorize('equipment:request'),
  [body('project_id').isUUID()],
  async (req, res, next) => {
    try {
      const { project_id, personnel_name, assigned_foreman_id, items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array required [{item_description, quantity}]' });
      }

      const [request] = await db('equipment_requests').insert({
        project_id,
        requested_by: req.user.id,
        assigned_foreman_id: assigned_foreman_id || null,
        personnel_name: personnel_name || null,
        source: 'typed',
        status: 'open',
      }).returning('*');

      const lineRows = items.map(item => ({
        request_id: request.id,
        item_description: item.item_description || item.description,
        quantity: item.quantity || 1,
      }));
      await db('equipment_request_lines').insert(lineRows);

      // #12: All shop staff + select users (configured via Admin → Inbox Access with type 'equipment_requests')
      const shopStaff = await db('users').where({ role: 'shop_staff', active: true }).pluck('id');

      // Additional users configured in inbox_access with inbox_type = 'equipment_requests'
      const extraByUser = await db('inbox_access')
        .where({ inbox_type: 'equipment_requests' })
        .whereNotNull('user_id')
        .pluck('user_id');
      const extraByRole = await db('inbox_access')
        .where({ inbox_type: 'equipment_requests' })
        .whereNotNull('role')
        .pluck('role');
      let extraRoleUsers = [];
      if (extraByRole.length > 0) {
        extraRoleUsers = await db('users').where('active', true).whereIn('role', extraByRole).pluck('id');
      }

      const allRecipients = [...new Set([...shopStaff, ...extraByUser, ...extraRoleUsers])];
      for (const staffId of allRecipients) {
        await NotificationService.send({
          userId: staffId,
          type: 'equipment_request',
          category: 'actionable',
          title: 'New equipment request',
          body: `${req.user.first_name} ${req.user.last_name} requested ${items.length} items for project`,
          actionType: 'fulfill_equipment',
          referenceType: 'equipment_request',
          referenceId: request.id,
        });
      }

      // #14: Notify assigned foreman
      if (assigned_foreman_id) {
        await NotificationService.send({
          userId: assigned_foreman_id,
          type: 'equipment_assigned_to_foreman',
          category: 'actionable',
          title: 'Equipment request assigned to you',
          body: `${items.length} items requested for your project. Check with shop staff for pickup.`,
          actionType: 'view_equipment_request',
          referenceType: 'equipment_request',
          referenceId: request.id,
        });
      }

      res.status(201).json({ request, lines: lineRows });
    } catch (err) { next(err); }
  }
);

// Request detail with line items
router.get('/requests/:id', authorize('equipment:read'), async (req, res, next) => {
  try {
    const request = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name')
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .where('equipment_requests.id', req.params.id)
      .first();
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const lines = await db('equipment_request_lines')
      .select('equipment_request_lines.*',
        'equipment.barcode_id', 'equipment.equipment_name as assigned_name')
      .leftJoin('equipment', 'equipment_request_lines.assigned_equipment_id', 'equipment.id')
      .where('request_id', request.id);

    res.json({ ...request, lines });
  } catch (err) { next(err); }
});

// Assign barcode to a request line item (shop staff scans)
router.post('/requests/:id/assign', authorize('equipment:fulfill'),
  [body('line_id').isUUID(), body('equipment_id').isUUID()],
  async (req, res, next) => {
    try {
      const { line_id, equipment_id } = req.body;

      // Get the request to find the project
      const request = await db('equipment_requests').where({ id: req.params.id }).first();
      if (!request) return res.status(404).json({ error: 'Request not found' });

      // Check equipment is available
      const equip = await Equipment.findById(equipment_id);
      if (!equip) return res.status(404).json({ error: 'Equipment not found' });
      if (equip.status === 'maintenance_required' || equip.status === 'in_maintenance') {
        return res.status(400).json({ error: `Equipment is in ${equip.status} status — cannot assign` });
      }

      // Assign to line item
      await db('equipment_request_lines').where({ id: line_id }).update({
        assigned_equipment_id: equipment_id,
        assigned_by: req.user.id,
        assigned_at: db.fn.now(),
      });

      // Checkout the equipment to the project
      await Equipment.checkout(equipment_id, request.project_id, req.user.id, line_id);

      // Check if all lines are filled
      const allLines = await db('equipment_request_lines').where({ request_id: req.params.id });
      const filledCount = allLines.filter(l => l.assigned_equipment_id).length;

      if (filledCount === allLines.length) {
        await db('equipment_requests').where({ id: req.params.id }).update({ status: 'filled', updated_at: db.fn.now() });
      } else if (filledCount > 0) {
        await db('equipment_requests').where({ id: req.params.id }).update({ status: 'partially_filled', updated_at: db.fn.now() });
      }

      res.json({ assigned: true, filled: filledCount, total: allLines.length });
    } catch (err) {
      if (err.message.includes('maintenance') || err.message.includes('already')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

// Mark request as filled manually
router.post('/requests/:id/fill', authorize('equipment:fulfill'), async (req, res, next) => {
  try {
    await db('equipment_requests').where({ id: req.params.id }).update({ status: 'filled', updated_at: db.fn.now() });

    // Notify PM
    const request = await db('equipment_requests').where({ id: req.params.id }).first();
    if (request) {
      await NotificationService.send({
        userId: request.requested_by,
        type: 'equipment_filled',
        category: 'informational',
        title: 'Equipment request filled',
        body: `Your equipment request has been fulfilled and is ready for pickup.`,
        referenceType: 'equipment_request',
        referenceId: request.id,
      });
    }

    res.json({ filled: true });
  } catch (err) { next(err); }
});

module.exports = router;
