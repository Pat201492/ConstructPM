const express = require('express');
const { param, validationResult } = require('express-validator');
const NotificationService = require('../services/NotificationService');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/notifications
 * Get current user's in-app notifications
 */
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      limit: parseInt(req.query.limit, 10) || 50,
      offset: parseInt(req.query.offset, 10) || 0,
    };

    if (req.query.read === 'true') filters.read = true;
    if (req.query.read === 'false') filters.read = false;

    const result = await NotificationService.getForUser(req.user.id, filters);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/unread-count
 * Quick count of unread notifications (for badge display)
 */
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user.id);
    res.json({ unread: count });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read
 */
router.patch(
  '/:id/read',
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const notification = await NotificationService.markRead(req.params.id, req.user.id);
      if (!notification) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.json({ notification });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', async (req, res, next) => {
  try {
    const updated = await NotificationService.markAllRead(req.user.id);
    res.json({ message: `${updated} notifications marked as read.` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/dismiss-informational
 * Dismiss all informational (non-actionable) notifications.
 * Actionable notifications stay until resolved.
 */
router.post('/dismiss-informational', async (req, res, next) => {
  try {
    const updated = await NotificationService.dismissAllInformational(req.user.id);
    res.json({ message: `${updated} informational notifications dismissed.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
