/**
 * Migration: Terminology cleanup — schema additions only
 *
 * Enum value additions (user_role: scheduler/field_staff, contract_type: tm,
 * doc_type: vendor_quote) all happen in 20260505_002a_enum_additions.js,
 * which runs WITHOUT a transaction wrapper because Postgres requires
 * ALTER TYPE ADD VALUE statements to commit before the new values can
 * be used in DML.
 *
 * This migration only handles the non-enum schema work:
 *   - customer_code on customers
 *   - total_personnel + percent_billed on projects (with backfill)
 *   - global_variable toggle flags
 *   - role_configurations rows for scheduler + field_staff (the role_name
 *     column is a string, not the enum, so safe to insert here)
 *
 * Data migration (UPDATE users SET role='field_staff', UPDATE projects
 * SET contract_type='tm') happens in 003a, which is also safe because
 * 002a already committed the new enum values.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  // 1. customer_code (placeholder, future use)
  if (!(await knex.schema.hasColumn('customers', 'customer_code'))) {
    await knex.schema.alterTable('customers', (t) => { t.string('customer_code', 16); });
  }

  // 2. total_personnel + backfill from bid quotes
  if (!(await knex.schema.hasColumn('projects', 'total_personnel'))) {
    await knex.schema.alterTable('projects', (t) => { t.integer('total_personnel').defaultTo(0); });
  }
  await knex.raw(`
    UPDATE projects p SET total_personnel = sub.total
    FROM (
      SELECT b.id AS bid_id, COALESCE(SUM(bql.personnel), 0) AS total
      FROM bids b LEFT JOIN bid_quote_lines bql ON bql.bid_id = b.id GROUP BY b.id
    ) sub WHERE p.bid_id = sub.bid_id AND (p.total_personnel IS NULL OR p.total_personnel = 0)
  `);

  // 3. percent_billed + backfill
  if (!(await knex.schema.hasColumn('projects', 'percent_billed'))) {
    await knex.schema.alterTable('projects', (t) => { t.decimal('percent_billed', 6, 2).defaultTo(0); });
  }
  await knex.raw(`
    UPDATE projects p SET percent_billed = ROUND(
      CASE WHEN COALESCE(p.contract_value, 0) > 0
        THEN COALESCE(sub.total, 0) / p.contract_value * 100 ELSE 0 END, 2)
    FROM (
      SELECT project_id, SUM(amount) AS total FROM invoices
      WHERE status != 'cancelled' GROUP BY project_id
    ) sub WHERE p.id = sub.project_id
  `);

  // 4. Toggle global_variables for project number format.
  // (global_variables table only has key/value/description columns —
  // there's no value_type field, so booleans are stored as the strings
  // 'true'/'false' and parsed at read time, same pattern as the other
  // global vars seeded in the original schema migration.)
  for (const tg of [
    { key: 'project_id_use_customer_code', value: 'false',
      description: 'Include customer.customer_code in project number format. Default off; future toggle.' },
    { key: 'project_id_use_location_code', value: 'true',
      description: 'Include location.location_code in project number format. Default on.' },
  ]) {
    const existing = await knex('global_variables').where('key', tg.key).first();
    if (!existing) await knex('global_variables').insert(tg);
  }

  // 5. role_configurations: scheduler + field_staff
  //    role_configurations.role_name is a string column, NOT the user_role
  //    enum. So inserting 'field_staff' / 'scheduler' here is safe.
  //
  //    The 'permissions' column is NOT NULL with no default — every row
  //    must supply it. Scheduler ships with an empty permission set
  //    (placeholder role for future use). Field_staff inherits its
  //    permission list from the existing 'foreman' row when present.
  //
  //    JSONB ROUND-TRIP: when pg reads a jsonb column, it returns a
  //    parsed JS value (array/object). When inserting back, pg expects
  //    a string. Passing the raw parsed value into a jsonb column makes
  //    Postgres reject it as "invalid input syntax for type json". So
  //    when copying jsonb columns row-to-row, re-stringify them.
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));

  if (!(await knex('role_configurations').where('role_name', 'scheduler').first())) {
    await knex('role_configurations').insert({
      role_name: 'scheduler', display_name: 'Scheduler',
      bid_visibility: 'none', project_visibility: 'none',
      allowed_tabs: JSON.stringify([]),
      permissions: JSON.stringify([]),
    });
  }
  if (!(await knex('role_configurations').where('role_name', 'field_staff').first())) {
    const foremanCfg = await knex('role_configurations').where('role_name', 'foreman').first();
    if (foremanCfg) {
      await knex('role_configurations').insert({
        role_name: 'field_staff', display_name: 'Field Staff',
        bid_visibility: foremanCfg.bid_visibility,
        project_visibility: foremanCfg.project_visibility,
        allowed_tabs: stringifyJson(foremanCfg.allowed_tabs),
        permissions: stringifyJson(foremanCfg.permissions),
      });
    } else {
      await knex('role_configurations').insert({
        role_name: 'field_staff', display_name: 'Field Staff',
        bid_visibility: 'none', project_visibility: 'assigned',
        allowed_tabs: JSON.stringify(['active-projects', 'oil-samples', 'field-notes', 'notifications']),
        permissions: JSON.stringify([
          'projects:read',
          'oil_samples:read', 'oil_samples:create',
          'field_notes:read', 'field_notes:create', 'field_notes:update', 'field_notes:delete',
          'timesheets:read', 'timesheets:create',
          'notifications:read',
          'files:download',
        ]),
      });
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('projects', 'percent_billed')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('percent_billed'));
  }
  if (await knex.schema.hasColumn('projects', 'total_personnel')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('total_personnel'));
  }
  if (await knex.schema.hasColumn('customers', 'customer_code')) {
    await knex.schema.alterTable('customers', (t) => t.dropColumn('customer_code'));
  }
  await knex('role_configurations').where('role_name', 'scheduler').del();
  await knex('role_configurations').where('role_name', 'field_staff').del();
  await knex('global_variables').whereIn('key', ['project_id_use_customer_code', 'project_id_use_location_code']).del();
};
