/**
 * Migration: drop the dead projects.fully_staffed column.
 *
 * Per-day fully_staffed moved to project_day_notes (20260518_001). The
 * project-level column has been ignored by every UI surface since but
 * was still being read in /scheduled-list and writable through the
 * project PATCH allowedFields — a foot-gun where a stray PATCH could
 * silently diverge from the per-day source of truth. The recent
 * codebase audit flagged this explicitly.
 *
 * up()   — drop the column.
 * down() — recreate as nullable boolean default false. No backfill;
 *           if you need to rebuild project-level state, derive it from
 *           project_day_notes.fully_staffed (e.g., all working days
 *           true → project_level true).
 */

exports.up = async function (knex) {
  if (await knex.schema.hasColumn('projects', 'fully_staffed')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('fully_staffed'));
    console.log('  ✅ projects.fully_staffed dropped');
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn('projects', 'fully_staffed'))) {
    await knex.schema.alterTable('projects', (t) => {
      t.boolean('fully_staffed').notNullable().defaultTo(false);
    });
  }
};
