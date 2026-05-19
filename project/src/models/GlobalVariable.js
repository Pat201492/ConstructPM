/**
 * Global Variable Model
 * 
 * Key/value configuration store.
 * Admin-managed via web interface.
 * Seeded with defaults in migration.
 */

const db = require('../config/database');

const GlobalVariable = {
  async getAll() {
    return db('global_variables').orderBy('key', 'asc');
  },

  async get(key) {
    const row = await db('global_variables').where({ key }).first();
    return row ? row.value : null;
  },

  async set(key, value, description = null) {
    const existing = await db('global_variables').where({ key }).first();
    if (existing) {
      const updates = { value, updated_at: db.fn.now() };
      if (description !== null) updates.description = description;
      const [row] = await db('global_variables').where({ key }).update(updates).returning('*');
      return row;
    }
    const [row] = await db('global_variables').insert({ key, value, description }).returning('*');
    return row;
  },

  async delete(key) {
    return db('global_variables').where({ key }).delete();
  },

  // Convenience getters for common variables
  async getDollarPerMile() {
    const val = await this.get('dollar_per_mile');
    return val ? parseFloat(val) : 0.67;
  },

  async getBidInactivityDays() {
    const val = await this.get('bid_inactivity_threshold_days');
    return val ? parseInt(val, 10) : 30;
  },

  async getSnoozeDays() {
    const val = await this.get('bid_snooze_duration_days');
    return val ? parseInt(val, 10) : 21;
  },

  async getTrackingWeekStart() {
    return (await this.get('tracking_week_start_day')) || 'Monday';
  },

  async getCertExpiryAlertDays() {
    const val = await this.get('cert_expiry_alert_days');
    return val ? parseInt(val, 10) : 30;
  },

  async getHomeLocation() {
    const [address, lat, lng] = await Promise.all([
      this.get('home_location_address'),
      this.get('home_location_lat'),
      this.get('home_location_lng'),
    ]);
    return {
      address: address || '',
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
    };
  },
};

module.exports = GlobalVariable;
