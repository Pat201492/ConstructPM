/**
 * Migration: vendor_quote doc_type — NO-OP
 *
 * The 'vendor_quote' enum value is now added in
 * 20260505_002a_enum_additions.js (consolidated with all other enum
 * additions for transaction-safety reasons).
 *
 * This file is kept as a no-op so the migration history doesn't show a
 * gap. If you're applying migrations to a database that has already run
 * an earlier version of this file, the idempotent ADD VALUE in 002a
 * means re-running won't cause harm — Postgres simply skips additions
 * for values that already exist.
 */

exports.up = async function (knex) {
  // Intentionally empty. See 20260505_002a_enum_additions.js
};

exports.down = async function (knex) {
  // Intentionally empty.
};
