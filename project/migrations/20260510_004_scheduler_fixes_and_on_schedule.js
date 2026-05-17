/**
 * Migration: Phase 1 scheduler fixes + "On Schedule" marker.
 *
 * Three changes:
 *
 * 1. projects.project_length_days
 *    The bid carries project_length_days but won-bid → project never
 *    transferred it. The scheduler calendar query needs it on the
 *    project row directly. Adds the column and backfills it from each
 *    project's source bid where available. Future wins should also
 *    carry it (handled in routes/bids.js confirm-won).
 *
 * 2. users.on_schedule (boolean, default false)
 *    Per Pat's design: only users marked "on schedule" appear in the
 *    scheduler — both as assignable workers and as rows in the
 *    By-Worker grid. Defaults applied based on role for sensible
 *    out-of-the-box behavior (field staff and project_managers true,
 *    everyone else false).
 *
 * 3. role_configurations.on_schedule_default (boolean, default false)
 *    Role-level default. When admin creates a new user with that role,
 *    user.on_schedule inherits this default. Per-user override via the
 *    user edit form remains.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  // ── 1. projects.project_length_days ──────────────────────
  if (!(await knex.schema.hasColumn('projects', 'project_length_days'))) {
    await knex.schema.alterTable('projects', (t) => {
      t.integer('project_length_days');
      t.index('project_length_days');
    });
    console.log('  ✅ projects.project_length_days added');

    // Backfill from source bid where available
    await knex.raw(`
      UPDATE projects p
      SET project_length_days = b.project_length_days
      FROM bids b
      WHERE p.bid_id = b.id
        AND b.project_length_days IS NOT NULL
        AND p.project_length_days IS NULL
    `);
    console.log('  ✅ projects.project_length_days backfilled from source bids');
  }

  // ── 2. users.on_schedule ────────────────────────────────
  if (!(await knex.schema.hasColumn('users', 'on_schedule'))) {
    await knex.schema.alterTable('users', (t) => {
      t.boolean('on_schedule').notNullable().defaultTo(false);
      t.index('on_schedule');
    });
    console.log('  ✅ users.on_schedule added');

    // Sensible default backfill: field_staff + project_manager are
    // typically the people you'd schedule. Other roles default false.
    await knex('users')
      .whereIn('role', ['field_staff', 'project_manager'])
      .update({ on_schedule: true });
    console.log('  ✅ users.on_schedule defaulted true for field_staff + project_manager');
  }

  // ── 3. role_configurations.on_schedule_default ──────────
  if (!(await knex.schema.hasColumn('role_configurations', 'on_schedule_default'))) {
    await knex.schema.alterTable('role_configurations', (t) => {
      t.boolean('on_schedule_default').notNullable().defaultTo(false);
    });
    console.log('  ✅ role_configurations.on_schedule_default added');

    // Apply role-level defaults to match the user backfill
    await knex('role_configurations')
      .whereIn('role_name', ['field_staff', 'project_manager'])
      .update({ on_schedule_default: true });
    console.log('  ✅ role_configurations.on_schedule_default set true for field_staff + project_manager');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('role_configurations', 'on_schedule_default')) {
    await knex.schema.alterTable('role_configurations', (t) => t.dropColumn('on_schedule_default'));
  }
  if (await knex.schema.hasColumn('users', 'on_schedule')) {
    await knex.schema.alterTable('users', (t) => t.dropColumn('on_schedule'));
  }
  if (await knex.schema.hasColumn('projects', 'project_length_days')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('project_length_days'));
  }
};
