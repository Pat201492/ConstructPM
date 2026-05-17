const db = require('../config/database');

const FieldNote = {
  async create({ project_id, foreman_id, note_date, note_text, author_timezone }) {
    const [note] = await db('field_notes').insert({
      project_id, foreman_id, note_date, note_text,
      author_timezone: author_timezone || null,
    }).returning('*');
    return note;
  },

  async findById(id) {
    return db('field_notes').where('id', id).first();
  },

  async findAll({ project_id, foreman_id, start_date, end_date, limit = 100, offset = 0 } = {}) {
    const query = db('field_notes')
      .select('field_notes.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as foreman_name"))
      .leftJoin('projects', 'field_notes.project_id', 'projects.id')
      .leftJoin('users', 'field_notes.foreman_id', 'users.id')
      .orderBy('field_notes.note_date', 'desc')
      .limit(limit).offset(offset);

    if (project_id) query.where('field_notes.project_id', project_id);
    if (foreman_id) query.where('field_notes.foreman_id', foreman_id);
    if (start_date) query.where('field_notes.note_date', '>=', start_date);
    if (end_date) query.where('field_notes.note_date', '<=', end_date);

    return query;
  },

  async update(id, data) {
    data.updated_at = db.fn.now();
    const [note] = await db('field_notes').where('id', id).update(data).returning('*');
    return note;
  },

  async delete(id) {
    return db('field_notes').where('id', id).delete();
  },
};

module.exports = FieldNote;
