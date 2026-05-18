/**
 * Customer Model
 * 
 * Customers are companies being billed.
 * Billing address is stored here (separate from job site location).
 * Contact info moved to contacts table.
 * Display address auto-generated: street, town, state (no zip).
 */

const db = require('../config/database');

const Customer = {
  async findAll({ search, active, limit = 50, offset = 0 } = {}) {
    const query = db('customers')
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    if (active !== undefined) query.where('active', active);
    if (search) query.where(function () {
      this.where('name', 'ilike', `%${search}%`)
        .orWhere('billing_display_address', 'ilike', `%${search}%`);
    });

    const customers = await query;
    const [{ count }] = await db('customers').count('* as count');
    return { customers, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('customers').where({ id }).first();
  },

  async create(data) {
    // Auto-generate display address
    data.billing_display_address = this._buildDisplayAddress(data);

    const [customer] = await db('customers').insert(data).returning('*');
    return customer;
  },

  async update(id, data) {
    if (data.billing_street || data.billing_town || data.billing_state) {
      const existing = await this.findById(id);
      const merged = { ...existing, ...data };
      data.billing_display_address = this._buildDisplayAddress(merged);
    }

    const [customer] = await db('customers')
      .where({ id })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return customer;
  },

  async deactivate(id) {
    return this.update(id, { active: false });
  },

  _buildDisplayAddress({ billing_street, billing_town, billing_state, billing_zip }) {
    const cityStateZip = [billing_town, billing_state].filter(Boolean).join(', ');
    const tail = [cityStateZip, billing_zip].filter(Boolean).join(' ');
    return [billing_street, tail].filter(Boolean).join(', ');
  },
};

module.exports = Customer;
