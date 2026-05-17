const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');

const AuthService = {
  /**
   * Generate an access token (short-lived)
   */
  generateAccessToken(user) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
  },

  /**
   * Generate a refresh token (long-lived) and store its hash in the DB
   */
  async generateRefreshToken(userId, deviceInfo = null) {
    const token = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Parse refresh expiry to calculate absolute date
    const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const days = parseInt(expiresIn, 10) || 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await db('refresh_tokens').insert({
      user_id: userId,
      token_hash: tokenHash,
      device_info: deviceInfo,
      expires_at: expiresAt,
    });

    return { token, expiresAt };
  },

  /**
   * Verify a refresh token and return the associated user_id
   */
  async verifyRefreshToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const record = await db('refresh_tokens')
      .where({ token_hash: tokenHash })
      .where('expires_at', '>', new Date())
      .first();

    if (!record) return null;
    return record.user_id;
  },

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return db('refresh_tokens').where({ token_hash: tokenHash }).del();
  },

  /**
   * Revoke all refresh tokens for a user (e.g., on password change or forced logout)
   */
  async revokeAllUserTokens(userId) {
    return db('refresh_tokens').where({ user_id: userId }).del();
  },

  /**
   * Clean up expired refresh tokens (run periodically)
   */
  async cleanupExpiredTokens() {
    const deleted = await db('refresh_tokens')
      .where('expires_at', '<', new Date())
      .del();
    return deleted;
  },
};

module.exports = AuthService;
