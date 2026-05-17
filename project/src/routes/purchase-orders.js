const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { body, param, validationResult } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const db = require('../config/database');
const Vendor = require('../models/Vendor');
const PODocumentService = require('../services/PODocumentService');
const FileService = require('../services/FileService');
const StorageService = require('../services/StorageService');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/purchase-orders?project_id=...
 * List purchase orders, optionally filtered by project.
 * Used by the project detail page's PO tab.
 */
router.get('/', authorize('purchase_orders:read'), async (req, res, next) => {
  try {
    const { project_id, status } = req.query;
    let q = db('purchase_orders')
      .leftJoin('customers', 'purchase_orders.vendor_id', 'customers.id')
      .leftJoin('users', 'purchase_orders.created_by', 'users.id')
      .select(
        'purchase_orders.*',
        'customers.name as vendor_name',
        db.raw("users.first_name || ' ' || users.last_name as created_by_name")
      )
      .orderBy('purchase_orders.created_at', 'desc');

    if (project_id) q = q.where('purchase_orders.project_id', project_id);
    if (status) q = q.where('purchase_orders.status', status);

    const pos = await q.limit(200);
    res.json({ purchase_orders: pos, total: pos.length });
  } catch (err) { next(err); }
});

/**
 * GET /api/purchase-orders/:id — detail with line items
 */
router.get('/:id', authorize('purchase_orders:read'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const po = await db('purchase_orders')
      .leftJoin('customers', 'purchase_orders.vendor_id', 'customers.id')
      .select('purchase_orders.*', 'customers.name as vendor_name')
      .where('purchase_orders.id', req.params.id)
      .first();
    if (!po) return res.status(404).json({ error: 'PO not found' });

    const lineItems = await db('po_line_items').where('po_id', po.id).orderBy('sort_order', 'asc');
    res.json({ ...po, line_items: lineItems });
  } catch (err) { next(err); }
});

/**
 * POST /api/purchase-orders
 * Create an outbound PO.
 *
 * Body: {
 *   project_id (required),
 *   vendor_id (optional — if not provided, vendor_name used as free text),
 *   vendor_name (used if vendor_id not provided),
 *   delivery_date,
 *   tax_amount,
 *   shipping_amount,
 *   notes,
 *   line_items: [{ description, quantity, unit, unit_price }]
 * }
 *
 * Side effects:
 *   1. Creates purchase_orders row + po_line_items rows in a transaction
 *   2. Generates Excel PO document
 *   3. Saves Excel to projects/{...}/purchase_orders/PO-{po_number}.xlsx
 *   4. Stores file_path on the PO row
 */
router.post('/',
  authorize('purchase_orders:create'),
  [
    body('project_id').isUUID().withMessage('project_id required'),
    body('line_items').isArray({ min: 1 }).withMessage('At least one line item required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation error', details: errors.array() });

      const {
        project_id, vendor_id, vendor_name,
        delivery_date, tax_amount, shipping_amount, notes,
        line_items,
      } = req.body;

      // Resolve project (and verify access)
      const project = await db('projects').where({ id: project_id }).first();
      if (!project) return res.status(404).json({ error: 'Project not found' });

      // PMs can only create POs for their own projects
      if (req.user.role === 'project_manager' && project.pm_id !== req.user.id) {
        return res.status(403).json({ error: 'You can only create POs for your own projects' });
      }

      // Resolve vendor (if vendor_id provided)
      let vendor = null;
      if (vendor_id) {
        vendor = await Vendor.findById(vendor_id);
        if (!vendor) return res.status(400).json({ error: 'Vendor not found' });
      }
      const vendorDisplay = vendor?.name || vendor_name || 'Unknown Vendor';

      // Calculate subtotal from line items (unit_price × qty)
      const subtotal = line_items.reduce((sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0);
      const tax = parseFloat(tax_amount) || 0;
      const shipping = parseFloat(shipping_amount) || 0;
      const total = subtotal + tax + shipping;

      // Generate PO number — {YY}-PO-{seq for this PM this year}
      const yearShort = new Date().getFullYear().toString().slice(-2);
      const userInitials = req.user.initials || 'XX';
      const prefix = `${yearShort}-${userInitials}-PO-`;
      const existing = await db('purchase_orders')
        .leftJoin('users', 'purchase_orders.created_by', 'users.id')
        .where('purchase_orders.po_number', 'like', `${prefix}%`)
        .pluck('purchase_orders.po_number');
      let maxSeq = 0;
      for (const num of existing) {
        const seq = parseInt(num.slice(prefix.length), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
      const po_number = `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;

      // Insert PO + line items in a transaction
      const result = await db.transaction(async (trx) => {
        const [po] = await trx('purchase_orders').insert({
          project_id,
          po_number,
          vendor_id: vendor_id || null,
          vendor: vendorDisplay,
          total,
          tax_amount: tax,
          shipping_amount: shipping,
          order_date: trx.raw('CURRENT_DATE'),
          delivery_date: delivery_date || null,
          status: 'draft',
          notes: notes || null,
          created_by: req.user.id,
        }).returning('*');

        const liRows = line_items.map((li, idx) => ({
          po_id: po.id,
          description: li.description || '',
          quantity: parseFloat(li.quantity) || 0,
          unit_price: parseFloat(li.unit_price) || 0,
          total: (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0),
          sort_order: idx,
        }));
        await trx('po_line_items').insert(liRows);

        return po;
      });

      // Generate Excel PO document
      try {
        // Make sure project folder exists
        if (!project.folder_path) {
          // Create folder if missing
          const user = await db('users').where({ id: project.pm_id }).first();
          const customer = await db('customers').where({ id: project.customer_id }).first();
          // Look up primary project number for folder naming
          const primaryNum = await db('project_numbers')
            .where('project_id', project.id).where('label', 'Primary').first();
          const folderLeaf = primaryNum?.number || project.name;
          const folderPath = await FileService.createProjectFolders(
            project.year,
            `${user.first_name}_${user.last_name}`,
            customer?.name || 'Unknown',
            folderLeaf
          );
          await db('projects').where({ id: project.id }).update({ folder_path: folderPath });
          project.folder_path = folderPath;
        }

        // Pull globals for company info on the PO header
        const globalRows = await db('global_variables')
          .whereIn('key', ['home_location_address', 'company_name', 'company_phone', 'company_email']);
        const globals = {};
        for (const g of globalRows) globals[g.key] = g.value;

        const company = {
          name: globals.company_name || 'Your Company',
          street: globals.home_location_address || '',
          phone: globals.company_phone || '',
          email: globals.company_email || '',
        };

        // Save to absolute path on disk
        const storageBase = process.env.STORAGE_BASE_PATH || './storage';
        const relativePath = path.join(project.folder_path, 'purchase_orders', `PO-${po_number}.xlsx`);
        const absolutePath = path.join(storageBase, relativePath);

        await PODocumentService.generate({
          po: { ...result, line_items },
          lineItems: line_items,
          vendor,
          project,
          company,
          outputPath: absolutePath,
        });

        // Store relative path on the PO row
        await db('purchase_orders').where({ id: result.id }).update({ file_path: relativePath });
        result.file_path = relativePath;
      } catch (genErr) {
        console.error('[PO] Document generation failed:', genErr.message);
        // Don't fail the request — the PO record is created; file can be regenerated later
        result.file_generation_error = genErr.message;
      }

      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

/**
 * GET /api/purchase-orders/:id/download
 * Download the PO Excel file. Returns the file directly with proper headers.
 */
router.get('/:id/download', authorize('purchase_orders:read'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const po = await db('purchase_orders').where({ id: req.params.id }).first();
    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (!po.file_path) return res.status(404).json({ error: 'PO has no generated file' });

    const storageBase = path.resolve(process.env.STORAGE_BASE_PATH || './storage');
    const fullPath = path.resolve(path.join(storageBase, po.file_path));

    // Directory traversal defense
    if (!fullPath.startsWith(storageBase)) {
      return res.status(403).json({ error: 'Invalid file path' });
    }

    try {
      await fs.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `inline; filename="PO-${po.po_number}.xlsx"`);
    res.sendFile(fullPath);
  } catch (err) { next(err); }
});

/**
 * POST /api/purchase-orders/:id/regenerate
 * Regenerate the Excel file from current DB data (in case the file was deleted
 * or the PO was edited).
 */
router.post('/:id/regenerate', authorize('purchase_orders:create'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const po = await db('purchase_orders').where({ id: req.params.id }).first();
    if (!po) return res.status(404).json({ error: 'PO not found' });

    const project = await db('projects').where({ id: po.project_id }).first();
    const lineItems = await db('po_line_items').where('po_id', po.id).orderBy('sort_order', 'asc');
    const vendor = po.vendor_id ? await Vendor.findById(po.vendor_id) : null;

    const globalRows = await db('global_variables')
      .whereIn('key', ['home_location_address', 'company_name', 'company_phone', 'company_email']);
    const globals = {};
    for (const g of globalRows) globals[g.key] = g.value;

    const storageBase = process.env.STORAGE_BASE_PATH || './storage';
    const relativePath = path.join(project.folder_path, 'purchase_orders', `PO-${po.po_number}.xlsx`);
    const absolutePath = path.join(storageBase, relativePath);

    await PODocumentService.generate({
      po,
      lineItems,
      vendor,
      project,
      company: { name: globals.company_name || 'Your Company', street: globals.home_location_address || '' },
      outputPath: absolutePath,
    });

    await db('purchase_orders').where({ id: po.id }).update({ file_path: relativePath });
    res.json({ regenerated: true, file_path: relativePath });
  } catch (err) { next(err); }
});

module.exports = router;
