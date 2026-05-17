/**
 * Migration: Enum additions (split out from terminology cleanup)
 *
 * Why this is its own migration:
 *
 * Postgres has a strict rule: a new enum value added via ALTER TYPE ...
 * ADD VALUE cannot be USED in the same transaction that added it. The
 * value must be committed first. The error message is:
 *
 *   "unsafe use of new value 'X' of enum type ..."
 *
 * Knex wraps each migration in a transaction by default. So if a single
 * migration tries to ALTER TYPE and then UPDATE rows to use the new
 * value, it fails.
 *
 * Solution: do all the enum-add work in this migration with transactions
 * disabled (each ALTER TYPE auto-commits independently). The next
 * migration (20260505_003_terminology_cleanup) is then free to use the
 * new values in its UPDATEs because they're already committed.
 *
 * This split is mandatory whenever a migration both adds enum values AND
 * uses them in the same file. If you ever add another enum value and
 * want to migrate data to use it, follow the same split pattern.
 */

// IMPORTANT: disable Knex's transaction wrapper so each ALTER TYPE
// commits on its own. Without this, all the ADD VALUE statements
// would run in one big transaction, defeating the purpose.
exports.config = { transaction: false };

exports.up = async function (knex) {
  // user_role: scheduler + field_staff
  const userRoleVals = await knex.raw(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  `);
  const userRoleSet = new Set(userRoleVals.rows.map(r => r.enumlabel));

  if (!userRoleSet.has('scheduler')) {
    await knex.raw(`ALTER TYPE user_role ADD VALUE 'scheduler'`);
    console.log('  ✅ user_role: scheduler added');
  }
  if (!userRoleSet.has('field_staff')) {
    await knex.raw(`ALTER TYPE user_role ADD VALUE 'field_staff'`);
    console.log('  ✅ user_role: field_staff added');
  }

  // contract_type: tm
  const ctVals = await knex.raw(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'contract_type')
  `);
  const ctSet = new Set(ctVals.rows.map(r => r.enumlabel));
  if (!ctSet.has('tm')) {
    await knex.raw(`ALTER TYPE contract_type ADD VALUE 'tm'`);
    console.log('  ✅ contract_type: tm added');
  }

  // doc_type: vendor_quote (consolidated here so all enum additions are
  // in one place. The original 20260505_004 migration is now a no-op
  // because this runs first and idempotency makes the second add safe.)
  const docTypeVals = await knex.raw(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'doc_type')
  `);
  const docTypeSet = new Set(docTypeVals.rows.map(r => r.enumlabel));
  if (!docTypeSet.has('vendor_quote')) {
    await knex.raw(`ALTER TYPE doc_type ADD VALUE 'vendor_quote'`);
    console.log('  ✅ doc_type: vendor_quote added');
  }
};

exports.down = async function (knex) {
  // Postgres can't drop enum values without recreating the type. Leave alone.
  // The values stay as harmless additions to the enum.
};
