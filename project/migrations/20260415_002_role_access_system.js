/**
 * Migration: Add role configurations, bid assignments, user access overrides.
 * 
 * This is an incremental migration — safe to run on existing databases.
 * Adds tables and columns that were previously only in the base migration
 * when doing fresh installs with -v.
 * 
 * After this migration, you never need `docker compose down -v` again.
 * Just `docker compose down && docker compose up --build`.
 */

exports.up = async function (knex) {
  // ── ROLE CONFIGURATIONS ──────────────────────────────────
  if (!(await knex.schema.hasTable('role_configurations'))) {
    await knex.schema.createTable('role_configurations', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('role_name', 50).notNullable().unique();
      t.string('display_name', 100).notNullable();
      t.jsonb('allowed_tabs').notNullable();
      t.jsonb('permissions').notNullable();
      t.string('bid_visibility', 20).notNullable().defaultTo('own');
      t.string('project_visibility', 20).notNullable().defaultTo('own');
      t.boolean('is_system').notNullable().defaultTo(false);
      t.text('description');
      t.timestamps(true, true);
    });

    // Seed defaults
    await knex('role_configurations').insert([
      { role_name: 'admin', display_name: 'Admin', is_system: true, bid_visibility: 'all', project_visibility: 'all',
        description: 'Full system access.',
        allowed_tabs: JSON.stringify(['dashboard','bids','projects','financials','inbox','timesheets','notifications','equipment','exports','admin']),
        permissions: JSON.stringify(['*']) },
      { role_name: 'project_manager', display_name: 'Project Manager', is_system: true, bid_visibility: 'own', project_visibility: 'own',
        description: 'Creates bids, manages projects, verifies invoices and POs.',
        allowed_tabs: JSON.stringify(['dashboard','bids','projects','financials','inbox','timesheets','notifications','equipment','exports']),
        permissions: JSON.stringify(['bids:*','projects:*','extractions:confirm','equipment:request','files:*']) },
      { role_name: 'accounting', display_name: 'Accounting', is_system: true, bid_visibility: 'all', project_visibility: 'all',
        description: 'Read-only project access. CSV exports.',
        allowed_tabs: JSON.stringify(['dashboard','projects','financials','inbox','timesheets','notifications','exports']),
        permissions: JSON.stringify(['projects:read','exports:*','timesheets:read']) },
      { role_name: 'shop_staff', display_name: 'Shop Staff', is_system: true, bid_visibility: 'none', project_visibility: 'none',
        description: 'Equipment management, checkout/return, fulfill requests.',
        allowed_tabs: JSON.stringify(['notifications','equipment']),
        permissions: JSON.stringify(['equipment:*','inventory:*']) },
      { role_name: 'field_staff', display_name: 'Field Staff', is_system: true, bid_visibility: 'none', project_visibility: 'assigned',
        description: 'View assigned projects. Upload timesheets.',
        allowed_tabs: JSON.stringify(['projects','inbox','notifications']),
        permissions: JSON.stringify(['projects:read','files:upload']) },
    ]);
    console.log('  ✅ role_configurations created + seeded');
  }

  // ── BID ASSIGNMENTS ──────────────────────────────────────
  if (!(await knex.schema.hasTable('bid_assignments'))) {
    await knex.schema.createTable('bid_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('bid_id').notNullable().references('id').inTable('bids').onDelete('CASCADE');
      t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.timestamps(true, true);
      t.unique(['bid_id', 'user_id']);
      t.index('user_id');
    });
    console.log('  ✅ bid_assignments created');
  }

  // ── USER ACCESS COLUMNS ──────────────────────────────────
  if (!(await knex.schema.hasColumn('users', 'tab_overrides'))) {
    await knex.schema.alterTable('users', (t) => {
      t.jsonb('tab_overrides');
      t.jsonb('access_config');
    });
    console.log('  ✅ users.tab_overrides + access_config added');
  }

  if (!(await knex.schema.hasColumn('users', 'default_markup_pct'))) {
    await knex.schema.alterTable('users', (t) => {
      t.decimal('default_markup_pct', 5, 2).defaultTo(15);
    });
    console.log('  ✅ users.default_markup_pct added');
  }

  // ── TIMESHEET WEEKLY COLUMNS ─────────────────────────────
  if (!(await knex.schema.hasColumn('timesheets', 'week_ending'))) {
    await knex.schema.alterTable('timesheets', (t) => {
      t.date('week_ending');
      t.integer('days_worked').defaultTo(5);
    });
    // Backfill: set week_ending = work_date for existing rows
    await knex.raw("UPDATE timesheets SET week_ending = work_date WHERE week_ending IS NULL");
    console.log('  ✅ timesheets.week_ending + days_worked added');
  }

  if (!(await knex.schema.hasColumn('timesheets', 'daily_details'))) {
    await knex.schema.alterTable('timesheets', (t) => {
      t.jsonb('daily_details');
      t.decimal('per_diem_rate', 8, 2).defaultTo(0);
      t.decimal('per_diem_total', 10, 2).defaultTo(0);
    });
    console.log('  ✅ timesheets.daily_details + per_diem added');
  }

  // ── BID TEMPLATES COLUMNS ────────────────────────────────
  if (!(await knex.schema.hasColumn('bid_templates', 'template_type'))) {
    await knex.schema.alterTable('bid_templates', (t) => {
      t.string('template_type', 20).defaultTo('bid');
      t.string('template_name', 255);
      t.string('original_filename', 255);
    });
    // Drop unique constraint on pm_id if exists (PM can have multiple templates now)
    try { await knex.raw('ALTER TABLE bid_templates DROP CONSTRAINT IF EXISTS bid_templates_pm_id_unique'); } catch {}
    console.log('  ✅ bid_templates.template_type + template_name + original_filename added');
  }

  // ── USERS INITIALS (if missing) ──────────────────────────
  if (!(await knex.schema.hasColumn('users', 'initials'))) {
    await knex.schema.alterTable('users', (t) => {
      t.string('initials', 10);
    });
    console.log('  ✅ users.initials added');
  }

  console.log('  Migration complete — all schema additions applied.');

  // ── STORAGE PATH GLOBALS (if not already seeded) ─────────
  const storageGlobals = [
    { key: 'storage_base_path', value: '', description: 'Root folder for all files (leave blank to use STORAGE_BASE_PATH env var or ./storage)' },
    { key: 'storage_bids_path', value: '', description: 'Custom path for bid folders (leave blank for {base}/bids/)' },
    { key: 'storage_projects_path', value: '', description: 'Custom path for project folders (leave blank for {base}/projects/)' },
    { key: 'storage_templates_path', value: '', description: 'Custom path for templates (leave blank for {base}/templates/)' },
    { key: 'filewatcher_interval_hours', value: '24', description: 'How often the system checks for overdue invoices, stale bids, etc. (hours)' },
    { key: 'filewatcher_run_at_hour', value: '0', description: 'Hour of day (0-23) to run the first check. 0 = midnight.' },
  ];
  for (const g of storageGlobals) {
    const exists = await knex('global_variables').where('key', g.key).first();
    if (!exists) {
      await knex('global_variables').insert(g);
      console.log(`  ✅ global variable '${g.key}' added`);
    }
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bid_assignments');
  await knex.schema.dropTableIfExists('role_configurations');
  if (await knex.schema.hasColumn('users', 'tab_overrides')) {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('tab_overrides');
      t.dropColumn('access_config');
    });
  }
  if (await knex.schema.hasColumn('bid_templates', 'template_type')) {
    await knex.schema.alterTable('bid_templates', (t) => {
      t.dropColumn('template_type');
      t.dropColumn('template_name');
      t.dropColumn('original_filename');
    });
  }
};
