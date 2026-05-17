const db = require('../config/database');

const FormTemplate = {
  async create(data) {
    const [template] = await db('form_templates').insert(data).returning('*');
    return template;
  },

  async findById(id) {
    return db('form_templates').where('id', id).first();
  },

  async findActive(formType) {
    return db('form_templates').where({ form_type: formType, active: true }).first();
  },

  async findAll({ form_type, active } = {}) {
    const query = db('form_templates')
      .select('form_templates.*', db.raw("users.first_name || ' ' || users.last_name as created_by_name"))
      .leftJoin('users', 'form_templates.created_by', 'users.id')
      .orderBy('form_templates.created_at', 'desc');
    if (form_type) query.where('form_templates.form_type', form_type);
    if (active !== undefined) query.where('form_templates.active', active);
    return query;
  },

  async updateFieldMap(id, fieldMap) {
    const [template] = await db('form_templates')
      .where('id', id)
      .update({ field_map: JSON.stringify(fieldMap), updated_at: db.fn.now() })
      .returning('*');
    return template;
  },

  async activate(id) {
    const template = await this.findById(id);
    if (!template) throw new Error('Template not found');
    if (!template.field_map) throw new Error('Template has no field map — review fields first');

    // Deactivate all other templates of the same form_type
    await db('form_templates')
      .where({ form_type: template.form_type, active: true })
      .whereNot('id', id)
      .update({ active: false });

    // Activate this one
    const [activated] = await db('form_templates')
      .where('id', id)
      .update({ active: true, activated_at: db.fn.now() })
      .returning('*');
    return activated;
  },

  async deactivate(id) {
    const [template] = await db('form_templates')
      .where('id', id)
      .update({ active: false })
      .returning('*');
    return template;
  },

  async delete(id) {
    const template = await this.findById(id);
    if (template?.active) throw new Error('Cannot delete an active template — deactivate first');
    return db('form_templates').where('id', id).delete();
  },
};

module.exports = FormTemplate;
