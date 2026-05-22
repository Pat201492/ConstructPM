const db = require('../config/database');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

// Fields safe to return in API responses (no password_hash)
const SAFE_FIELDS = [
  'id', 'email', 'first_name', 'last_name', 'initials', 'role',
  'pm_code',
  'phone', 'active', 'notification_preferences',
  'tab_overrides', 'access_config', 'default_markup_pct',
  'on_schedule',
  'is_superadmin',
  'must_change_password',
  'last_login_at', 'created_at', 'updated_at',
];

const User = {
  /**
   * Find all users (with optional filters)
   */
  async findAll({ role, active, search, limit = 50, offset = 0 } = {}) {
    const query = db('users').select(SAFE_FIELDS).orderBy('last_name', 'asc');

    if (role) query.where('role', role);
    if (typeof active === 'boolean') query.where('active', active);
    if (search) {
      query.where(function () {
        this.whereILike('first_name', `%${search}%`)
          .orWhereILike('last_name', `%${search}%`)
          .orWhereILike('email', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
    const [users, countResult] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery,
    ]);

    return { users, total: parseInt(countResult.total, 10) };
  },

  /**
   * Find user by ID
   */
  async findById(id) {
    return db('users').select(SAFE_FIELDS).where({ id }).first();
  },

  /**
   * Find user by email (includes password_hash for auth)
   */
  async findByEmail(email) {
    return db('users').where({ email: email.toLowerCase() }).first();
  },

  /**
   * Create a new user
   */
  async create({ email, password, first_name, last_name, initials, role, phone, default_markup_pct, pm_code, on_schedule }) {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const [user] = await db('users')
      .insert({
        email: email.toLowerCase(),
        password_hash,
        first_name,
        last_name,
        initials: initials || null,
        pm_code: pm_code || null,
        role: role || 'field_staff',
        phone,
        default_markup_pct: default_markup_pct != null ? default_markup_pct : 15,
        on_schedule: on_schedule === true,
      })
      .returning(SAFE_FIELDS);

    return user;
  },

  /**
   * Update user fields
   */
  async update(id, fields) {
    // If password is being changed, hash it
    if (fields.password) {
      fields.password_hash = await bcrypt.hash(fields.password, SALT_ROUNDS);
      delete fields.password;
    }

    // Prevent updating sensitive fields directly
    delete fields.id;
    delete fields.created_at;

    fields.updated_at = db.fn.now();

    const [user] = await db('users')
      .where({ id })
      .update(fields)
      .returning(SAFE_FIELDS);

    return user;
  },

  /**
   * Soft-deactivate a user
   */
  async deactivate(id) {
    return this.update(id, { active: false });
  },

  /**
   * Hard delete (use sparingly)
   */
  async delete(id) {
    return db('users').where({ id }).del();
  },

  /**
   * Verify password against stored hash
   */
  async verifyPassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
  },

  /**
   * Update last_login_at timestamp
   */
  async recordLogin(id) {
    return db('users').where({ id }).update({ last_login_at: db.fn.now() });
  },

  /**
   * Update notification preferences
   */
  async updateNotificationPrefs(id, prefs) {
    const [user] = await db('users')
      .where({ id })
      .update({
        notification_preferences: JSON.stringify(prefs),
        updated_at: db.fn.now(),
      })
      .returning(SAFE_FIELDS);

    return user;
  },
};

module.exports = User;
