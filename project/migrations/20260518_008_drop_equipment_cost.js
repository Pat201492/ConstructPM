/**
 * Drop equipment.equipment_cost.
 *
 * Equipment no longer tracks a daily rental rate. The column fed the
 * per-project equipment cost rollup in Project.getFinancialSummary
 * (sum of days_checked_out × daily_rate), and that calc is removed in
 * the same change — project total_cost no longer includes equipment.
 */

exports.up = async function (knex) {
  if (await knex.schema.hasColumn('equipment', 'equipment_cost')) {
    await knex.schema.alterTable('equipment', (t) => {
      t.dropColumn('equipment_cost');
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn('equipment', 'equipment_cost'))) {
    await knex.schema.alterTable('equipment', (t) => {
      t.decimal('equipment_cost', 10, 2).defaultTo(0);
    });
  }
};
