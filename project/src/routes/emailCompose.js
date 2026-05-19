/**
 * Email Compose routes.
 *
 *   GET  /api/email-compose/catalog?context=…&{ids}
 *        → { vars: [{key,label,sample,emailable}, …],
 *            defaults: { to:[{id,email,label}], subject, body_html } }
 *        Used by the compose modal to populate the variable picker +
 *        pre-fill the To/Subject/Body fields with template defaults.
 *
 *   POST /api/email-compose/preview
 *        body: { context, ids:{...}, raw_subject?, raw_body_html? }
 *        → { subject, html }
 *        Used by the modal's live preview pane to render the resolved
 *        output as the user composes.
 *
 * Auth: authenticated only. The parent send routes (/email-day,
 * /exports/schedules/:id/trigger) enforce their own permission gates —
 * a user invoking compose must already have access to fire the actual
 * email, so we don't gatekeep the same data here twice.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const EmailComposeService = require('../services/EmailComposeService');

const router = express.Router();
router.use(authenticate);

// Maps querystring fields to a context-ids object — keeps the URL flat
// (e.g. `?context=email_day_to_staff&project_id=X&date=Y`) instead of
// nesting JSON in a GET.
function idsFromQuery(context, query) {
  if (context === 'email_day_to_staff') {
    return { project_id: query.project_id, date: query.date };
  }
  if (context === 'saved_export_run') {
    return { saved_export_id: query.saved_export_id };
  }
  return {};
}

router.get('/catalog', async (req, res, next) => {
  try {
    const context = req.query.context;
    if (!context) return res.status(400).json({ error: 'context query param is required' });
    const ids = idsFromQuery(context, req.query);
    const result = await EmailComposeService.getCatalog(context, ids);
    res.json(result);
  } catch (err) {
    if (/required|not found|Unknown compose context/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/preview', async (req, res, next) => {
  try {
    const { context, ids, raw_subject, raw_body_html } = req.body || {};
    if (!context) return res.status(400).json({ error: 'context is required' });
    const vars = await EmailComposeService.getVars(context, ids || {}, {});
    const subject = typeof raw_subject === 'string'
      ? EmailComposeService.resolveWithVars(raw_subject, vars, { escape: false })
      : '';
    const html = typeof raw_body_html === 'string'
      ? EmailComposeService.resolveWithVars(raw_body_html, vars, { escape: true })
      : '';
    res.json({ subject, html });
  } catch (err) {
    if (/required|not found|Unknown compose context/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
