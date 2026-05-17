/**
 * Migration: PM codes and location codes for structured project numbers
 *
 * Adds two columns to support the new project number format: J26-1308.8
 *   J    = pm_code (single uppercase letter, unique among PMs)
 *   26   = year (2-digit)
 *   1308 = location_code (free text per location)
 *   .8   = the 8th project this PM has done at this location this year
 *
 * Changes:
 *   1. users.pm_code     — varchar(1), nullable (only PMs/admins use it)
 *   2. locations.location_code — varchar(20), nullable for now (existing rows)
 *
 * After migration, admin should backfill existing PMs and locations through
 * the admin UI before the new flow is used. New users/locations created via
 * the admin UI will have these fields populated up-front.
 */

exports.up = async function (knex) {
  // 1. users.pm_code
  await knex.schema.alterTable('users', (t) => {
    t.string('pm_code', 1);
    // Don't enforce uniqueness yet — existing seeded users have no code.
    // The admin UI / API will enforce uniqueness on insert/update.
  });
  console.log('  ✅ users.pm_code added');

  // 2. locations.location_code
  await knex.schema.alterTable('locations', (t) => {
    t.string('location_code', 20);
  });
  console.log('  ✅ locations.location_code added');

  // 3. Partial unique index on users.pm_code (ignores nulls)
  await knex.raw(`
    CREATE UNIQUE INDEX users_pm_code_unique
    ON users (pm_code)
    WHERE pm_code IS NOT NULL
  `);
  console.log('  ✅ users.pm_code unique index created');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS users_pm_code_unique');
  await knex.schema.alterTable('users', (t) => t.dropColumn('pm_code'));
  await knex.schema.alterTable('locations', (t) => t.dropColumn('location_code'));
};
