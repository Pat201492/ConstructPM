/**
 * Migration: Estimator role + bid PM assignment
 *
 * Introduces the estimator workflow:
 *   - Estimators create bids and may assign them to a PM
 *   - PM defaults to the estimator if not set (so existing single-role flows still work)
 *   - Once a PM is assigned, both the estimator AND the PM can see + edit the bid
 *   - When a bid is won, the project belongs to the assigned PM (or estimator if no PM was assigned)
 *   - After win, estimators retain READ-ONLY visibility into projects they originated
 *
 * Changes:
 *   1. Add 'estimator' to the user_role enum
 *   2. Add bids.assigned_pm_id column (nullable FK)
 *   3. Seed estimator role configuration (bid_visibility, project_visibility, etc.)
 *
 * Idempotent — checks before adding enum value.
 */

exports.up = async function (knex) {
  // 1. Add 'estimator' to user_role enum
  const estimatorCheck = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumlabel = 'estimator'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
    ) as has_estimator
  `);
  if (!estimatorCheck.rows[0].has_estimator) {
    await knex.raw(`ALTER TYPE user_role ADD VALUE 'estimator'`);
    console.log('  ✅ user_role: estimator value added');
  } else {
    console.log('  ⏭️  user_role.estimator already present');
  }

  // 2. Add bids.assigned_pm_id (only if missing)
  const hasCol = await knex.schema.hasColumn('bids', 'assigned_pm_id');
  if (!hasCol) {
    await knex.schema.alterTable('bids', (t) => {
      t.uuid('assigned_pm_id').references('id').inTable('users').onDelete('SET NULL');
      t.index('assigned_pm_id');
    });
    console.log('  ✅ bids.assigned_pm_id added');
  } else {
    console.log('  ⏭️  bids.assigned_pm_id already present');
  }

  // 3. Seed estimator role configuration
  // (Run in a separate transaction since we just added the enum value;
  //  Postgres requires a commit before the new value is usable in some contexts.)
};

// We need a separate function that runs AFTER the enum commit because
// Postgres can be picky about ALTER TYPE ADD VALUE within the same transaction
// as a query that uses the new value. Knex handles each migration in a
// transaction, so we structure the seed in a follow-up migration.
exports.down = async function (knex) {
  // Removing values from a Postgres enum requires recreating the type.
  // For local-dev simplicity, we just drop the column on rollback.
  const hasCol = await knex.schema.hasColumn('bids', 'assigned_pm_id');
  if (hasCol) {
    await knex.schema.alterTable('bids', (t) => {
      t.dropColumn('assigned_pm_id');
    });
  }
  // Note: the enum value 'estimator' is intentionally left in place on rollback.
  // It's harmless to keep, and removing it would require recreating the enum
  // and updating every dependent column (users.role) — too risky for a rollback.
};
