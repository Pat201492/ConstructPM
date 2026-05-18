const db = require('../config/database');

// After the merge migration, vendors and customers share one table.
// This model keeps a vendor-shaped API so PO routes / Admin Vendors page
// don't have to be rewritten: it reads/writes the customers table and
// translates fields (street -> billing_street, etc.). Contact info from
// the legacy vendor form is stored as a contacts row.
const Vendor = {
  async findAll({ active = true, search, limit = 200, offset = 0 } = {}) {
    let q = db('customers').orderBy('name', 'asc');
    if (active !== undefined) q = q.where('active', active);
    if (search) q = q.whereILike('name', `%${search}%`);
    const total = await q.clone().clearSelect().clearOrder().count('* as n').first();
    const rows = await q.limit(limit).offset(offset);
    return { vendors: rows.map(toVendorShape), total: parseInt(total.n, 10) };
  },

  async findById(id) {
    const row = await db('customers').where({ id }).first();
    return toVendorShape(row);
  },

  async create(data) {
    const insertCustomer = {
      name: data.name,
      billing_street: data.street || null,
      billing_town: data.town || null,
      billing_state: data.state || null,
      billing_zip: data.zip || null,
      notes: data.notes || null,
      active: data.active !== false,
    };
    const [customer] = await db('customers').insert(insertCustomer).returning('*');

    if (data.contact_name || data.email || data.phone) {
      await db('contacts').insert({
        customer_id: customer.id,
        name: (data.contact_name || data.name || '').slice(0, 255),
        email: data.email ? String(data.email).slice(0, 255) : null,
        phone: data.phone ? String(data.phone).slice(0, 20) : null,
        company: data.name,
        active: true,
      });
    }
    return toVendorShape(customer);
  },

  async update(id, data) {
    const fieldMap = {
      name: 'name',
      street: 'billing_street',
      town: 'billing_town',
      state: 'billing_state',
      zip: 'billing_zip',
      notes: 'notes',
      active: 'active',
    };
    const update = {};
    for (const [k, col] of Object.entries(fieldMap)) {
      if (data[k] !== undefined) update[col] = data[k];
    }
    if (Object.keys(update).length === 0) {
      const row = await db('customers').where({ id }).first();
      return toVendorShape(row);
    }
    update.updated_at = db.fn.now();
    const [row] = await db('customers').where({ id }).update(update).returning('*');
    return toVendorShape(row);
  },

  async delete(id) {
    // Soft delete only — a customer row may still be referenced by bids/projects.
    return db('customers').where({ id }).update({ active: false, updated_at: db.fn.now() });
  },
};

function toVendorShape(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    contact_name: null,
    email: null,
    phone: null,
    street: c.billing_street || null,
    town: c.billing_town || null,
    state: c.billing_state || null,
    zip: c.billing_zip || null,
    notes: c.notes || null,
    active: c.active,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

module.exports = Vendor;
