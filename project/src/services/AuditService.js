/**
 * Audit Trail Service
 * 
 * Logs every data modification across the system.
 * Call AuditService.log() from models/routes after writes.
 * 
 * Stored: table_name, record_id, field_changed, old_value, new_value,
 *         change_type (create/update/delete/confirm/reject), changed_by, changed_at
 * 
 * Viewable in a separate "Audit Log" tab, admin-only, filterable.
 */

const db = require('../config/database');

const AuditService = {
  /**
   * Log a single field change.
   */
  async log({ tableName, recordId, field, oldValue, newValue, changeType, changedBy }) {
    try {
      await db('audit_log').insert({
        table_name: tableName,
        record_id: recordId,
        field_changed: field || null,
        old_value: oldValue !== undefined ? String(oldValue) : null,
        new_value: newValue !== undefined ? String(newValue) : null,
        change_type: changeType,
        changed_by: changedBy || null,
      });
    } catch (err) {
      console.error('[Audit] Log error:', err.message);
    }
  },

  /**
   * Log a record creation (all fields).
   */
  async logCreate(tableName, record, changedBy) {
    try {
      await db('audit_log').insert({
        table_name: tableName,
        record_id: record.id,
        field_changed: null,
        old_value: null,
        new_value: JSON.stringify(record).substring(0, 5000),
        change_type: 'create',
        changed_by: changedBy || null,
      });
    } catch (err) {
      console.error('[Audit] LogCreate error:', err.message);
    }
  },

  /**
   * Log a record update (diff old vs new).
   */
  async logUpdate(tableName, recordId, oldRecord, newRecord, changedBy) {
    const entries = [];
    for (const key of Object.keys(newRecord)) {
      if (key === 'updated_at' || key === 'created_at') continue;
      const oldVal = oldRecord[key];
      const newVal = newRecord[key];
      if (String(oldVal) !== String(newVal)) {
        entries.push({
          table_name: tableName,
          record_id: recordId,
          field_changed: key,
          old_value: oldVal !== undefined ? String(oldVal) : null,
          new_value: newVal !== undefined ? String(newVal) : null,
          change_type: 'update',
          changed_by: changedBy || null,
        });
      }
    }
    if (entries.length > 0) {
      try {
        await db('audit_log').insert(entries);
      } catch (err) {
        console.error('[Audit] LogUpdate error:', err.message);
      }
    }
  },

  /**
   * Log a deletion.
   */
  async logDelete(tableName, recordId, changedBy) {
    return this.log({ tableName, recordId, changeType: 'delete', changedBy });
  },

  /**
   * Query audit log with filters.
   */
  async query({ table_name, record_id, changed_by, change_type, start_date, end_date, limit = 100, offset = 0 } = {}) {
    const query = db('audit_log')
      .select('audit_log.*', db.raw("users.first_name || ' ' || users.last_name as changed_by_name"))
      .leftJoin('users', 'audit_log.changed_by', 'users.id')
      .orderBy('audit_log.changed_at', 'desc')
      .limit(limit).offset(offset);

    if (table_name) query.where('audit_log.table_name', table_name);
    if (record_id) query.where('audit_log.record_id', record_id);
    if (changed_by) query.where('audit_log.changed_by', changed_by);
    if (change_type) query.where('audit_log.change_type', change_type);
    if (start_date) query.where('audit_log.changed_at', '>=', start_date);
    if (end_date) query.where('audit_log.changed_at', '<=', end_date);

    const entries = await query;
    const countQ = db('audit_log').count('* as count');
    if (table_name) countQ.where('table_name', table_name);
    if (changed_by) countQ.where('changed_by', changed_by);
    const [{ count }] = await countQ;

    return { entries, total: parseInt(count, 10) };
  },

  /**
   * Get distinct table names in the audit log (for filter dropdown).
   */
  async getTables() {
    const rows = await db('audit_log').distinct('table_name').orderBy('table_name');
    return rows.map(r => r.table_name);
  },
};

module.exports = AuditService;
