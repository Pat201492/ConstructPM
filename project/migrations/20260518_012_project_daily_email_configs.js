/**
 * Per-project daily briefing config.
 *
 * One row per project. The FileWatcher tick (extended in this PR) picks
 * up rows where `enabled = true AND send_hour_utc = <current UTC hour>`
 * and hasn't yet run today, then hands the project_id off to
 * ProjectBriefingRunner.
 *
 * Recipient set is composed at send time from include_pm / include_scheduler
 * / include_staff + extra_recipient_user_ids — never persisted directly,
 * so de/reactivating a user takes effect on the next send without anyone
 * touching the config.
 */

exports.up = async function (knex) {
  if (await knex.schema.hasTable('project_daily_email_configs')) return;

  await knex.schema.createTable('project_daily_email_configs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().unique().references('id').inTable('projects').onDelete('CASCADE');
    t.boolean('enabled').notNullable().defaultTo(false);
    t.integer('send_hour_utc').notNullable().defaultTo(13); // 13 UTC ≈ 8am Eastern (winter); PM can adjust
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
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('project_daily_email_configs');
};
