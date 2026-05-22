/**
 * Migration: add `grouping` JSONB column to saved_exports.
 *
 * Pat: "remember as well, if the teir groupping thing exists there
 * needs to be excel templates that are either modular enough to
 * accomdate the if those multiple levels exist or numerous enough to
 * achieve the same goal".
 *
 * Shape (JS):
 *   {
 *     "levels":  ["pm_name", "customer_name", "status"],  // 0..3 keys
 *     "sortBy":  "primary_number",                        // optional
 *     "sortDir": "asc"                                    // 'asc' | 'desc'
 *   }
 *
 * Stored as JSONB so the validator + ExportBuilder can read it without
 * a follow-up JSON.parse on every load. Nullable — existing rows keep
 * working without modification (no grouping = flat output, same as
 * before).
 *
 * IDEMPOTENT — guarded by hasColumn.
 */

exports.up = async function (knex) {
  const exists = await knex.schema.hasColumn('saved_exports', 'grouping');
  if (exists) {
    console.log('  (saved_exports.grouping already present — skipping)');
    return;
  }
  await knex.schema.alterTable('saved_exports', (t) => {
    t.jsonb('grouping').nullable();
  });
  console.log('  ✅ saved_exports.grouping (JSONB) added');
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasColumn('saved_exports', 'grouping');
  if (!exists) return;
  await knex.schema.alterTable('saved_exports', (t) => {
    t.dropColumn('grouping');
  });
};
