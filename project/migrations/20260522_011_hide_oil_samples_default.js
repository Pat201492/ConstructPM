/**
 * Migration: hide the Oil Samples tab by default.
 *
 * Pat: "oil samples should also be hidden currently it should be in
 * the same context of the superadmin autohide feature".
 *
 * Joins the existing pattern set up by migrations 20260513_001 (initial
 * feature flags) and 20260513_004 (oil samples + field notes seeded
 * as `true`). Flips `feature.oil_samples_enabled` to `false` so the
 * tab disappears for everyone unless a superadmin re-enables it from
 * the Superadmin → Features panel.
 *
 * UPSERT shape — if the row was previously deleted (some installs lost
 * it; current dev DB has the row missing entirely), the INSERT branch
 * adds it. If it already exists at any value, the DO UPDATE flips it
 * to 'false'.
 *
 * Existing user-side override mechanism (superadmin checkbox toggle in
 * the UI) still works — toggling the box in the admin panel writes back
 * to this same row.
 *
 * IDEMPOTENT — re-running is a no-op.
 */

exports.up = async function (knex) {
  await knex.raw(
    `INSERT INTO global_variables (key, value, description)
     VALUES (?, 'false', ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['feature.oil_samples_enabled', 'Show the Oil Samples tab']
  );
  console.log('  ✅ feature.oil_samples_enabled set to false (tab hidden by default)');
};

exports.down = async function (knex) {
  // Restore to the original seeded default (true) from migration 20260513_004.
  await knex('global_variables')
    .where('key', 'feature.oil_samples_enabled')
    .update({ value: 'true' });
};
