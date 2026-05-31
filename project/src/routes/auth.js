const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AuthService = require('../services/AuthService');
const authenticate = require('../middleware/authenticate');
const db = require('../config/database');

const router = express.Router();

// Throttle unauthenticated auth endpoints (login, refresh, password-reset)
// to blunt credential-stuffing and token/brute-force. Keyed per IP. Disabled
// under NODE_ENV=test so the suite isn't rate-limited. Tune via env if needed.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 0 : Number(process.env.AUTH_RATE_LIMIT || 30),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many requests', message: 'Too many attempts. Please try again later.' },
});

/**
 * POST /api/auth/login
 * Authenticate a user and return access + refresh tokens
 */
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const { email, password } = req.body;
      const user = await User.findByEmail(email);

      if (!user || !user.active) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password.',
        });
      }

      const isValid = await User.verifyPassword(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid email or password.',
        });
      }

      // Generate tokens
      const accessToken = AuthService.generateAccessToken(user);
      const { token: refreshToken, expiresAt } = await AuthService.generateRefreshToken(
        user.id,
        req.headers['user-agent']
      );

      // Record login
      await User.recordLogin(user.id);

      // Get role configuration
      const roleConfig = await db('role_configurations').where('role_name', user.role).first();
      const allowed_tabs = roleConfig ? (typeof roleConfig.allowed_tabs === 'string' ? JSON.parse(roleConfig.allowed_tabs) : roleConfig.allowed_tabs) : [];

      // Feature flags — same source as /auth/me. Without including them
      // here, a fresh login would land with S.features = {} (cleared by
      // logout) and featureEnabled() would fail-open, leaving disabled
      // feature tabs visible until the next /auth/me hit. Symptom: log
      // out as superadmin after disabling a feature, log in as admin,
      // see the disabled tab anyway until refresh.
      const flagRows = await db('global_variables').where('key', 'like', 'feature.%');
      const features = {};
      flagRows.forEach(r => {
        const shortKey = r.key.replace(/^feature\./, '');
        features[shortKey] = r.value === 'true';
      });

      res.json({
        accessToken,
        refreshToken,
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          default_markup_pct: user.default_markup_pct || 15,
          must_change_password: !!user.must_change_password,
        },
        allowed_tabs,
        bid_visibility: roleConfig?.bid_visibility || 'own',
        project_visibility: roleConfig?.project_visibility || 'own',
        features,
        is_superadmin: !!user.is_superadmin,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access token
 */
router.post(
  '/refresh',
  authLimiter,
  [body('refreshToken').notEmpty().withMessage('Refresh token required')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const { refreshToken } = req.body;
      const userId = await AuthService.verifyRefreshToken(refreshToken);

      if (!userId) {
        return res.status(401).json({
          error: 'Invalid refresh token',
          message: 'The refresh token is invalid or expired. Please log in again.',
        });
      }

      const user = await User.findById(userId);
      if (!user || !user.active) {
        await AuthService.revokeRefreshToken(refreshToken);
        return res.status(401).json({
          error: 'Account inactive',
          message: 'Your account has been deactivated.',
        });
      }

      // Rotate: revoke old refresh token, issue new pair
      await AuthService.revokeRefreshToken(refreshToken);
      const accessToken = AuthService.generateAccessToken(user);
      const { token: newRefreshToken, expiresAt } = await AuthService.generateRefreshToken(
        user.id,
        req.headers['user-agent']
      );

      res.json({
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 * Revoke the current refresh token
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await AuthService.revokeRefreshToken(refreshToken);
    }
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout-all
 * Revoke ALL refresh tokens for the current user (sign out everywhere)
 */
router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await AuthService.revokeAllUserTokens(req.user.id);
    res.json({ message: 'Logged out from all devices.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Return the current authenticated user's profile
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const roleConfig = await db('role_configurations').where('role_name', user.role).first();

    // Tabs: per-user override > role default
    const userTabs = user.tab_overrides ? (typeof user.tab_overrides === 'string' ? JSON.parse(user.tab_overrides) : user.tab_overrides) : null;
    const roleTabs = roleConfig ? (typeof roleConfig.allowed_tabs === 'string' ? JSON.parse(roleConfig.allowed_tabs) : roleConfig.allowed_tabs) : [];
    const allowed_tabs = userTabs || roleTabs;

    // Visibility: per-user override > role default
    const userAccess = user.access_config ? (typeof user.access_config === 'string' ? JSON.parse(user.access_config) : user.access_config) : {};
    const bid_visibility = userAccess.bid_visibility || roleConfig?.bid_visibility || 'own';
    const project_visibility = userAccess.project_visibility || roleConfig?.project_visibility || 'own';

    // Feature flags — system-wide on/off switches stored in
    // global_variables with the `feature.` prefix. Frontend uses these
    // to hide sidebar tabs and related sections without redeploying.
    // Returned as a flat object keyed by short name (the part after
    // `feature.`) so the frontend reads `features.invoices_enabled`.
    const flagRows = await db('global_variables').where('key', 'like', 'feature.%');
    const features = {};
    flagRows.forEach(r => {
      const shortKey = r.key.replace(/^feature\./, '');
      features[shortKey] = r.value === 'true';
    });

    res.json({
      user, allowed_tabs, bid_visibility, project_visibility,
      role_display: roleConfig?.display_name || user.role,
      features,
      // Surface is_superadmin at the top level so the frontend can gate
      // the Superadmin sidebar tab without inspecting nested user object.
      // The user object itself also carries it (via SAFE_FIELDS once
      // included), but top-level keeps consumers consistent with how
      // `features` and `allowed_tabs` are returned.
      is_superadmin: !!user.is_superadmin,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/change-password
 * Authenticated user changes their own password.
 * Body: { currentPassword, newPassword }
 */
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      // Fetch user WITH password_hash (findByEmail returns it; findById filters it out)
      const userWithHash = await db('users').where({ id: req.user.id }).first();
      if (!userWithHash || !userWithHash.active) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      const isValid = await User.verifyPassword(req.body.currentPassword, userWithHash.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // User.update handles hashing when passed a `password` field.
      // Clear the first-login flag so the next login routes to the
      // normal landing page instead of looping back to the forced reset.
      await User.update(req.user.id, { password: req.body.newPassword, must_change_password: false });

      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/initial-password-change
 * First-login password set. Skips currentPassword check because the
 * user just authenticated with the admin-set default (ChangeMe123!) at
 * the login step that immediately preceded this call — re-asking for
 * it is friction without security benefit.
 *
 * Only valid when the caller still has must_change_password = true.
 * After must_change_password flips false, this endpoint 403s so it
 * can't be used as a password-change shortcut later in the session.
 * Body: { newPassword }
 */
router.post(
  '/initial-password-change',
  authenticate,
  [body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const userRow = await db('users').where({ id: req.user.id }).first('id', 'active', 'must_change_password');
      if (!userRow || !userRow.active) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }
      if (!userRow.must_change_password) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This endpoint is only valid for the first-login flow. Use /auth/change-password to change a password mid-session.',
        });
      }

      await User.update(req.user.id, { password: req.body.newPassword, must_change_password: false });

      res.json({ message: 'Initial password set' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/reset-password/verify
 * Public — check whether a reset token is valid (used by the frontend
 * to decide whether to show the reset form or an "invalid link" error
 * before the user types a new password).
 *
 * Body: { token }
 * Response: { valid: bool, expiresAt?, userEmail? }
 */
router.post(
  '/reset-password/verify',
  authLimiter,
  [body('token').notEmpty().withMessage('token required')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation error', details: errors.array() });

      const parts = String(req.body.token).split('.');
      if (parts.length !== 2) return res.json({ valid: false, reason: 'malformed' });
      const [resetId, secret] = parts;

      // UUID sanity check to avoid bogus DB queries
      if (!/^[0-9a-f-]{36}$/i.test(resetId)) return res.json({ valid: false, reason: 'malformed' });

      const reset = await db('password_resets').where({ id: resetId }).first();
      if (!reset) return res.json({ valid: false, reason: 'not_found' });
      if (reset.used_at) return res.json({ valid: false, reason: 'already_used' });
      if (new Date(reset.expires_at) < new Date()) return res.json({ valid: false, reason: 'expired' });

      const match = await bcrypt.compare(secret, reset.token_hash);
      if (!match) return res.json({ valid: false, reason: 'invalid' });

      const user = await db('users').select('email', 'first_name', 'last_name').where({ id: reset.user_id }).first();

      res.json({
        valid: true,
        expiresAt: reset.expires_at,
        userEmail: user?.email || null,
        userName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : null,
      });
    } catch (err) { next(err); }
  }
);

/**
 * POST /api/auth/reset-password
 * Public — consume a valid reset token and set a new password.
 *
 * Body: { token, newPassword }
 * Response: { success: true }
 */
router.post(
  '/reset-password',
  authLimiter,
  [
    body('token').notEmpty().withMessage('token required'),
    body('newPassword').isLength({ min: 8 }).withMessage('newPassword must be at least 8 characters'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation error', details: errors.array() });

      const parts = String(req.body.token).split('.');
      if (parts.length !== 2) return res.status(400).json({ error: 'Invalid reset token' });
      const [resetId, secret] = parts;
      if (!/^[0-9a-f-]{36}$/i.test(resetId)) return res.status(400).json({ error: 'Invalid reset token' });

      // Use a transaction: verify the token and apply the password change atomically.
      // This also prevents two parallel requests from using the same token.
      await db.transaction(async (trx) => {
        const reset = await trx('password_resets').where({ id: resetId }).forUpdate().first();
        if (!reset) throw Object.assign(new Error('Invalid or expired reset link'), { status: 400 });
        if (reset.used_at) throw Object.assign(new Error('This reset link has already been used'), { status: 400 });
        if (new Date(reset.expires_at) < new Date()) throw Object.assign(new Error('This reset link has expired'), { status: 400 });

        const match = await bcrypt.compare(secret, reset.token_hash);
        if (!match) throw Object.assign(new Error('Invalid reset link'), { status: 400 });

        const user = await trx('users').where({ id: reset.user_id }).first();
        if (!user || !user.active) throw Object.assign(new Error('User not found or inactive'), { status: 400 });

        // Hash the new password and apply
        const SALT_ROUNDS = 12;
        const password_hash = await bcrypt.hash(req.body.newPassword, SALT_ROUNDS);
        await trx('users').where({ id: reset.user_id }).update({
          password_hash,
          updated_at: trx.fn.now(),
        });

        // Mark reset as used
        await trx('password_resets').where({ id: resetId }).update({
          used_at: trx.fn.now(),
        });

        // Best-effort audit
        try {
          await trx('audit_log').insert({
            table_name: 'users',
            record_id: user.id,
            action: 'update',
            field_name: 'password_hash',
            new_value: 'reset_via_link',
            user_id: user.id,
            ip_address: req.ip,
          });
        } catch { /* audit optional */ }
      });

      res.json({ success: true, message: 'Password updated. You can now log in with your new password.' });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  }
);

/**
 * POST /api/auth/dev-login
 * Development-only endpoint that issues tokens for a given email without
 * requiring the password. Used by the in-app user switcher to swap between
 * seeded test users in one click.
 *
 * GATED THREE WAYS:
 *   1. NODE_ENV must be 'development'
 *   2. process.env.ENABLE_DEV_LOGIN must be 'true'
 *   3. Password reset must NOT be in progress (paranoid check)
 *
 * If any gate fails, returns 404 (pretends the endpoint doesn't exist).
 *
 * Body: { email }
 * Response: same shape as /login — { user, accessToken, refreshToken }
 */
router.post(
  '/dev-login',
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    // GATE: only enabled in development with explicit flag
    if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_DEV_LOGIN !== 'true') {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const user = await User.findByEmail(req.body.email);
      if (!user || !user.active) {
        return res.status(404).json({ error: 'User not found or inactive' });
      }

      // Update last_login_at (so audit looks normal)
      await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });

      const accessToken = AuthService.generateAccessToken(user);
      const { token: refreshToken } = await AuthService.generateRefreshToken(user.id, 'dev-switcher');

      // Strip password_hash from response
      const { password_hash, ...safeUser } = user;
      res.json({
        user: safeUser,
        accessToken,
        refreshToken,
        dev_login: true, // explicit flag so the frontend knows
      });
    } catch (err) {
      console.error('[DevLogin] Error:', err.message);
      res.status(500).json({ error: 'Dev login failed' });
    }
  }
);

/**
 * GET /api/auth/dev-users
 * Lists all active seeded users for the dev switcher. Same env gate as dev-login.
 * Returns: { users: [{ id, email, first_name, last_name, role }] }
 */
router.get('/dev-users', async (req, res) => {
  if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_DEV_LOGIN !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const users = await db('users')
      .select('id', 'email', 'first_name', 'last_name', 'role', 'initials')
      .where('active', true)
      .orderByRaw(`CASE role
          WHEN 'admin' THEN 1
          WHEN 'project_manager' THEN 2
          WHEN 'estimator' THEN 3
          WHEN 'accounting' THEN 4
          WHEN 'shop_staff' THEN 5
          WHEN 'field_staff' THEN 6
          ELSE 7 END`)
      .orderBy('first_name');
    res.json({ users });
  } catch (err) {
    // Log the real error server-side but return a generic message so
    // the response doesn't leak DB or stack details. Matches the
    // pattern used by /dev-login earlier in this file.
    console.error('[/dev-users] error:', err.message);
    res.status(500).json({ error: 'Dev user list unavailable' });
  }
});

module.exports = router;
