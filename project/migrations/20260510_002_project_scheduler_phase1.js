/**
 * Migration: Project scheduler — phase 1 schema.
 *
 * Adds:
 *   - projects.start_date — when the project actually begins (distinct
 *     from won_date which is when the bid was awarded)
 *   - project_schedule_overrides — per-project working-day rules
 *     (default M-F; toggle Sat / Sun)
 *
 * Worker assignment table (`worker_assignments`) deliberately deferred
 * until the Scheduler grid sub-tab is built — adding empty tables before
 * they're used invites schema drift.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('projects', 'start_date'))) {
    await knex.schema.alterTable('projects', (t) => {
      t.date('start_date');
      t.index('start_date');
    });
    console.log('  ✅ projects.start_date added');
  }

  if (!(await knex.schema.hasTable('project_schedule_overrides'))) {
    await knex.schema.createTable('project_schedule_overrides', (t) => {
      t.uuid('project_id').primary().references('id').inTable('projects').onDelete('CASCADE');
      t.boolean('works_saturday').notNullable().defaultTo(false);
      t.boolean('works_sunday').notNullable().defaultTo(false);
      t.timestamps(true, true);
    });
    console.log('  ✅ project_schedule_overrides table created');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('project_schedule_overrides')) {
    await knex.schema.dropTable('project_schedule_overrides');
  }
  if (await knex.schema.hasColumn('projects', 'start_date')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('start_date'));
  }
};
