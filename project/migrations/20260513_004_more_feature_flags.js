/**
 * Migration: Two more feature flags — oil samples + field notes.
 *
 * Extends the feature-flag system from 20260513_001 with two more
 * toggleable areas. Same pattern: rows in global_variables prefixed
 * `feature.`, default true so existing installs lose nothing.
 *
 * IDEMPOTENT — ON CONFLICT DO NOTHING.
 */

const NEW_FLAGS = [
  { key: 'feature.oil_samples_enabled', value: 'true', description: 'Show the Oil Samples tab' },
  { key: 'feature.field_notes_enabled', value: 'true', description: 'Show the Field Notes tab' },
];

exports.up = async function (knex) {
  for (const flag of NEW_FLAGS) {
    await knex.raw(
      `INSERT INTO global_variables (key, value, description) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`,
      [flag.key, flag.value, flag.description]
    );
  }
  console.log(`  ✅ ${NEW_FLAGS.length} feature flags seeded (oil samples, field notes)`);
};

exports.down = async function (knex) {
  for (const flag of NEW_FLAGS) {
    await knex('global_variables').where('key', flag.key).del();
  }
};
