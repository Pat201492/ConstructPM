/**
 * Customer Contact Model
 * 
 * Contacts are people at customer companies.
 * Company is stored on the contact record, NOT a separate table.
 * Auto-saved when PM types a new contact during bid creation.
 */

const db = require('../config/database');

const CustomerContact = {
  async findAll({ customer_id, search, active, limit = 100, offset = 0 } = {}) {
    const query = db('customer_contacts')
      .select('customer_contacts.*', 'customers.name as customer_name')
      .leftJoin('customers', 'customer_contacts.customer_id', 'customers.id')
      .orderBy('customer_contacts.name', 'asc')
      .limit(limit)
      .offset(offset);

    if (customer_id) query.where('customer_contacts.customer_id', customer_id);
    if (active !== undefined) query.where('customer_contacts.active', active);
    if (search) query.where(function () {
      this.where('customer_contacts.name', 'ilike', `%${search}%`)
        .orWhere('customer_contacts.email', 'ilike', `%${search}%`)
        .orWhere('customer_contacts.company', 'ilike', `%${search}%`);
    });

    const contacts = await query;
    const [{ count }] = await db('customer_contacts').count('* as count');
    return { contacts, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('customer_contacts')
      .select('customer_contacts.*', 'customers.name as customer_name')
      .leftJoin('customers', 'customer_contacts.customer_id', 'customers.id')
      .where('customer_contacts.id', id)
      .first();
  },

  async create(data) {
    const [contact] = await db('customer_contacts').insert(data).returning('*');
    return contact;
  },

  async update(id, data) {
    const [contact] = await db('customer_contacts')
      .where({ id })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return contact;
  },
};

module.exports = CustomerContact;
