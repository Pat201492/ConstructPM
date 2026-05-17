/**
 * Migration: add fully_staffed boolean to project_day_notes so the green ✓
 * can be marked per-day instead of project-wide.
 *
 * Pat's rule: clicking Fully Staffed in a day's popup only marks that day.
 * Propagation to other working days happens only when the scheduler clicks
 * "Copy this day's crew to all working days" — same atomic step that copies
 * the crew, see routes/projects.js copy-day handler.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('project_day_notes', 'fully_staffed'))) {
    await knex.schema.alterTable('project_day_notes', (t) => {
      t.boolean('fully_staffed').notNullable().defaultTo(false);
    });
    console.log('  ✅ project_day_notes.fully_staffed added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('project_day_notes', 'fully_staffed')) {
    await knex.schema.alterTable('project_day_notes', (t) => {
      t.dropColumn('fully_staffed');
    });
  }
};
