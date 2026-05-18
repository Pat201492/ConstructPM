/**
 * Project Briefing Runner
 *
 * Sends the daily-briefing email for one project. Pipeline:
 *   1. Load the project + its daily-email config (404 / no-op if either missing)
 *   2. Resolve recipients: PM ∪ scheduler-role users ∪ project_assignments ∪ extras
 *      → dedupe → filter to active users with an email
 *   3. Build template variables from current project state
 *   4. EmailTemplateService.render(config.template_key, vars)
 *   5. NotificationService.sendEmail per recipient
 *   6. Stamp last_run_at / last_status / last_error on the config row
 *
 * Returns { delivered, failed, skipped, recipientsResolved, status, error? }.
 * `status` mirrors what we wrote to last_status:
 *   'ok' | 'partial' | 'failed' | 'no_recipients'.
 *
 * The runner is idempotent in the sense that it can be called twice in
 * the same day; whether the FileWatcher tick skips that is the
 * FileWatcher's concern (it checks last_run_at::date < today::date).
 */

const db = require('../config/database');
const EmailTemplateService = require('./EmailTemplateService');
const NotificationService = require('./NotificationService');

const ProjectBriefingRunner = {
  async run(projectId) {
    let status = 'failed';
    let errorMsg = null;
    let delivered = 0, failed = 0, skipped = 0, recipientsResolved = 0;
    const deliveryErrors = [];

    try {
      const project = await db('projects').where('id', projectId).first();
      if (!project) throw new Error(`Project not found: ${projectId}`);

      const config = await db('project_daily_email_configs').where('project_id', projectId).first();
      if (!config) throw new Error(`No daily-email config for project: ${projectId}`);

      // 1. Resolve recipients
      const userIds = await resolveRecipientIds(project, config);
      if (userIds.size === 0) {
        status = 'no_recipients';
        await stamp(config.id, status, null);
        return { delivered: 0, failed: 0, skipped: 0, recipientsResolved: 0, status };
      }

      const users = await db('users')
        .whereIn('id', [...userIds])
        .where('active', true)
        .whereNotNull('email')
        .select('id', 'first_name', 'last_name', 'email');
      skipped = userIds.size - users.length;
      recipientsResolved = users.length;

      if (users.length === 0) {
        status = 'no_recipients';
        await stamp(config.id, status, skipped > 0 ? `${skipped} skipped (inactive/no email)` : null);
        return { delivered: 0, failed: 0, skipped, recipientsResolved: 0, status };
      }

      // 2. Build template variables
      const vars = await buildVars(project);

      // 3. Render template once; reused for every recipient
      const rendered = await EmailTemplateService.render(config.template_key || 'project_daily_briefing', vars);

      // 4. Send
      for (const u of users) {
        try {
          const res = await NotificationService.sendEmail({
            to: u.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text || undefined,
          });
          if (res && res.delivered) delivered++;
          else {
            failed++;
            if (res && res.reason) deliveryErrors.push(`${u.email}: ${res.reason}`);
          }
        } catch (err) {
          failed++;
          deliveryErrors.push(`${u.email}: ${err.message}`);
        }
      }

      // 5. Status
      if (failed === 0 && skipped === 0) status = 'ok';
      else if (delivered > 0) status = 'partial';
      else status = 'failed';

      const summary = [];
      if (failed > 0) summary.push(`${failed} failed`);
      if (skipped > 0) summary.push(`${skipped} skipped`);
      let stampError = summary.length > 0 ? summary.join(', ') : null;
      if (deliveryErrors.length > 0) {
        const sample = [...new Set(deliveryErrors)].slice(0, 3).join('; ');
        const more = deliveryErrors.length > 3 ? ` (+${deliveryErrors.length - 3} more)` : '';
        stampError = `${stampError ?? 'delivery errors'} — ${sample}${more}`;
      }
      errorMsg = stampError;

      await stamp(config.id, status, stampError);
      return { delivered, failed, skipped, recipientsResolved, status, error: stampError };
    } catch (err) {
      errorMsg = err.message || String(err);
      // Best-effort stamp: only if we have a config row to stamp against.
      try {
        const config = await db('project_daily_email_configs').where('project_id', projectId).first();
        if (config) await stamp(config.id, 'failed', errorMsg);
      } catch { /* swallow */ }
      return { delivered, failed, skipped, recipientsResolved, status: 'failed', error: errorMsg };
    }
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

async function resolveRecipientIds(project, config) {
  const set = new Set();

  if (config.include_pm && project.pm_id) set.add(project.pm_id);

  if (config.include_scheduler) {
    const schedulers = await db('users').where({ role: 'scheduler', active: true }).pluck('id');
    schedulers.forEach(id => set.add(id));
  }

  if (config.include_staff) {
    const staff = await db('project_assignments').where('project_id', project.id).pluck('user_id');
    staff.forEach(id => set.add(id));
  }

  const extras = normalizeJsonArray(config.extra_recipient_user_ids);
  extras.forEach(id => { if (id) set.add(id); });

  return set;
}

async function buildVars(project) {
  // PM name lookup (single row, may be null)
  const pm = project.pm_id ? await db('users').where('id', project.pm_id).first(['first_name', 'last_name']) : null;

  // Counts — three small COUNT(*) queries; cheap, parallel.
  const [eqCount, poCount, tsCount] = await Promise.all([
    db('equipment').where('current_project_id', project.id).count('* as n').first(),
    db('purchase_orders').where('project_id', project.id).whereNotIn('status', ['received', 'cancelled']).count('* as n').first(),
    db('timesheets').where('project_id', project.id).where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)).count('* as n').first(),
  ]);

  return {
    project_name: project.name || '',
    project_status: project.status || '',
    pm_name: pm ? `${pm.first_name || ''} ${pm.last_name || ''}`.trim() : '—',
    today_date: new Date().toISOString().split('T')[0],
    equipment_on_project_count: Number(eqCount?.n || 0),
    open_pos_count: Number(poCount?.n || 0),
    recent_timesheet_count: Number(tsCount?.n || 0),
    project_url: `${baseUrl()}/#project/${project.id}`,
  };
}

function baseUrl() {
  return process.env.PUBLIC_BASE_URL || process.env.APP_URL || 'http://localhost:3000';
}

async function stamp(configId, status, error) {
  await db('project_daily_email_configs').where('id', configId).update({
    last_run_at: new Date(),
    last_status: status,
    last_error: error || null,
    updated_at: db.fn.now(),
  });
}

function normalizeJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

module.exports = ProjectBriefingRunner;
