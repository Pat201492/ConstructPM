const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const Inventory = require('../models/Inventory');
const NotificationService = require('../services/NotificationService');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { ROLES } = require('../config/roles');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);

// ── LIST INVENTORY ────────────────────────────────────────────

/**
 * GET /api/inventory
 * List inventory items with filters
 */
router.get(
  '/',
  authorize('inventory:read'),
  async (req, res, next) => {
    try {
      const filters = {
        category: req.query.category,
        search: req.query.search,
        low_stock: req.query.low_stock === 'true',
        active: req.query.active === 'false' ? false : true,
        limit: parseInt(req.query.limit, 10) || 100,
        offset: parseInt(req.query.offset, 10) || 0,
      };

      const result = await Inventory.findAll(filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/inventory/stats
 * Inventory summary dashboard
 */
router.get('/stats', authorize('inventory:read'), async (req, res, next) => {
  try {
    const stats = await Inventory.getStats();
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/inventory/low-stock
 * Items at or below minimum stock level
 */
router.get('/low-stock', authorize('inventory:read'), async (req, res, next) => {
  try {
    const items = await Inventory.getLowStockItems();
    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/inventory/categories
 * List distinct categories
 */
router.get('/categories', authorize('inventory:read'), async (req, res, next) => {
  try {
    const categories = await Inventory.getCategories();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// ── SINGLE ITEM ───────────────────────────────────────────────

/**
 * GET /api/inventory/:id
 * Get single item with allocation history
 */
router.get(
  '/:id',
  authorize('inventory:read'),
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const item = await Inventory.findById(req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not found' });

      const allocations = await Inventory.getAllocations({ inventory_id: item.id, limit: 20 });
      res.json({ item, allocations });
    } catch (err) {
      next(err);
    }
  }
);

// ── CREATE ITEM ───────────────────────────────────────────────

/**
 * POST /api/inventory
 * Add a new inventory item (Admin or Shop Manager)
 */
router.post(
  '/',
  authorize('inventory:create'),
  [
    body('item_name').notEmpty().trim().withMessage('Item name required'),
    body('category').optional().trim(),
    body('sku').optional().trim(),
    body('quantity').isFloat({ min: 0 }).withMessage('Quantity must be >= 0'),
    body('unit').optional().trim(),
    body('min_stock').optional().isFloat({ min: 0 }),
    body('location').optional().trim(),
    body('unit_cost').optional().isFloat({ min: 0 }),
    body('notes').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      // Check for duplicate SKU
      if (req.body.sku) {
        const existing = await Inventory.findBySku(req.body.sku);
        if (existing) {
          return res.status(409).json({ error: 'Duplicate SKU', message: `SKU "${req.body.sku}" already exists.` });
        }
      }

      const item = await Inventory.create({
        item_name: req.body.item_name,
        category: req.body.category || null,
        sku: req.body.sku || null,
        quantity: req.body.quantity,
        unit: req.body.unit || 'ea',
        min_stock: req.body.min_stock || 0,
        location: req.body.location || null,
        unit_cost: req.body.unit_cost || null,
        notes: req.body.notes || null,
      });

      res.status(201).json({ item, message: 'Inventory item created.' });
    } catch (err) {
      next(err);
    }
  }
);

// ── UPDATE ITEM ───────────────────────────────────────────────

/**
 * PATCH /api/inventory/:id
 * Update inventory item details
 */
router.patch(
  '/:id',
  authorize('inventory:update'),
  [
    param('id').isUUID(),
    body('item_name').optional().trim(),
    body('category').optional().trim(),
    body('sku').optional().trim(),
    body('quantity').optional().isFloat({ min: 0 }),
    body('unit').optional().trim(),
    body('min_stock').optional().isFloat({ min: 0 }),
    body('location').optional().trim(),
    body('unit_cost').optional().isFloat({ min: 0 }),
    body('notes').optional().trim(),
    body('active').optional().isBoolean(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const existing = await Inventory.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Item not found' });

      const allowedFields = [
        'item_name', 'category', 'sku', 'quantity', 'unit',
        'min_stock', 'location', 'unit_cost', 'notes', 'active',
      ];
      const updates = {};
      for (const f of allowedFields) {
        if (req.body[f] !== undefined) updates[f] = req.body[f];
      }

      const item = await Inventory.update(req.params.id, updates);

      // Check if item fell below min stock after update
      if (item.min_stock > 0 && item.quantity <= item.min_stock) {
        NotificationService.notifyLowStock(item).catch(() => {});
      }

      res.json({ item, message: 'Inventory item updated.' });
    } catch (err) {
      next(err);
    }
  }
);

// ── ALLOCATE TO PROJECT ───────────────────────────────────────

/**
 * POST /api/inventory/:id/allocate
 * Allocate inventory to a project (Shop Manager pulls materials)
 */
router.post(
  '/:id/allocate',
  authorize('inventory:allocate'),
  [
    param('id').isUUID(),
    body('project_id').isUUID().withMessage('Project ID required'),
    body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
    body('notes').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      // Verify project exists
      const project = await db('projects').where({ id: req.body.project_id }).first();
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const result = await Inventory.allocateToProject(
        req.params.id,
        req.body.project_id,
        req.body.quantity,
        req.user.id,
        req.body.notes
      );

      // Check if low stock after allocation
      if (result.item.min_stock > 0 && result.item.quantity <= result.item.min_stock) {
        NotificationService.notifyLowStock(result.item).catch(() => {});
      }

      res.json({
        item: result.item,
        allocation: result.allocation,
        message: `${req.body.quantity} ${result.item.unit} of "${result.item.item_name}" allocated to project "${project.name}".`,
      });
    } catch (err) {
      if (err.message.includes('Insufficient stock')) {
        return res.status(400).json({ error: 'Insufficient stock', message: err.message });
      }
      next(err);
    }
  }
);

// ── RECEIVE STOCK ─────────────────────────────────────────────

/**
 * POST /api/inventory/:id/receive
 * Receive stock (e.g., from a PO delivery)
 */
router.post(
  '/:id/receive',
  authorize('inventory:update'),
  [
    param('id').isUUID(),
    body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
    body('po_id').optional().isUUID(),
    body('notes').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const existing = await Inventory.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Item not found' });

      const item = await Inventory.receiveStock(
        req.params.id,
        req.body.quantity,
        req.body.po_id,
        req.user.id
      );

      // If linked to a PO, update PO status
      if (req.body.po_id) {
        const po = await db('purchase_orders').where({ id: req.body.po_id }).first();
        if (po && po.status !== 'received') {
          await db('purchase_orders')
            .where({ id: req.body.po_id })
            .update({ status: 'received', updated_at: db.fn.now() });
        }
      }

      res.json({
        item,
        message: `Received ${req.body.quantity} ${item.unit} of "${item.item_name}". New quantity: ${item.quantity}.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── ALLOCATION HISTORY ────────────────────────────────────────

/**
 * GET /api/inventory/allocations
 * View allocation history (filterable by item or project)
 */
router.get(
  '/allocations/history',
  authorize('inventory:read'),
  async (req, res, next) => {
    try {
      const allocations = await Inventory.getAllocations({
        inventory_id: req.query.inventory_id,
        project_id: req.query.project_id,
        limit: parseInt(req.query.limit, 10) || 50,
        offset: parseInt(req.query.offset, 10) || 0,
      });

      res.json({ allocations });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
