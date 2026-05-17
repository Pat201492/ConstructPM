/**
 * Migration: Terminology cleanup — Part 2 (data migration using new enum values)
 *
 * Runs after 20260505_003 commits its ALTER TYPE statements. By the time
 * this migration executes, 'field_staff' and 'tm' are committed enum
 * values and safe to use in DML.
 *
 * What this does:
 *   - Migrates any users with role='foreman' to role='field_staff'
 *   - Migrates any projects with contract_type='t_and_m' to 'tm'
 *
 * The 'foreman' and 't_and_m' enum values still exist in the type
 * definitions because Postgres can't drop enum values without recreating
 * the entire type. They linger harmlessly — no code uses them anymore.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  const foremanCount = await knex('users').where('role', 'foreman').count('* as c').first();
  if (parseInt(foremanCount.c) > 0) {
    await knex('users').where('role', 'foreman').update({ role: 'field_staff' });
    console.log(`  ✅ Migrated ${foremanCount.c} 'foreman' users to 'field_staff'`);
  }

  const tamCount = await knex('projects').where('contract_type', 't_and_m').count('* as c').first();
  if (parseInt(tamCount.c) > 0) {
    await knex('projects').where('contract_type', 't_and_m').update({ contract_type: 'tm' });
    console.log(`  ✅ Migrated ${tamCount.c} project(s) from contract_type='t_and_m' to 'tm'`);
  }
};

exports.down = async function (knex) {
  // Reverse direction
  await knex('users').where('role', 'field_staff').update({ role: 'foreman' });
  await knex('projects').where('contract_type', 'tm').update({ contract_type: 't_and_m' });
};
