/**
 * Email Templates — admin editor surface.
 *
 *   GET    /api/admin/email-templates              List all templates
 *   GET    /api/admin/email-templates/:key         Get one
 *   PATCH  /api/admin/email-templates/:key         Update editable fields
 *   POST   /api/admin/email-templates/:key/preview Render with sample vars
 *                                                  (optional `vars` override)
 *
 * All routes require admin. Templates affect every outbound email
 * surface that uses them, so this stays behind a tight gate even though
 * PMs can use the preview themselves via the saved-export and daily-email
 * flows.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { requireRole } = require('../middleware/authorize');
const EmailTemplateService = require('../services/EmailTemplateService');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', async (req, res, next) => {
  try {
    const templates = await EmailTemplateService.list();
    res.json({ templates });
  } catch (err) { next(err); }
});

router.get('/:key', async (req, res, next) => {
  try {
    const template = await EmailTemplateService.get(req.params.key);
    if (!template) return res.status(404).json({ error: 'Not found' });
    res.json({ template });
  } catch (err) { next(err); }
});

router.patch('/:key', async (req, res, next) => {
  try {
    const updated = await EmailTemplateService.update(req.params.key, req.body || {}, req.user.id);
    res.json({ template: updated });
  } catch (err) {
    if (/No template with key/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/must be|No fields/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/:key/preview', async (req, res, next) => {
  try {
    const overrides = (req.body && typeof req.body.vars === 'object') ? req.body.vars : {};
    const rendered = await EmailTemplateService.preview(req.params.key, overrides);
    res.json(rendered);
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
