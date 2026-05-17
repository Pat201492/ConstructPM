/**
 * Migration: Foreman project visibility
 *
 * Foremen previously had project_visibility = 'assigned' — the projects API
 * filtered to only their assigned projects. This blocked the mobile picker
 * from letting them tag any active project (which they need, since field
 * crews routinely help on jobs they aren't formally assigned to).
 *
 * Change:
 *   1. Update foreman role_configurations.project_visibility: 'assigned' → 'all'
 *
 * Idempotent — safe to run on databases where the value is already 'all'.
 */

exports.up = async function (knex) {
  const updated = await knex('role_configurations')
    .where('role_name', 'foreman')
    .where('project_visibility', 'assigned')
    .update({ project_visibility: 'all' });

  if (updated > 0) {
    console.log('  ✅ Foreman project_visibility: assigned → all');
  } else {
    console.log('  ⏭️  Foreman project_visibility already updated or role missing');
  }
};

exports.down = async function (knex) {
  await knex('role_configurations')
    .where('role_name', 'foreman')
    .where('project_visibility', 'all')
    .update({ project_visibility: 'assigned' });
};
