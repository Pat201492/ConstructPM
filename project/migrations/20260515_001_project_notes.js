/**
 * Migration: Project notes + per-day schedule notes.
 *
 * Two note surfaces:
 *
 *   1. projects.notes — payment/admin tracking notes visible on the
 *      project detail page. Restricted to PM owner, accounting, admin,
 *      and superadmin. NOT broadcast to the field. Eventually
 *      superseded by the Invoices feature once enabled.
 *
 *      projects.notes_last_sent_at is kept in the schema (unused for
 *      now) in case a future "send to selected recipients" flow is
 *      added. Costs nothing to leave; dropping it would just churn.
 *
 *   2. project_day_notes — per-(project, date) note. Shown in the
 *      scheduler day popup. THIS is the only note channel that
 *      reaches workers, via the "Email Day to Staff" button. The
 *      button sends the day note plus project info and crew list —
 *      project-wide notes are intentionally excluded.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('projects', 'notes'))) {
    await knex.schema.alterTable('projects', (t) => {
      t.text('notes');
      t.timestamp('notes_last_sent_at');
    });
    console.log('  ✅ projects.notes + notes_last_sent_at added');
  }

  if (!(await knex.schema.hasTable('project_day_notes'))) {
    await knex.schema.createTable('project_day_notes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.date('work_date').notNullable();
      t.text('notes');
      t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
      t.unique(['project_id', 'work_date']);
      t.index(['project_id', 'work_date']);
    });
    console.log('  ✅ project_day_notes table created');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('project_day_notes')) {
    await knex.schema.dropTable('project_day_notes');
  }
  if (await knex.schema.hasColumn('projects', 'notes')) {
    await knex.schema.alterTable('projects', (t) => {
      t.dropColumn('notes');
      t.dropColumn('notes_last_sent_at');
    });
  }
};
