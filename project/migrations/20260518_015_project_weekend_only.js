/**
 * Migration: project_schedule_overrides.weekend_only
 *
 * Adds a "weekend only" mode to the project scheduler. When true, the
 * project schedules on Sat + Sun and skips Mon-Fri — the inverse of the
 * default M-F behavior. The existing works_saturday / works_sunday flags
 * are left intact and simply ignored while weekend_only is on, so
 * toggling it off restores the user's prior Sat/Sun preferences.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('project_schedule_overrides', 'weekend_only'))) {
    await knex.schema.alterTable('project_schedule_overrides', (t) => {
      t.boolean('weekend_only').notNullable().defaultTo(false);
    });
    console.log('  ✅ project_schedule_overrides.weekend_only added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('project_schedule_overrides', 'weekend_only')) {
    await knex.schema.alterTable('project_schedule_overrides', (t) => t.dropColumn('weekend_only'));
  }
};
