/**
 * Contact Model
 *
 * Contacts are people at companies (customers or vendors after the
 * 20260517 merge). Company is stored on the contact record itself,
 * not a separate table.
 *
 * Filename + export name kept as "CustomerContact" for now — table
 * renamed to `contacts` in 20260518_007 but the JS symbol churn is a
 * Pass-2 cleanup. Routes import the same name, so changing the file
 * is independent from the table rename.
 */

const db = require('../config/database');

const CustomerContact = {
  async findAll({ customer_id, search, active, limit = 100, offset = 0 } = {}) {
    const query = db('contacts')
      .select('contacts.*', 'customers.name as customer_name')
      .leftJoin('customers', 'contacts.customer_id', 'customers.id')
      .orderBy('contacts.name', 'asc')
      .limit(limit)
      .offset(offset);

    if (customer_id) query.where('contacts.customer_id', customer_id);
    if (active !== undefined) query.where('contacts.active', active);
    if (search) query.where(function () {
      this.where('contacts.name', 'ilike', `%${search}%`)
        .orWhere('contacts.email', 'ilike', `%${search}%`)
        .orWhere('contacts.company', 'ilike', `%${search}%`);
    });

    const contacts = await query;
    const [{ count }] = await db('contacts').count('* as count');
    return { contacts, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('contacts')
      .select('contacts.*', 'customers.name as customer_name')
      .leftJoin('customers', 'contacts.customer_id', 'customers.id')
      .where('contacts.id', id)
      .first();
  },

  async create(data) {
    const [contact] = await db('contacts').insert(data).returning('*');
    return contact;
  },

  async update(id, data) {
    const [contact] = await db('contacts')
      .where({ id })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return contact;
  },
};

module.exports = CustomerContact;
