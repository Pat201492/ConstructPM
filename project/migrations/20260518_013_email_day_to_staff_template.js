/**
 * Migrate from the misplaced "daily project briefing" surface (PR #6) to
 * a template that drives the existing Scheduler → Email Day to Staff
 * flow (route: POST /api/projects/:id/email-day).
 *
 * Three things, atomic per knex's transactional DDL:
 *   1. Drop the project_daily_email_configs table (added in migration
 *      012, never used in practice — the feature was wired to the wrong
 *      surface and Pat asked for it to be removed before anyone created
 *      a row).
 *   2. Delete the project_daily_briefing template row (added in
 *      migration 011) — it was the body for the same misplaced feature.
 *   3. Insert email_day_to_staff template with variables that match what
 *      the /email-day route can supply.
 *
 * Down: best-effort reverse. We recreate the table (so a rollback is
 * survivable) but DON'T resurrect the project_daily_briefing row —
 * anyone rolling back this far is in trouble anyway; they can re-seed
 * by hand if they need to.
 */

exports.up = async function (knex) {
  // 1. Drop the misplaced per-project config table.
  if (await knex.schema.hasTable('project_daily_email_configs')) {
    await knex.schema.dropTable('project_daily_email_configs');
  }

  // 2. Delete the old template row.
  await knex('email_templates').where('key', 'project_daily_briefing').del();

  // 3. Insert the new template (idempotent — skip if it somehow exists).
  const existing = await knex('email_templates').where('key', 'email_day_to_staff').first();
  if (!existing) {
    await knex('email_templates').insert({
      key: 'email_day_to_staff',
      name: 'Scheduler — Email Day to Staff',
      subject: 'Schedule: {{project_number}} on {{date}}',
      body_html: `<p>You're on the crew for <strong>{{project_name}}</strong> ({{project_number}}) on <strong>{{date}}</strong>.</p>
<p><strong>Location:</strong> {{location}}<br>
<strong>Crew ({{crew_count}}):</strong> {{crew_names}}</p>
<p>{{day_notes}}</p>
<p style="color:#888;font-size:12px;margin-top:24px">Sent from ConstructPM's Email Day to Staff. Reply to your PM with any questions.</p>`,
      body_text: `You're on the crew for {{project_name}} ({{project_number}}) on {{date}}.
Location: {{location}}
Crew ({{crew_count}}): {{crew_names}}
{{day_notes}}`,
      variables: JSON.stringify([
        { key: 'project_number', label: 'Primary project number', sample: 'S26-1342.1' },
        { key: 'project_name', label: 'Project name', sample: 'Substation Switchgear Upgrade — Phase 1' },
        { key: 'location', label: 'Project address (may be empty)', sample: '123 Main St, Springfield, IL' },
        { key: 'date', label: 'Date the crew is scheduled (YYYY-MM-DD)', sample: '2026-05-18' },
        { key: 'crew_count', label: 'Number of workers assigned that day', sample: 5 },
        { key: 'crew_names', label: 'Comma-joined first+last names of the crew', sample: 'Mike T, Sarah K, Carlos R, Amir N, Jane D' },
        { key: 'day_notes', label: 'Pre-formatted day-note line (already includes "Day notes: " prefix; empty if no note)', sample: 'Day notes: Bring extra PPE — site safety briefing at 7:00am' },
      ]),
    });
  }
};

exports.down = async function (knex) {
  await knex('email_templates').where('key', 'email_day_to_staff').del();

  if (!(await knex.schema.hasTable('project_daily_email_configs'))) {
    await knex.schema.createTable('project_daily_email_configs', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('project_id').notNullable().unique().references('id').inTable('projects').onDelete('CASCADE');
      t.boolean('enabled').notNullable().defaultTo(false);
      t.integer('send_hour_utc').notNullable().defaultTo(13);
      t.boolean('include_pm').notNullable().defaultTo(true);
      t.boolean('include_scheduler').notNullable().defaultTo(true);
      t.boolean('include_staff').notNullable().defaultTo(true);
      t.jsonb('extra_recipient_user_ids').notNullable().defaultTo('[]');
      t.string('template_key', 64).notNullable().defaultTo('project_daily_briefing');
      t.timestamp('last_run_at');
      t.string('last_status', 32);
      t.text('last_error');
      t.timestamps(true, true);
      t.index('project_id');
      t.index(['enabled', 'send_hour_utc']);
    });
  }
};
