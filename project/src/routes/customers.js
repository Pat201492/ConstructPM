/**
 * Customer Routes
 * 
 * Customers are companies with billing addresses.
 * Contact info is in contacts table (separate).
 * Auto-saved when PM types a new customer during bid creation.
 */

const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const Customer = require('../models/Customer');

const router = express.Router();
router.use(authenticate);

// GET /api/customers — list all customers
router.get('/', authorize('bids:read'), async (req, res, next) => {
  try {
    const { search, active, limit, offset } = req.query;
    const result = await Customer.findAll({
      search,
      active: active !== undefined ? active === 'true' : undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/customers/:id
router.get('/:id', authorize('bids:read'), async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) { next(err); }
});

// POST /api/customers — create (also used by auto-save during bid creation)
router.post('/',
  authorize('bids:create'),
  [body('name').trim().notEmpty().withMessage('Customer name is required')],
  async (req, res, next) => {
    try {
      const { name, billing_street, billing_town, billing_state, billing_zip, notes } = req.body;
      const customer = await Customer.create({
        name, billing_street, billing_town, billing_state, billing_zip, notes,
      });
      res.status(201).json(customer);
    } catch (err) { next(err); }
  }
);

// PATCH /api/customers/:id
router.patch('/:id', authorize('bids:create'), async (req, res, next) => {
  try {
    const allowed = ['name', 'billing_street', 'billing_town', 'billing_state', 'billing_zip', 'notes', 'active'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const customer = await Customer.update(req.params.id, data);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) { next(err); }
});

module.exports = router;
