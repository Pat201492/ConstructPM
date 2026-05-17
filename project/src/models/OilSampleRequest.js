const db = require('../config/database');

const OilSampleRequest = {
  async create(data) {
    const [record] = await db('oil_sample_requests').insert(data).returning('*');
    return record;
  },

  async findById(id) {
    return db('oil_sample_requests')
      .select('oil_sample_requests.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as foreman_name"))
      .leftJoin('projects', 'oil_sample_requests.project_id', 'projects.id')
      .leftJoin('users', 'oil_sample_requests.foreman_id', 'users.id')
      .where('oil_sample_requests.id', id).first();
  },

  async findAll({ project_id, foreman_id, status, equipment_id, location, limit = 100, offset = 0 } = {}) {
    const query = db('oil_sample_requests')
      .select('oil_sample_requests.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as foreman_name"))
      .leftJoin('projects', 'oil_sample_requests.project_id', 'projects.id')
      .leftJoin('users', 'oil_sample_requests.foreman_id', 'users.id')
      .orderBy('oil_sample_requests.submitted_at', 'desc')
      .limit(limit).offset(offset);

    if (project_id) query.where('oil_sample_requests.project_id', project_id);
    if (foreman_id) query.where('oil_sample_requests.foreman_id', foreman_id);
    if (status) query.where('oil_sample_requests.status', status);
    // Live search by equipment ID (customer's equipment number)
    if (equipment_id) query.whereILike('oil_sample_requests.equipment_id_field', `%${equipment_id}%`);
    if (location) query.whereILike('oil_sample_requests.equipment_location', `%${location}%`);

    return query;
  },

  async pendingCount({ project_id, pm_id } = {}) {
    const query = db('oil_sample_requests')
      .where('status', 'pending_return')
      .count('* as cnt');

    if (project_id) query.where('project_id', project_id);
    if (pm_id) {
      query.whereIn('project_id', db('projects').select('id').where('pm_id', pm_id));
    }
    const [{ cnt }] = await query;
    return parseInt(cnt);
  },

  async confirmData(id, foremanId) {
    const [record] = await db('oil_sample_requests')
      .where({ id })
      .update({ status: 'pending_return', confirmed_by_foreman_at: db.fn.now() })
      .returning('*');
    return record;
  },

  async confirmReturned(id, userId) {
    const [record] = await db('oil_sample_requests')
      .where({ id })
      .update({ status: 'returned', sample_returned_at: db.fn.now(), confirmed_returned_by: userId })
      .returning('*');
    return record;
  },

  async snoozeReminder(id, snoozeDays) {
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + snoozeDays);
    const [record] = await db('oil_sample_requests')
      .where({ id })
      .update({ snoozed_until: snoozeUntil.toISOString() })
      .returning('*');
    return record;
  },

  async getOverdueForReminder(reminderDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - reminderDays);

    return db('oil_sample_requests')
      .select('oil_sample_requests.*', 'projects.name as project_name', 'projects.pm_id')
      .leftJoin('projects', 'oil_sample_requests.project_id', 'projects.id')
      .where('oil_sample_requests.status', 'pending_return')
      .where('oil_sample_requests.submitted_at', '<', cutoff.toISOString())
      .where(function () {
        this.whereNull('oil_sample_requests.snoozed_until')
          .orWhere('oil_sample_requests.snoozed_until', '<', new Date().toISOString());
      });
  },

  async update(id, data) {
    data.updated_at = db.fn.now();
    const [record] = await db('oil_sample_requests').where('id', id).update(data).returning('*');
    return record;
  },

  async delete(id) {
    return db('oil_sample_requests').where('id', id).delete();
  },
};

module.exports = OilSampleRequest;
