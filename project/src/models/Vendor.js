const db = require('../config/database');

const Vendor = {
  async findAll({ active = true, search, limit = 200, offset = 0 } = {}) {
    let q = db('vendors').orderBy('name', 'asc');
    if (active !== undefined) q = q.where('active', active);
    if (search) q = q.whereILike('name', `%${search}%`);
    const total = await q.clone().clearSelect().clearOrder().count('* as n').first();
    const rows = await q.limit(limit).offset(offset);
    return { vendors: rows, total: parseInt(total.n, 10) };
  },

  async findById(id) {
    return db('vendors').where({ id }).first();
  },

  async create(data) {
    const insert = {
      name: data.name,
      contact_name: data.contact_name || null,
      email: data.email || null,
      phone: data.phone || null,
      street: data.street || null,
      town: data.town || null,
      state: data.state || null,
      zip: data.zip || null,
      notes: data.notes || null,
      active: data.active !== false,
    };
    const [vendor] = await db('vendors').insert(insert).returning('*');
    return vendor;
  },

  async update(id, data) {
    const allowed = ['name', 'contact_name', 'email', 'phone', 'street', 'town', 'state', 'zip', 'notes', 'active'];
    const update = {};
    for (const k of allowed) if (data[k] !== undefined) update[k] = data[k];
    update.updated_at = db.fn.now();
    const [vendor] = await db('vendors').where({ id }).update(update).returning('*');
    return vendor;
  },

  async delete(id) {
    return db('vendors').where({ id }).delete();
  },
};

module.exports = Vendor;
