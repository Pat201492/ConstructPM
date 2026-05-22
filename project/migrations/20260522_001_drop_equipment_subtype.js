/**
 * Migration: Drop equipment_subtype columns.
 *
 * Per Pat (KISS, May 2026): equipment_subtype overlapped with
 * equipment_name in practice ("Cordless Drill" appeared in both columns
 * across most rows). Dropping it simplifies the request-ticket UX (3
 * cascading fields instead of 4) and removes a column that was rarely
 * used as an independent filter.
 *
 * Columns dropped:
 *   - equipment.equipment_subtype          (added by 20260508_001)
 *   - ticket_equipment.equipment_subtype   (added by 20260517_003)
 *
 * Reversal: re-running the original 20260508_001 + 20260517_003 ups will
 * recreate the columns, but the data is gone. Down here recreates the
 * columns empty.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (await knex.schema.hasColumn('equipment', 'equipment_subtype')) {
    await knex.schema.alterTable('equipment', (t) => t.dropColumn('equipment_subtype'));
    console.log('  ✅ equipment.equipment_subtype dropped');
  }
  if (await knex.schema.hasColumn('ticket_equipment', 'equipment_subtype')) {
    await knex.schema.alterTable('ticket_equipment', (t) => t.dropColumn('equipment_subtype'));
    console.log('  ✅ ticket_equipment.equipment_subtype dropped');
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn('equipment', 'equipment_subtype'))) {
    await knex.schema.alterTable('equipment', (t) => {
      t.string('equipment_subtype', 100);
      t.index('equipment_subtype');
    });
  }
  if (!(await knex.schema.hasColumn('ticket_equipment', 'equipment_subtype'))) {
    await knex.schema.alterTable('ticket_equipment', (t) => {
      t.string('equipment_subtype', 100);
    });
  }
};
