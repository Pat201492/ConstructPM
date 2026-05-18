/**
 * Email templates.
 *
 * Each row is one editable email surface (subject + HTML body), keyed by
 * a stable string the code references (e.g. 'saved_export_email').
 * `variables` documents the placeholders the template supports — the
 * editor uses it to render a help panel and to drive the preview with
 * sample values.
 *
 * Body rendering uses Mustache-flavoured `{{var}}` (HTML-escaped) /
 * `{{{var}}}` (raw) — see EmailTemplateService.
 *
 * Seeded with two rows:
 *   1. saved_export_email      — used by SavedExportRunner (PR #4)
 *   2. project_daily_briefing  — used by ProjectBriefingRunner (this PR)
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('email_templates'))) {
    await knex.schema.createTable('email_templates', (t) => {
      t.string('key', 64).primary();
      t.string('name', 255).notNullable();
      t.string('subject', 500).notNullable();
      t.text('body_html').notNullable();
      t.text('body_text');
      t.jsonb('variables').notNullable().defaultTo('[]');
      t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  // ── Seed: only insert rows that don't already exist (idempotent) ─
  const existing = await knex('email_templates').pluck('key');
  const rows = [];

  if (!existing.includes('saved_export_email')) {
    rows.push({
      key: 'saved_export_email',
      name: 'Scheduled export — delivery email',
      subject: '[ConstructPM] {{name}}',
      body_html: `<p>Hi —</p>
<p>Your scheduled ConstructPM export <strong>{{name}}</strong> ran at {{whenUtc}} UTC and the CSV is attached.</p>
<p><strong>{{rowCount}}</strong> rows from the <code>{{source}}</code> source.</p>
<p style="color:#888;font-size:12px;margin-top:24px">Manage your scheduled exports from the Data Export tab in ConstructPM.</p>`,
      body_text: null,
      variables: JSON.stringify([
        { key: 'name', label: 'Saved export name', sample: 'Weekly P&L' },
        { key: 'source', label: 'Source key', sample: 'projects' },
        { key: 'rowCount', label: 'Number of rows in the CSV', sample: 42 },
        { key: 'whenUtc', label: 'Run timestamp (UTC, ISO without ms)', sample: '2026-05-18 13:00:00' },
      ]),
    });
  }

  if (!existing.includes('project_daily_briefing')) {
    rows.push({
      key: 'project_daily_briefing',
      name: 'Project — daily briefing',
      subject: '[ConstructPM] {{project_name}} — daily briefing for {{today_date}}',
      body_html: `<p>Hi team —</p>
<p>Here's today's quick read on <strong>{{project_name}}</strong> ({{project_status}}).</p>
<ul>
  <li>PM: {{pm_name}}</li>
  <li>Equipment currently on the project: {{equipment_on_project_count}}</li>
  <li>Open purchase orders: {{open_pos_count}}</li>
  <li>Timesheets entered in the last 24h: {{recent_timesheet_count}}</li>
</ul>
<p><a href="{{project_url}}">Open in ConstructPM →</a></p>
<p style="color:#888;font-size:12px;margin-top:24px">You're getting this because you're on the recipient list for this project's daily briefing. The PM can adjust the list from the project's Daily Email panel.</p>`,
      body_text: null,
      variables: JSON.stringify([
        { key: 'project_name', label: 'Project name', sample: 'Substation Switchgear Upgrade — Phase 1' },
        { key: 'project_status', label: 'Project status', sample: 'active' },
        { key: 'pm_name', label: 'PM first + last name', sample: 'Mike Thompson' },
        { key: 'today_date', label: 'Today (UTC, YYYY-MM-DD)', sample: '2026-05-18' },
        { key: 'equipment_on_project_count', label: 'Count of equipment with current_project_id = this project', sample: 7 },
        { key: 'open_pos_count', label: 'POs not in (received, cancelled)', sample: 3 },
        { key: 'recent_timesheet_count', label: 'Timesheets entered in the last 24h', sample: 12 },
        { key: 'project_url', label: 'Deep link to this project page', sample: 'http://localhost:3000/#project/abc-123' },
      ]),
    });
  }

  if (rows.length > 0) await knex('email_templates').insert(rows);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('email_templates');
};
