const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Endpoints that REMAIN reachable while a user's must_change_password
// flag is true. Anything else 403s with a forced-reset hint so the
// client-side guard can't be bypassed (e.g., dev-tools fetch with a
// valid Bearer token would otherwise hit /api/projects unimpeded).
const PASSWORD_CHANGE_WHITELIST = [
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/refresh',
];

function isWhitelisted(originalUrl) {
  const path = (originalUrl || '').split('?')[0];
  return PASSWORD_CHANGE_WHITELIST.includes(path);
}

/**
 * Verifies the JWT access token from the Authorization header.
 * Attaches the decoded user payload to req.user.
 * Also enforces the first-login password-change gate server-side:
 * if the user has must_change_password=true, all endpoints except a
 * small auth whitelist 403 with a reset hint.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'No valid token provided. Include a Bearer token in the Authorization header.',
    });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired. Please refresh your token or log in again.',
      });
    }
    return res.status(401).json({
      error: 'Invalid token',
      message: 'The provided token is invalid.',
    });
  }

  req.user = {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
    firstName: decoded.firstName,
    lastName: decoded.lastName,
  };

  // Cheap one-row lookup. Gate any non-auth call until the flag is
  // cleared. Client guards also exist on web + mobile but those are
  // bypassable via raw fetch with a valid token; this is the real fence.
  if (!isWhitelisted(req.originalUrl)) {
    try {
      const row = await db('users').where({ id: decoded.id }).select('must_change_password').first();
      if (row && row.must_change_password) {
        return res.status(403).json({
          error: 'Password change required',
          message: 'Your account must set a new password before continuing. Visit POST /api/auth/change-password.',
          must_change_password: true,
        });
      }
    } catch (err) {
      // DB error here would 500 the whole route — log and let the next
      // handler decide whether to proceed (it can't do less than this).
      console.error('[authenticate] must_change_password lookup failed:', err.message);
    }
  }

  next();
}

module.exports = authenticate;
