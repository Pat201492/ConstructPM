const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const User = require('../models/User');
const AuthService = require('../services/AuthService');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { ROLES } = require('../config/roles');
const db = require('../config/database');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/users/pms
 * Lightweight PM list for bid-creation dropdowns.
 *
 * Why this exists: GET /api/users requires `users:read` (admin only). But
 * PMs and estimators creating bids legitimately need to pick a PM from a
 * dropdown. Rather than relax the broad endpoint, expose a narrow one that
 * returns only id + first/last name + active flag for users with role
 * 'project_manager'. No emails, no other PII.
 *
 * Open to: admin, project_manager, estimator (the bid-creating roles).
 * Anyone else gets 403.
 */
router.get('/pms', async (req, res, next) => {
  try {
    if (!['admin', 'project_manager', 'estimator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pms = await db('users')
      .select('id', 'first_name', 'last_name', 'active')
      .where('role', 'project_manager')
      .where('active', true)
      .orderBy('first_name');
    res.json({ users: pms });
  } catch (err) { next(err); }
});

/**
 * GET /api/users/on-schedule
 *
 * Returns active users marked on_schedule. The Scheduler tab calls this
 * to populate its worker picker — it shows up everywhere phase 2A's UI
 * needs to choose someone to assign to a project.
 *
 * Same minimal-fields shape as /pms (id + name + role + active) — no
 * emails or other PII for non-admins. Open to: admin, project_manager,
 * scheduler (the roles that need to read worker availability).
 */
router.get('/on-schedule', async (req, res, next) => {
  try {
    if (!['admin', 'project_manager', 'scheduler'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const workers = await db('users')
      .select('id', 'first_name', 'last_name', 'role', 'initials', 'active')
      .where('on_schedule', true)
      .where('active', true)
      .orderBy('first_name');
    res.json({ users: workers });
  } catch (err) { next(err); }
});

/**
 * GET /api/users/email-picker
 *
 * Narrow endpoint for the export-scheduler recipient picker (and any other
 * "pick a teammate to email" surface). Returns active users with email
 * present — id + first/last name + email. Open to roles that can see the
 * Exports tab: admin, project_manager, accounting.
 */
router.get('/email-picker', async (req, res, next) => {
  try {
    if (!['admin', 'project_manager', 'accounting'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const users = await db('users')
      .select('id', 'first_name', 'last_name', 'email')
      .where('active', true)
      .whereNotNull('email')
      .orderBy('first_name');
    res.json({ users });
  } catch (err) { next(err); }
});

/**
 * GET /api/users
 * List all users (Admin only, with filters)
 */
router.get(
  '/',
  authorize('users:read'),
  [
    query('role').optional().isIn(Object.values(ROLES)),
    query('active').optional().isBoolean(),
    query('search').optional().isString().trim(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const filters = {
        role: req.query.role,
        active: req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined,
        search: req.query.search,
        limit: req.query.limit || 50,
        offset: req.query.offset || 0,
      };

      const result = await User.findAll(filters);
      res.json({
        users: result.users,
        total: result.total,
        limit: filters.limit,
        offset: filters.offset,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/users/:id
 * Get a single user (Admin, or self)
 */
router.get(
  '/:id',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      // Allow users to view their own profile, admins can view anyone
      if (req.user.role !== ROLES.ADMIN && req.user.id !== req.params.id) {
        return res.status(403).json({ error: 'Forbidden', message: 'You can only view your own profile.' });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'Not found', message: 'User not found.' });
      }
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/users
 * Create a new user (Admin only)
 */
router.post(
  '/',
  authorize('users:create'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('first_name').notEmpty().trim().escape(),
    body('last_name').notEmpty().trim().escape(),
    body('initials').optional().trim(),
    body('pm_code').optional({ nullable: true, checkFalsy: true }).matches(/^[A-Z]$/).withMessage('PM code must be a single uppercase letter'),
    body('role').notEmpty(),
    body('phone').optional(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const { email, password, first_name, last_name, initials, role, phone, default_markup_pct, pm_code } = req.body;

      // on_schedule defaulting: if the request explicitly sets it, use that;
      // otherwise inherit from the role's on_schedule_default. This is what
      // makes "all field_staff are on-schedule by default" work without
      // admins remembering to tick the box on every new user.
      let on_schedule = req.body.on_schedule;
      if (on_schedule === undefined) {
        const roleConfig = await db('role_configurations').where('role_name', role).first();
        on_schedule = roleConfig?.on_schedule_default || false;
      }

      try {
        const user = await User.create({ email, password, first_name, last_name, initials, role, phone, default_markup_pct, pm_code, on_schedule });
        res.status(201).json({ user, message: 'User created successfully.' });
      } catch (err) {
        // Friendly error on pm_code uniqueness violation
        if (err.code === '23505' && /pm_code/.test(err.detail || '')) {
          return res.status(409).json({ error: `PM code "${pm_code}" is already in use by another user.` });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/users/:id
 * Update a user (Admin can update anyone, users can update own profile)
 */
router.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('email').optional().isEmail().normalizeEmail(),
    body('first_name').optional().notEmpty().trim().escape(),
    body('last_name').optional().notEmpty().trim().escape(),
    body('initials').optional().trim(),
    body('pm_code').optional({ nullable: true }).custom((v) => v === null || v === '' || /^[A-Z]$/.test(v))
      .withMessage('PM code must be a single uppercase letter or null'),
    body('phone').optional(),
    body('role').optional(),
    body('active').optional().isBoolean(),
    body('password').optional().isLength({ min: 8 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const isSelf = req.user.id === req.params.id;
      const isAdmin = req.user.role === ROLES.ADMIN;

      if (!isAdmin && !isSelf) {
        return res.status(403).json({ error: 'Forbidden', message: 'You can only update your own profile.' });
      }

      // Validate role against database if changing
      if (req.body.role && isAdmin) {
        const validRole = await db('role_configurations').where('role_name', req.body.role).first();
        if (!validRole) return res.status(400).json({ error: 'Invalid role: ' + req.body.role });
      }

      const allowedFields = ['email', 'first_name', 'last_name', 'initials', 'phone', 'password', 'default_markup_pct'];
      if (isAdmin) {
        allowedFields.push('role', 'active', 'pm_code', 'on_schedule');
      }

      const updates = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No updates', message: 'No valid fields to update.' });
      }

      let user;
      try {
        user = await User.update(req.params.id, updates);
      } catch (err) {
        if (err.code === '23505' && /pm_code/.test(err.detail || '')) {
          return res.status(409).json({ error: `PM code "${updates.pm_code}" is already in use by another user.` });
        }
        throw err;
      }
      if (!user) {
        return res.status(404).json({ error: 'Not found', message: 'User not found.' });
      }

      // If password was changed, revoke all refresh tokens
      if (updates.password) {
        await AuthService.revokeAllUserTokens(req.params.id);
      }

      res.json({ user, message: 'User updated successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/users/:id
 * Deactivate a user (Admin only; soft-delete)
 */
router.delete(
  '/:id',
  authorize('users:delete'),
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      if (req.user.id === req.params.id) {
        return res.status(400).json({ error: 'Cannot deactivate self', message: 'You cannot deactivate your own account.' });
      }

      const user = await User.deactivate(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'Not found', message: 'User not found.' });
      }

      // Revoke all their sessions
      await AuthService.revokeAllUserTokens(req.params.id);

      res.json({ user, message: 'User deactivated successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/users/:id/notifications
 * Update notification preferences (self or admin)
 */
router.patch(
  '/:id/notifications',
  [
    param('id').isUUID(),
    body('in_app').optional().isBoolean(),
    body('email').optional().isBoolean(),
    body('push').optional().isBoolean(),
  ],
  async (req, res, next) => {
    try {
      if (req.user.role !== ROLES.ADMIN && req.user.id !== req.params.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const prefs = {};
      if (req.body.in_app !== undefined) prefs.in_app = req.body.in_app;
      if (req.body.email !== undefined) prefs.email = req.body.email;
      if (req.body.push !== undefined) prefs.push = req.body.push;

      const user = await User.updateNotificationPrefs(req.params.id, prefs);
      res.json({ user, message: 'Notification preferences updated.' });
    } catch (err) {
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// USER TEMPLATES (PM + Admin can upload their own bid templates)
// ═══════════════════════════════════════════════════════════

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const templateUpload = multer({ dest: '/tmp/user_template_uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/users/me/templates — list current user's templates
router.get('/me/templates', async (req, res, next) => {
  try {
    const templates = await db('bid_templates')
      .where('pm_id', req.user.id)
      .orderBy('created_at', 'desc');
    res.json({ templates });
  } catch (err) { next(err); }
});

// POST /api/users/me/templates — upload a template (PM + Admin only)
router.post('/me/templates', templateUpload.single('template'), async (req, res, next) => {
  try {
    if (!['admin', 'project_manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PMs and admins can upload bid templates' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.docx') return res.status(400).json({ error: 'Template must be a .docx file' });

    // Store template
    const StorageService = require('../services/StorageService');
    const destPath = `templates/bid/${req.user.id}_${Date.now()}${ext}`;
    await StorageService.putFile(destPath, req.file.path);

    // Clean up temp
    try { fs.unlinkSync(req.file.path); } catch {}

    const [template] = await db('bid_templates').insert({
      pm_id: req.user.id,
      template_type: req.body.type || 'bid',
      template_name: req.body.name || req.file.originalname,
      file_path: destPath,
      original_filename: req.file.originalname,
    }).returning('*');

    res.status(201).json(template);
  } catch (err) { next(err); }
});

// DELETE /api/users/me/templates/:id — delete own template
router.delete('/me/templates/:id', async (req, res, next) => {
  try {
    const template = await db('bid_templates').where({ id: req.params.id, pm_id: req.user.id }).first();
    if (!template) return res.status(404).json({ error: 'Template not found or not yours' });
    await db('bid_templates').where('id', req.params.id).delete();
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// DEVICE REGISTRATION (mobile push tokens)
// ═══════════════════════════════════════════════════════════

router.post('/me/device', async (req, res, next) => {
  try {
    const { push_token, platform, device_name } = req.body;
    if (!push_token) return res.status(400).json({ error: 'push_token required' });

    // The mobile client sends the Expo token as `push_token`; the schema
    // column is `device_token` (see migration 20260410_001). Map it here.
    // Upsert: if this token already exists for this user, update it; otherwise insert
    const existing = await db('user_devices')
      .where({ user_id: req.user.id, device_token: push_token })
      .first();

    if (existing) {
      await db('user_devices').where('id', existing.id).update({
        platform: platform || existing.platform,
        device_name: device_name || existing.device_name,
        last_used_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    } else {
      await db('user_devices').insert({
        user_id: req.user.id,
        device_token: push_token,
        platform: platform || 'unknown',
        device_name: device_name || 'Unknown',
        last_used_at: db.fn.now(),
      });
    }

    res.json({ registered: true });
  } catch (err) { next(err); }
});

/**
 * GET /api/users/me/recents
 *
 * Returns the current user's recently-used customers, locations, and vendors.
 * Used by the type-to-filter dropdowns to populate the "default 10" list when
 * the user opens a picker without typing yet.
 *
 * "Recent" means: appearing on this user's most recent bids (customer/location)
 * or POs (vendor). Distinct, ordered by latest activity.
 *
 * Cached client-side per session — only fetched once per browser tab.
 *
 * Response shape: { customers: [...], locations: [...], vendors: [...] }
 * Each list capped at 25 items (the picker only shows 10 at a time, but
 * extras are useful for client-side filtering as the user types).
 */
router.get('/me/recents', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Recent customers — from this user's bids (estimator OR assigned PM),
    // ordered by most recent bid date
    const customers = await db('customers')
      .select(
        'customers.id', 'customers.name',
        db.raw('MAX(bids.bid_date) as last_used'),
      )
      .leftJoin('bids', 'bids.customer_id', 'customers.id')
      .where(function () {
        this.where('bids.estimator_id', userId).orWhere('bids.assigned_pm_id', userId);
      })
      .where('customers.active', true)
      .groupBy('customers.id', 'customers.name')
      .orderBy('last_used', 'desc')
      .limit(25);

    // Recent locations — same pattern
    const locations = await db('locations')
      .select(
        'locations.id', 'locations.name', 'locations.display_address',
        'locations.local_union', 'locations.location_code',
        db.raw('MAX(bids.bid_date) as last_used'),
      )
      .leftJoin('bids', 'bids.location_id', 'locations.id')
      .where(function () {
        this.where('bids.estimator_id', userId).orWhere('bids.assigned_pm_id', userId);
      })
      .where('locations.active', true)
      .groupBy('locations.id', 'locations.name', 'locations.display_address', 'locations.local_union', 'locations.location_code')
      .orderBy('last_used', 'desc')
      .limit(25);

    // Recent vendors — from this user's purchase orders. After the
    // vendors->customers merge, vendor rows live in the customers table.
    const vendors = await db('customers')
      .select('customers.id', 'customers.name',
        db.raw('MAX(purchase_orders.created_at) as last_used'))
      .leftJoin('purchase_orders', 'purchase_orders.vendor_id', 'customers.id')
      .where('purchase_orders.created_by', userId)
      .where('customers.active', true)
      .groupBy('customers.id', 'customers.name')
      .orderBy('last_used', 'desc')
      .limit(25);

    res.json({ customers, locations, vendors });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/users/me/timezone
 *
 * Lets the browser sync the user's IANA timezone whenever it changes
 * (or first detects on login). The browser sends:
 *   { timezone: "America/New_York" }
 *
 * Stored on users.default_timezone. Used as a fallback when a
 * record-creation endpoint doesn't get an explicit timezone in the body
 * (e.g. an old client that doesn't know about timezone capture).
 */
router.patch('/me/timezone', async (req, res, next) => {
  try {
    const { timezone } = req.body;
    if (!timezone || typeof timezone !== 'string') {
      return res.status(400).json({ error: 'timezone string required' });
    }
    // Light validation — IANA names look like "Region/City" or just "UTC"
    if (timezone !== 'UTC' && !/^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(timezone)) {
      return res.status(400).json({ error: 'invalid IANA timezone format' });
    }
    await db('users').where({ id: req.user.id }).update({
      default_timezone: timezone,
      updated_at: db.fn.now(),
    });
    res.json({ ok: true, timezone });
  } catch (err) { next(err); }
});

module.exports = router;
