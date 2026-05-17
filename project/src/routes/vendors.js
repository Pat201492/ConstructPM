const express = require('express');
const { body, param, validationResult } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const Vendor = require('../models/Vendor');

const router = express.Router();
router.use(authenticate);

// GET /api/vendors — list (filter by active, search)
router.get('/', authorize('purchase_orders:read'), async (req, res, next) => {
  try {
    const result = await Vendor.findAll({
      active: req.query.active === 'false' ? false : (req.query.active === 'all' ? undefined : true),
      search: req.query.search,
      limit: parseInt(req.query.limit, 10) || 200,
      offset: parseInt(req.query.offset, 10) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/vendors/:id
router.get('/:id', authorize('purchase_orders:read'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
  } catch (err) { next(err); }
});

// POST /api/vendors — create
router.post('/',
  authorize('purchase_orders:create'),
  [body('name').trim().notEmpty().withMessage('Vendor name is required')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation error', details: errors.array() });
      const vendor = await Vendor.create(req.body);
      res.status(201).json(vendor);
    } catch (err) { next(err); }
  }
);

// PATCH /api/vendors/:id
router.patch('/:id', authorize('purchase_orders:create'), [param('id').isUUID()], async (req, res, next) => {
  try {
    const vendor = await Vendor.update(req.params.id, req.body);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
  } catch (err) { next(err); }
});

// DELETE /api/vendors/:id (soft — sets active=false)
router.delete('/:id', authorize('purchase_orders:create'), [param('id').isUUID()], async (req, res, next) => {
  try {
    await Vendor.update(req.params.id, { active: false });
    res.json({ deleted: true, soft: true });
  } catch (err) { next(err); }
});

module.exports = router;
