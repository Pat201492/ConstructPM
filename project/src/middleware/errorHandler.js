/**
 * Global error handler. Catches unhandled errors and returns consistent JSON.
 */
function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${err.message}`, {
    path: req.path,
    method: req.method,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Validation errors from express-validator
  if (err.type === 'validation') {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
  }

  // Known operational errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.error || 'Error',
      message: err.message,
    });
  }

  // Database unique constraint violations
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Duplicate entry',
      message: 'A record with this value already exists.',
    });
  }

  // Database foreign key violations
  if (err.code === '23503') {
    return res.status(400).json({
      error: 'Reference error',
      message: 'The referenced record does not exist.',
    });
  }

  // Fallback
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred.',
  });
}

/**
 * Helper to create operational errors with status codes.
 */
class AppError extends Error {
  constructor(statusCode, message, error = 'Error') {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
  }
}

module.exports = { errorHandler, AppError };
