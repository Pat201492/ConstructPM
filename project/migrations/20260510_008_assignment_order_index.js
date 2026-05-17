/**
 * Migration: worker_assignments.order_index.
 *
 * Per Pat's spec: when a worker is on multiple projects on the same day,
 * the By-Worker view (extended mode) stacks the project numbers
 * vertically in a deliberate order — and the scheduler can drag to
 * reorder them. This column stores that order.
 *
 * Scope: ordering is per-worker-per-day. Within a (worker_id, work_date)
 * group, order_index runs 0..N-1 in render order. Across days/workers
 * the values are independent.
 *
 * Default 0 — fine for existing rows since they'll all share the same
 * order until a scheduler actively reorders. Re-balancing happens
 * server-side on the reorder endpoint.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('worker_assignments', 'order_index'))) {
    await knex.schema.alterTable('worker_assignments', (t) => {
      t.integer('order_index').notNullable().defaultTo(0);
    });
    console.log('  ✅ worker_assignments.order_index added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('worker_assignments', 'order_index')) {
    await knex.schema.alterTable('worker_assignments', (t) => t.dropColumn('order_index'));
  }
};
