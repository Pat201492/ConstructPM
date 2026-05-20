/**
 * Email Templates — user-scoped override surface.
 *
 *   GET    /api/email-templates/:key/my-override   Caller's override row (or null)
 *   PATCH  /api/email-templates/:key/my-override   Upsert caller's override
 *   DELETE /api/email-templates/:key/my-override   Clear caller's override (back to admin default)
 *   POST   /api/email-templates/:key/preview       Preview the merged render
 *                                                  (admin → caller's persisted override →
 *                                                  unsaved patch in body), against the
 *                                                  template's declared sample variables.
 *
 * Authenticated, no role gate. Each route operates only on the calling
 * user's own override row — there is no path that lets a user read or
 * mutate another user's overrides.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const EmailTemplateService = require('../services/EmailTemplateService');

const router = express.Router();

router.use(authenticate);

// Read-only template fetch for non-admins. The admin editor lives behind
// `/api/admin/email-templates/:key` (admin-gated); this mirror lets the
// "My Email Preferences" UI render the variable list and admin defaults
// without exposing the edit/update endpoints.
router.get('/:key', async (req, res, next) => {
  try {
    const template = await EmailTemplateService.get(req.params.key);
    if (!template) return res.status(404).json({ error: 'Not found' });
    res.json({ template });
  } catch (err) { next(err); }
});

router.get('/:key/my-override', async (req, res, next) => {
  try {
    const tpl = await EmailTemplateService.get(req.params.key);
    if (!tpl) return res.status(404).json({ error: `No template with key "${req.params.key}"` });
    const override = await EmailTemplateService.getUserOverride(req.user.id, req.params.key);
    res.json({ override });
  } catch (err) { next(err); }
});

router.patch('/:key/my-override', async (req, res, next) => {
  try {
    const allowed = ['subject', 'body_html', 'body_text'];
    const patch = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) patch[k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    const override = await EmailTemplateService.setUserOverride(req.user.id, req.params.key, patch);
    res.json({ override });
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.delete('/:key/my-override', async (req, res, next) => {
  try {
    const removed = await EmailTemplateService.clearUserOverride(req.user.id, req.params.key);
    res.json({ removed });
  } catch (err) { next(err); }
});

router.post('/:key/preview', async (req, res, next) => {
  try {
    const overrides = (req.body && typeof req.body === 'object') ? req.body : {};
    const cleaned = {};
    for (const k of ['subject', 'body_html', 'body_text']) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) cleaned[k] = overrides[k];
    }
    const rendered = await EmailTemplateService.previewWithOverride(req.params.key, req.user.id, cleaned);
    res.json(rendered);
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
