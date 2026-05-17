/**
 * Customer Contact Routes
 * 
 * Contacts are people at customer companies.
 * Auto-saved when PM types a new contact during bid creation.
 */

const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const CustomerContact = require('../models/CustomerContact');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);

// Generate a contact_code: initials from name + last 3 phone digits.
// Pat's scheme — hard to collide, easy to eyeball. On collision we add
// a numeric suffix so the unique index is always satisfiable, but if a
// caller passes an EXPLICIT contact_code that already exists we reject
// (so manual entry in any add-contact UI gets a clear "must be unique"
// error rather than a silent suffix).
async function buildContactCode(name, phone) {
  const initials = String(name || 'XX')
    .split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'XX';
  const digits = String(phone || '').replace(/\D/g, '');
  const last3 = digits ? digits.slice(-3) : '000';
  let base = `${initials}${last3}`;
  let code = base;
  let n = 1;
  // Loop until we find a free code. Bounded — construction firms have
  // hundreds of contacts, not millions, so this terminates fast.
  // eslint-disable-next-line no-await-in-loop
  while (await db('customer_contacts').where('contact_code', code).first()) {
    code = `${base}-${n++}`;
  }
  return code;
}

// GET /api/contacts — list all contacts (optionally filter by customer)
router.get('/', authorize('bids:read'), async (req, res, next) => {
  try {
    const { customer_id, search, active, limit, offset } = req.query;
    const result = await CustomerContact.findAll({
      customer_id, search,
      active: active !== undefined ? active === 'true' : undefined,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/contacts/:id
router.get('/:id', authorize('bids:read'), async (req, res, next) => {
  try {
    const contact = await CustomerContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (err) { next(err); }
});

// POST /api/contacts — create (also used by auto-save during bid creation)
router.post('/',
  authorize('bids:create'),
  [body('name').trim().notEmpty().withMessage('Name is required')],
  async (req, res, next) => {
    try {
      const { name, email, phone, company, customer_id, contact_code } = req.body;

      let code;
      if (contact_code && String(contact_code).trim()) {
        // Explicit code supplied — must be globally unique. Hard reject
        // so any add-contact UI surfaces "NO, it has to be unique".
        const dupe = await db('customer_contacts')
          .where('contact_code', String(contact_code).trim()).first();
        if (dupe) {
          return res.status(409).json({
            error: `Contact ID "${String(contact_code).trim()}" is already in use. Contact IDs must be unique — choose a different one.`,
          });
        }
        code = String(contact_code).trim();
      } else {
        code = await buildContactCode(name, phone);
      }

      const contact = await CustomerContact.create({
        name, email, phone, company, customer_id, contact_code: code,
      });
      res.status(201).json(contact);
    } catch (err) { next(err); }
  }
);

// PATCH /api/contacts/:id
router.patch('/:id', authorize('bids:create'), async (req, res, next) => {
  try {
    const allowed = ['name', 'email', 'phone', 'company', 'customer_id', 'active', 'contact_code'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    // If the code is being changed, enforce global uniqueness (excluding
    // this same row). Same hard-reject contract as create.
    if (data.contact_code !== undefined && String(data.contact_code).trim()) {
      const code = String(data.contact_code).trim();
      const dupe = await db('customer_contacts')
        .where('contact_code', code).whereNot('id', req.params.id).first();
      if (dupe) {
        return res.status(409).json({
          error: `Contact ID "${code}" is already in use. Contact IDs must be unique — choose a different one.`,
        });
      }
      data.contact_code = code;
    }
    const contact = await CustomerContact.update(req.params.id, data);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (err) { next(err); }
});

module.exports = router;
