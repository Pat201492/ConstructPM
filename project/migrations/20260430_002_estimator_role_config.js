/**
 * Migration: Seed estimator role configuration
 *
 * Runs in a separate migration from the enum-add to satisfy Postgres's
 * ordering constraint — a new enum value cannot be referenced in the same
 * transaction it was added in.
 *
 * Estimator config:
 *   - bid_visibility: 'own'         — sees their own bids + bids assigned to them
 *                                     (the visibility helper handles the "assigned to them"
 *                                     part by also matching on assigned_pm_id; for estimators
 *                                     it doesn't trigger because they're never the assigned PM)
 *   - project_visibility: 'originated' — read-only on projects whose source bid was theirs
 *                                        (new visibility level, handled in resolveProjectVisibility)
 *   - allowed_tabs: dashboard, bids, projects (read-only), notifications
 *   - permissions: bids:create, bids:read, bids:update on own; projects:read on originated
 */

exports.up = async function (knex) {
  const exists = await knex('role_configurations').where('role_name', 'estimator').first();
  if (exists) {
    console.log('  ⏭️  estimator role_configuration already present');
    return;
  }

  await knex('role_configurations').insert({
    role_name: 'estimator',
    display_name: 'Estimator',
    is_system: true,
    bid_visibility: 'own',
    project_visibility: 'originated',  // new level: read-only on projects whose source bid was theirs
    description: 'Creates and manages bids, may assign them to a project manager. Read-only access to projects originated from their bids after winning.',
    allowed_tabs: JSON.stringify([
      'dashboard',
      'bids',
      'projects',       // shown read-only via project_visibility='originated'
      'notifications',
    ]),
    permissions: JSON.stringify([
      'bids:read',
      'bids:create',
      'bids:update',
      'bids:mark_won',
      'projects:read',  // read-only enforced by visibility, not permission
      'files:upload',
      'files:download',
    ]),
  });

  console.log('  ✅ estimator role_configuration seeded');
};

exports.down = async function (knex) {
  await knex('role_configurations').where('role_name', 'estimator').delete();
};
