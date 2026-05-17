/**
 * Migration: Scheduler phase 2A — worker_assignments table.
 *
 * Each row is "this worker is assigned to this project on this date."
 * UNIQUE (worker_id, project_id, work_date) so a worker can be on
 * multiple projects on the same date if needed (no global one-day-one-
 * project constraint), but can't be double-booked on the same project
 * on the same date.
 *
 * created_by + notes carried for audit + future tooltips. The grid
 * (by-worker view, deferred) and clipboard ops will read/write this
 * table directly.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('worker_assignments'))) {
    await knex.schema.createTable('worker_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('worker_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.date('work_date').notNullable();
      t.text('notes');
      t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
      t.unique(['worker_id', 'project_id', 'work_date']);
      t.index(['project_id', 'work_date']);
      t.index(['worker_id', 'work_date']);
    });
    console.log('  ✅ worker_assignments table created');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('worker_assignments')) {
    await knex.schema.dropTable('worker_assignments');
  }
};
