/**
 * Financials Routes
 * 
 * Cross-project views of invoices and purchase orders.
 * Used by the Invoices & POs page.
 * PM sees own projects, Accounting sees all, Admin sees all.
 * 
 *   GET /api/financials/invoices         — List invoices across projects
 *   GET /api/financials/purchase-orders  — List POs across projects
 *   GET /api/financials/summary          — Quick totals
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const db = require('../config/database');
const { ROLES } = require('../config/roles');

const router = express.Router();
router.use(authenticate);
router.use(authorize('projects:read'));

// Helper — given a list of project IDs, return a map of project_id → primary project number string
async function getPrimaryNumberMap(projectIds) {
  if (!projectIds || projectIds.length === 0) return {};
  const rows = await db('project_numbers')
    .whereIn('project_id', projectIds)
    .where('label', 'Primary')
    .select('project_id', 'number');
  const map = {};
  for (const r of rows) map[r.project_id] = r.number;
  return map;
}

// GET /api/financials/invoices
router.get('/invoices', async (req, res, next) => {
  try {
    const { project_id, status, start_date, end_date, search, limit, offset } = req.query;

    const query = db('invoices')
      .select('invoices.*', 'projects.name as project_name',
        'bids.bid_number as won_from_bid_number',
        db.raw("users.first_name || ' ' || users.last_name as confirmed_by_name"))
      .join('projects', 'invoices.project_id', 'projects.id')
      .leftJoin('bids', 'projects.bid_id', 'bids.id')
      .leftJoin('users', 'invoices.confirmed_by', 'users.id')
      .orderBy('invoices.invoice_date', 'desc')
      .limit(parseInt(limit) || 50)
      .offset(parseInt(offset) || 0);

    // PM sees own projects only
    if (req.user.role === ROLES.PROJECT_MANAGER) {
      query.where('projects.pm_id', req.user.id);
    }

    if (project_id) query.where('invoices.project_id', project_id);
    if (status) query.where('invoices.status', status);
    if (start_date) query.where('invoices.invoice_date', '>=', start_date);
    if (end_date) query.where('invoices.invoice_date', '<=', end_date);
    if (search) {
      query.where(function () {
        this.where('invoices.invoice_number', 'ilike', `%${search}%`)
          .orWhere('invoices.customer', 'ilike', `%${search}%`)
          .orWhere('projects.name', 'ilike', `%${search}%`);
      });
    }

    const invoices = await query;

    // Attach primary project number per invoice
    const primaryMap = await getPrimaryNumberMap(invoices.map(i => i.project_id));
    for (const inv of invoices) inv.project_number = primaryMap[inv.project_id] || null;

    const countQuery = db('invoices').join('projects', 'invoices.project_id', 'projects.id').count('invoices.id as total');
    if (req.user.role === ROLES.PROJECT_MANAGER) countQuery.where('projects.pm_id', req.user.id);
    if (status) countQuery.where('invoices.status', status);
    const [{ total }] = await countQuery;

    res.json({ invoices, total: parseInt(total, 10) });
  } catch (err) { next(err); }
});

// GET /api/financials/purchase-orders
router.get('/purchase-orders', async (req, res, next) => {
  try {
    const { project_id, status, start_date, end_date, search, limit, offset } = req.query;

    const query = db('purchase_orders')
      .select('purchase_orders.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as confirmed_by_name"))
      .join('projects', 'purchase_orders.project_id', 'projects.id')
      .leftJoin('users', 'purchase_orders.confirmed_by', 'users.id')
      .orderBy('purchase_orders.order_date', 'desc')
      .limit(parseInt(limit) || 50)
      .offset(parseInt(offset) || 0);

    if (req.user.role === ROLES.PROJECT_MANAGER) {
      query.where('projects.pm_id', req.user.id);
    }

    if (project_id) query.where('purchase_orders.project_id', project_id);
    if (status) query.where('purchase_orders.status', status);
    if (start_date) query.where('purchase_orders.order_date', '>=', start_date);
    if (end_date) query.where('purchase_orders.order_date', '<=', end_date);
    if (search) {
      query.where(function () {
        this.where('purchase_orders.po_number', 'ilike', `%${search}%`)
          .orWhere('purchase_orders.vendor', 'ilike', `%${search}%`)
          .orWhere('projects.name', 'ilike', `%${search}%`);
      });
    }

    const pos = await query;

    // Attach primary project number per PO
    const primaryMap = await getPrimaryNumberMap(pos.map(p => p.project_id));
    for (const po of pos) po.project_number = primaryMap[po.project_id] || null;

    const countQuery = db('purchase_orders').join('projects', 'purchase_orders.project_id', 'projects.id').count('purchase_orders.id as total');
    if (req.user.role === ROLES.PROJECT_MANAGER) countQuery.where('projects.pm_id', req.user.id);
    if (status) countQuery.where('purchase_orders.status', status);
    const [{ total }] = await countQuery;

    res.json({ purchase_orders: pos, total: parseInt(total, 10) });
  } catch (err) { next(err); }
});

// GET /api/financials/summary — quick dashboard numbers
router.get('/summary', async (req, res, next) => {
  try {
    const pmFilter = req.user.role === ROLES.PROJECT_MANAGER ? req.user.id : null;

    const invQuery = db('invoices').join('projects', 'invoices.project_id', 'projects.id')
      .whereNot('invoices.status', 'cancelled');
    const poQuery = db('purchase_orders').join('projects', 'purchase_orders.project_id', 'projects.id')
      .whereNot('purchase_orders.status', 'cancelled');

    if (pmFilter) { invQuery.where('projects.pm_id', pmFilter); poQuery.where('projects.pm_id', pmFilter); }

    const [invStats] = await invQuery.select(
      db.raw('COALESCE(SUM(invoices.amount),0) as total_invoiced'),
      db.raw('COUNT(*) as invoice_count'),
      db.raw("COUNT(*) FILTER (WHERE invoices.status = 'paid') as paid_count"),
      db.raw("COUNT(*) FILTER (WHERE invoices.status NOT IN ('paid','cancelled') AND invoices.payment_due_date < NOW()) as overdue_count"),
    );

    const [poStats] = await poQuery.select(
      db.raw('COALESCE(SUM(purchase_orders.total),0) as total_po_cost'),
      db.raw('COUNT(*) as po_count'),
    );

    res.json({
      total_invoiced: parseFloat(invStats.total_invoiced),
      invoice_count: parseInt(invStats.invoice_count),
      paid_count: parseInt(invStats.paid_count),
      overdue_count: parseInt(invStats.overdue_count),
      total_po_cost: parseFloat(poStats.total_po_cost),
      po_count: parseInt(poStats.po_count),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// BARE-MINIMUM DATA ENTRY (project detail tab)
// ═══════════════════════════════════════════════════════════
//
// These exist so the project detail tab can record invoices/POs and
// attach notes EVEN WHEN the full Invoice/PO features are toggled off
// site-wide. They intentionally skip document generation, extraction,
// and line items — just the header fields + notes. The records land in
// the same invoices / purchase_orders tables, so they roll up into
// Project.getFinancials automatically (no separate rollup needed).
//
// Write access mirrors the rest of project mutation: admins/accounting
// on any project, PM only on their own.

async function assertProjectWriteAccess(req, projectId) {
  const project = await db('projects').where('id', projectId).first();
  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 });
  }
  if (req.user.role === ROLES.PROJECT_MANAGER && project.pm_id !== req.user.id) {
    throw Object.assign(new Error('Forbidden — not your project'), { status: 403 });
  }
  return project;
}

// POST /api/financials/invoices  — bare invoice
router.post('/invoices', async (req, res, next) => {
  try {
    const { project_id, invoice_number, amount, invoice_date, notes } = req.body || {};
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    if (!invoice_number || !String(invoice_number).trim()) {
      return res.status(400).json({ error: 'invoice_number required' });
    }
    await assertProjectWriteAccess(req, project_id);

    const [row] = await db('invoices').insert({
      project_id,
      invoice_number: String(invoice_number).trim(),
      amount: parseFloat(amount) || 0,
      invoice_date: invoice_date || null,
      status: 'pending',
      notes: notes ? String(notes) : null,
    }).returning('*');

    res.json({ invoice: row });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/financials/invoices/:id/notes  — edit notes only
router.patch('/invoices/:id/notes', async (req, res, next) => {
  try {
    const inv = await db('invoices').where('id', req.params.id).first();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    await assertProjectWriteAccess(req, inv.project_id);
    await db('invoices').where('id', req.params.id).update({
      notes: req.body?.notes != null ? String(req.body.notes) : null,
      updated_at: db.fn.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/financials/purchase-orders  — bare PO
router.post('/purchase-orders', async (req, res, next) => {
  try {
    const { project_id, po_number, vendor, total, notes } = req.body || {};
    if (!project_id) return res.status(400).json({ error: 'project_id required' });
    if (!po_number || !String(po_number).trim()) {
      return res.status(400).json({ error: 'po_number required' });
    }
    await assertProjectWriteAccess(req, project_id);

    const [row] = await db('purchase_orders').insert({
      project_id,
      po_number: String(po_number).trim(),
      vendor: vendor ? String(vendor) : null,
      total: parseFloat(total) || 0,
      status: 'pending',
      notes: notes ? String(notes) : null,
    }).returning('*');

    res.json({ purchase_order: row });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/financials/purchase-orders/:id/notes  — edit notes only
router.patch('/purchase-orders/:id/notes', async (req, res, next) => {
  try {
    const po = await db('purchase_orders').where('id', req.params.id).first();
    if (!po) return res.status(404).json({ error: 'PO not found' });
    await assertProjectWriteAccess(req, po.project_id);
    await db('purchase_orders').where('id', req.params.id).update({
      notes: req.body?.notes != null ? String(req.body.notes) : null,
      updated_at: db.fn.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
