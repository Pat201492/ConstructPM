/**
 * Migration: Add projects.fully_staffed.
 *
 * Per-project boolean toggle the scheduler flips when they consider the
 * project's crew "complete." Calendar cards render a green ✓ at the
 * front when this is true. Default false. No backfill — existing
 * projects start un-marked, and the scheduler updates them as they
 * confirm staffing.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('projects', 'fully_staffed'))) {
    await knex.schema.alterTable('projects', (t) => {
      t.boolean('fully_staffed').notNullable().defaultTo(false);
      t.index('fully_staffed');
    });
    console.log('  ✅ projects.fully_staffed added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('projects', 'fully_staffed')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('fully_staffed'));
  }
};
