/**
 * Migration: Phase 2 — Equipment maintenance + rollups.
 *
 * 1. EQUIPMENT new columns
 *    - equipment_subtype        : cascades under equipment_type
 *    - service_date             : rolled up = most recent maintenance
 *                                 record's date_of_service
 *    - rolled_cert_date         : rolled up = furthest-future cert from
 *                                 maintenance records, else nearest-to-
 *                                 today if none in the future. (Kept
 *                                 separate from the legacy
 *                                 certification_date so existing data /
 *                                 alert logic is undisturbed; the UI
 *                                 reads rolled_cert_date.)
 *    - flag                     : 'red' | 'yellow' | null — copied from
 *                                 the most recent maintenance record
 *    - status_change_date       : stamped when location changes
 *                                 (picked up to a project / returned)
 *
 * 2. equipment_maintenance_records — ONE table keyed by equipment_id
 *    (Pat confirmed: one big table, presented per-equipment in the UI
 *    as "<EquipID> - Maintenance Record"). Columns: date_of_service
 *    (defaults today), entered_by_name (defaults current user,
 *    editable), cert_date, notes, flag.
 *
 * 3. global_variables threshold seeds — cert + maintenance warning
 *    day-offsets, admin-editable, defaults green=30 / yellow=14 /
 *    red=3 (red also covers overdue).
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  // ── 1. equipment columns ─────────────────────────────────────
  const addCols = [];
  if (!(await knex.schema.hasColumn('equipment', 'equipment_subtype'))) addCols.push('equipment_subtype');
  if (!(await knex.schema.hasColumn('equipment', 'service_date'))) addCols.push('service_date');
  if (!(await knex.schema.hasColumn('equipment', 'rolled_cert_date'))) addCols.push('rolled_cert_date');
  if (!(await knex.schema.hasColumn('equipment', 'flag'))) addCols.push('flag');
  if (!(await knex.schema.hasColumn('equipment', 'status_change_date'))) addCols.push('status_change_date');
  if (addCols.length) {
    await knex.schema.alterTable('equipment', (t) => {
      if (addCols.includes('equipment_subtype')) t.string('equipment_subtype', 100);
      if (addCols.includes('service_date')) t.date('service_date');
      if (addCols.includes('rolled_cert_date')) t.date('rolled_cert_date');
      if (addCols.includes('flag')) t.string('flag', 10); // 'red' | 'yellow' | null
      if (addCols.includes('status_change_date')) t.date('status_change_date');
    });
    console.log(`  ✅ equipment: ${addCols.join(', ')}`);
  }

  // ── 2. equipment_maintenance_records ─────────────────────────
  if (!(await knex.schema.hasTable('equipment_maintenance_records'))) {
    await knex.schema.createTable('equipment_maintenance_records', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('equipment_id').notNullable()
        .references('id').inTable('equipment').onDelete('CASCADE');
      t.date('date_of_service').notNullable(); // defaults to today in the route
      t.string('entered_by_name', 255);        // defaults to current user, editable
      t.uuid('entered_by_id').references('id').inTable('users').onDelete('SET NULL');
      t.date('cert_date');                     // copied from prior entry on the client
      t.text('notes');
      t.string('flag', 10);                    // 'red' | 'yellow' | null
      t.timestamps(true, true);
      t.index(['equipment_id', 'date_of_service']);
    });
    console.log('  ✅ equipment_maintenance_records created');
  }

  // ── 3. threshold settings ────────────────────────────────────
  // Cert + maintenance both use the same green/yellow/red day model.
  // Pat: make them editable, with these as defaults.
  const seeds = [
    ['equipment.cert_green_days', '30', 'Cert warning: green when this many days out'],
    ['equipment.cert_yellow_days', '14', 'Cert warning: yellow when this many days out'],
    ['equipment.cert_red_days', '3', 'Cert warning: red when this many days out (or overdue)'],
    ['equipment.maint_interval_days', '90', 'Days between required maintenance'],
    ['equipment.maint_green_days', '30', 'Maintenance warning: green when this many days out'],
    ['equipment.maint_yellow_days', '14', 'Maintenance warning: yellow when this many days out'],
    ['equipment.maint_red_days', '3', 'Maintenance warning: red when this many days out (or overdue)'],
  ];
  for (const [key, value, description] of seeds) {
    await knex.raw(
      `INSERT INTO global_variables (key, value, description)
       VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`,
      [key, value, description]
    );
  }
  console.log(`  ✅ ${seeds.length} equipment threshold settings seeded`);
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('equipment_maintenance_records')) {
    await knex.schema.dropTable('equipment_maintenance_records');
  }
  for (const col of ['equipment_subtype', 'service_date', 'rolled_cert_date', 'flag', 'status_change_date']) {
    if (await knex.schema.hasColumn('equipment', col)) {
      await knex.schema.alterTable('equipment', (t) => t.dropColumn(col));
    }
  }
  await knex('global_variables').where('key', 'like', 'equipment.%').del();
};
