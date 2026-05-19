/**
 * Move equipment.cert_expiry_alert_days from a per-row column to a
 * single global setting.
 *
 * Pat: cert alerts should be configured once for the firm, not
 * per equipment item. The Equipment add/edit forms no longer ask
 * for it; Admin → Global Variables now exposes one
 * `cert_expiry_alert_days` row.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  // Seed the global default (or keep an existing value if already set).
  const existing = await knex('global_variables')
    .where({ key: 'cert_expiry_alert_days' })
    .first();
  if (!existing) {
    await knex('global_variables').insert({
      key: 'cert_expiry_alert_days',
      value: '30',
      description: 'Days before a certification-date expiry to surface an alert (applies to all equipment)',
    });
  }

  if (await knex.schema.hasColumn('equipment', 'cert_expiry_alert_days')) {
    await knex.schema.alterTable('equipment', (t) => {
      t.dropColumn('cert_expiry_alert_days');
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn('equipment', 'cert_expiry_alert_days'))) {
    await knex.schema.alterTable('equipment', (t) => {
      t.integer('cert_expiry_alert_days').defaultTo(30);
    });
  }
  await knex('global_variables').where({ key: 'cert_expiry_alert_days' }).delete();
};
