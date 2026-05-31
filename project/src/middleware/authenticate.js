const jwt = require('jsonwebtoken');

/**
 * Verifies the JWT access token from the Authorization header.
 * Attaches the decoded user payload to req.user.
 *
 * NOTE: This middleware deliberately does NOT enforce the
 * must_change_password flag. Per Pat: the forced password reset is a
 * login-time UX gate (handled client-side by routing to the
 * force-change-password screen when login response carries the flag),
 * not a server-side authorization gate. A user with a valid JWT but
 * an unset password is free to make API calls; the forced screen is
 * the design's only enforcement surface.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'No valid token provided. Include a Bearer token in the Authorization header.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Pin the algorithm so a token can't dictate verification (defense in
    // depth — jsonwebtoken@9 already rejects alg:none with a secret present).
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
    };
    next();
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
}

module.exports = authenticate;
