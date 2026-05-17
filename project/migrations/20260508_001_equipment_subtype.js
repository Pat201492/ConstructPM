/**
 * Migration: Add equipment_subtype column.
 *
 * The existing equipment.equipment_type acts as a top-level category
 * ("Power Tool", "Test Equipment", "Vehicle"). Pat asked for a sub-type
 * column so categorization can be more specific without forcing every
 * top-level type to be unique:
 *
 *   equipment_type   = "Power Tool",   equipment_subtype = "Drill"
 *   equipment_type   = "Power Tool",   equipment_subtype = "Saw"
 *   equipment_type   = "Test Equipment", equipment_subtype = "Megger"
 *
 * Free-text string. Indexed since users will filter by it. Nullable to
 * keep existing rows valid.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('equipment', 'equipment_subtype'))) {
    await knex.schema.alterTable('equipment', (t) => {
      t.string('equipment_subtype', 100);
      t.index('equipment_subtype');
    });
    console.log('  ✅ equipment.equipment_subtype added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('equipment', 'equipment_subtype')) {
    await knex.schema.alterTable('equipment', (t) => t.dropColumn('equipment_subtype'));
  }
};
