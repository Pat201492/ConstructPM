/**
 * Migration: Mobile App Additions + Phase 2 Schema
 * 
 * Changes:
 *   1. Rename user_role enum value: field_staff → foreman
 *   2. New enum: oil_sample_status
 *   3. Add doc_type enum value: oil_sample_request
 *   4. New table: field_notes
 *   5. New table: oil_sample_requests
 *   6. New table: form_templates
 *   7. New FK: equipment_requests.assigned_foreman_id
 *   8. Per diem fields on bids + projects
 *   9. New global variable seeds
 *  10. Update role_configurations for foreman
 * 
 * Safe to run on existing databases — checks before altering.
 */

exports.up = async function (knex) {
  console.log('[Migration] Mobile app additions starting...');

  // ═══════════════════════════════════════════════════════════
  // 1. ROLE RENAME: field_staff → foreman
  // ═══════════════════════════════════════════════════════════
  
  // Check if rename is needed (field_staff exists but foreman doesn't)
  const roleCheck = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumlabel = 'field_staff'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
    ) as has_field_staff
  `);
  
  if (roleCheck.rows[0].has_field_staff) {
    // PostgreSQL 10+ supports ALTER TYPE RENAME VALUE
    await knex.raw("ALTER TYPE user_role RENAME VALUE 'field_staff' TO 'foreman'");
    
    // Update role_configurations table
    await knex('role_configurations')
      .where('role_name', 'field_staff')
      .update({
        role_name: 'foreman',
        display_name: 'Foreman',
        description: 'Mobile only. Field Notes, Oil Sample Requests, equipment assignment notifications.',
        allowed_tabs: JSON.stringify([]),  // No web tabs — mobile only
        permissions: JSON.stringify(['field_notes:*', 'oil_samples:*', 'projects:read']),
      });

    console.log('  ✅ Renamed field_staff → foreman');
  } else {
    console.log('  ⏭️  Role already renamed or foreman exists');
  }

  // ═══════════════════════════════════════════════════════════
  // 2. NEW ENUM: oil_sample_status
  // ═══════════════════════════════════════════════════════════
  
  const enumExists = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'oil_sample_status') as exists
  `);
  
  if (!enumExists.rows[0].exists) {
    await knex.raw(`
      CREATE TYPE oil_sample_status AS ENUM (
        'pending_data_confirm',
        'pending_return',
        'returned',
        'cancelled'
      )
    `);
    console.log('  ✅ oil_sample_status enum created');
  }

  // ═══════════════════════════════════════════════════════════
  // 3. ADD doc_type VALUE: oil_sample_request
  // ═══════════════════════════════════════════════════════════
  
  const docTypeCheck = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumlabel = 'oil_sample_request'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'doc_type')
    ) as exists
  `);
  
  if (!docTypeCheck.rows[0].exists) {
    await knex.raw("ALTER TYPE doc_type ADD VALUE IF NOT EXISTS 'oil_sample_request'");
    console.log('  ✅ doc_type: oil_sample_request added');
  }

  // ═══════════════════════════════════════════════════════════
  // 4. NEW TABLE: field_notes
  // ═══════════════════════════════════════════════════════════
  
  if (!(await knex.schema.hasTable('field_notes'))) {
    await knex.schema.createTable('field_notes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.uuid('foreman_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      t.date('note_date').notNullable();
      t.text('note_text').notNullable();
      t.timestamps(true, true);
      t.index(['project_id', 'note_date']);
      t.index('foreman_id');
    });
    console.log('  ✅ field_notes table created');
  }

  // ═══════════════════════════════════════════════════════════
  // 5. NEW TABLE: form_templates
  // ═══════════════════════════════════════════════════════════
  
  if (!(await knex.schema.hasTable('form_templates'))) {
    await knex.schema.createTable('form_templates', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('form_type', 50).notNullable();          // e.g. 'oil_sample'
      t.string('name', 255).notNullable();               // admin-visible name
      t.string('template_image_path', 500);              // path to annotated reference image
      t.jsonb('field_map');                               // [{field_name, label_bbox, data_bbox, data_type}]
      t.boolean('active').notNullable().defaultTo(false); // one active per form_type
      t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('activated_at');
      t.timestamps(true, true);
      t.index(['form_type', 'active']);
      t.index('created_by');
    });
    console.log('  ✅ form_templates table created');
  }

  // ═══════════════════════════════════════════════════════════
  // 6. NEW TABLE: oil_sample_requests
  // ═══════════════════════════════════════════════════════════
  
  if (!(await knex.schema.hasTable('oil_sample_requests'))) {
    await knex.schema.createTable('oil_sample_requests', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
      t.uuid('foreman_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      t.uuid('form_template_id').references('id').inTable('form_templates').onDelete('SET NULL');
      
      // Photo paths
      t.string('original_photo_path', 500);
      t.string('filed_path_project', 500);     // project subfolder copy
      t.string('filed_path_central', 500);     // central oil_samples/ copy
      
      // Extracted data
      t.jsonb('extracted_fields');              // raw vision extraction result
      t.string('equipment_id_field', 255);     // customer's equipment ID (free text from form)
      t.string('equipment_location', 255);     // location/site where sample taken
      t.date('sample_date');                    // date sample was taken
      t.string('sample_type', 100);            // type of sample
      t.text('condition_notes');                // any condition notes from form
      
      // Lifecycle timestamps
      t.timestamp('submitted_at').defaultTo(knex.fn.now());
      t.timestamp('confirmed_by_foreman_at');  // when foreman verified extracted fields
      t.timestamp('sample_returned_at');       // when admin/PM marked physical return
      t.uuid('confirmed_returned_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('reminder_sent_at');         // last reminder notification sent
      t.timestamp('snoozed_until');            // snooze reminder until this date
      
      // Status & pipeline
      t.specificType('status', 'oil_sample_status').notNullable().defaultTo('pending_data_confirm');
      t.uuid('extraction_id').references('id').inTable('pending_extractions').onDelete('SET NULL');
      t.string('vision_backend_used', 50);     // 'llava' or 'claude_vision'
      
      t.timestamps(true, true);
      t.index('project_id');
      t.index('foreman_id');
      t.index(['status', 'submitted_at']);
      t.index('equipment_id_field');           // for live search by equipment number
      t.index('equipment_location');           // for live search by location
      t.index('form_template_id');
    });
    console.log('  ✅ oil_sample_requests table created');
  }

  // ═══════════════════════════════════════════════════════════
  // 7. NEW FK: equipment_requests.assigned_foreman_id
  // ═══════════════════════════════════════════════════════════
  
  if (!(await knex.schema.hasColumn('equipment_requests', 'assigned_foreman_id'))) {
    await knex.schema.alterTable('equipment_requests', (t) => {
      t.uuid('assigned_foreman_id').references('id').inTable('users').onDelete('SET NULL');
      t.index('assigned_foreman_id');
    });
    console.log('  ✅ equipment_requests.assigned_foreman_id added');
  }

  // ═══════════════════════════════════════════════════════════
  // 8. PER DIEM FIELDS ON BIDS + PROJECTS
  // ═══════════════════════════════════════════════════════════
  
  if (!(await knex.schema.hasColumn('bids', 'per_diem_rate'))) {
    await knex.schema.alterTable('bids', (t) => {
      t.decimal('per_diem_rate', 8, 2).defaultTo(0);     // daily rate per worker (snapshot from global)
      t.decimal('total_per_diem', 14, 2).defaultTo(0);   // per_diem_rate × personnel × project_length_days
    });
    console.log('  ✅ bids: per_diem_rate + total_per_diem added');
  }

  if (!(await knex.schema.hasColumn('projects', 'per_diem_rate'))) {
    await knex.schema.alterTable('projects', (t) => {
      t.decimal('per_diem_rate', 8, 2).defaultTo(0);     // inherited from bid
    });
    console.log('  ✅ projects: per_diem_rate added');
  }

  // ═══════════════════════════════════════════════════════════
  // 9. GLOBAL VARIABLE SEEDS
  // ═══════════════════════════════════════════════════════════
  
  const newGlobals = [
    { key: 'per_diem_daily_rate', value: '75.00', description: 'Default per diem daily rate per worker (admin-set)' },
    { key: 'per_diem_markup_applies', value: 'false', description: 'Whether markup percentage applies to per diem (true/false). Default: false (pass-through).' },
    { key: 'field_note_max_length', value: '5000', description: 'Maximum character length for field notes' },
    { key: 'oil_sample_return_reminder_days', value: '14', description: 'Days after submission before oil sample return reminder is sent' },
    { key: 'oil_sample_snooze_days', value: '3', description: 'Days to snooze oil sample return reminder' },
  ];

  for (const g of newGlobals) {
    const exists = await knex('global_variables').where('key', g.key).first();
    if (!exists) {
      await knex('global_variables').insert(g);
      console.log(`  ✅ global variable '${g.key}' seeded`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 10. ADD NEW TABS TO EXISTING ROLE CONFIGS
  // ═══════════════════════════════════════════════════════════

  const tabAdditions = {
    'admin': ['active-projects', 'oil-samples', 'field-notes'],
    'project_manager': ['active-projects', 'oil-samples', 'field-notes'],
    'accounting': ['active-projects', 'field-notes'],
  };

  for (const [roleName, newTabs] of Object.entries(tabAdditions)) {
    const role = await knex('role_configurations').where('role_name', roleName).first();
    if (role) {
      let tabs = typeof role.allowed_tabs === 'string' ? JSON.parse(role.allowed_tabs) : (role.allowed_tabs || []);
      let changed = false;
      for (const tab of newTabs) {
        if (!tabs.includes(tab)) { tabs.push(tab); changed = true; }
      }
      if (changed) {
        await knex('role_configurations').where('role_name', roleName).update({ allowed_tabs: JSON.stringify(tabs) });
        console.log(`  ✅ Added new tabs to ${roleName}: ${newTabs.join(', ')}`);
      }
    }
  }

  console.log('[Migration] Mobile app additions complete.');
};

exports.down = async function (knex) {
  // Remove global variables
  await knex('global_variables').whereIn('key', [
    'per_diem_daily_rate', 'per_diem_markup_applies', 'field_note_max_length',
    'oil_sample_return_reminder_days', 'oil_sample_snooze_days',
  ]).delete();

  // Remove per diem columns
  if (await knex.schema.hasColumn('projects', 'per_diem_rate')) {
    await knex.schema.alterTable('projects', (t) => t.dropColumn('per_diem_rate'));
  }
  if (await knex.schema.hasColumn('bids', 'per_diem_rate')) {
    await knex.schema.alterTable('bids', (t) => {
      t.dropColumn('per_diem_rate');
      t.dropColumn('total_per_diem');
    });
  }

  // Remove foreman FK
  if (await knex.schema.hasColumn('equipment_requests', 'assigned_foreman_id')) {
    await knex.schema.alterTable('equipment_requests', (t) => t.dropColumn('assigned_foreman_id'));
  }

  // Drop new tables (order matters for FKs)
  await knex.schema.dropTableIfExists('oil_sample_requests');
  await knex.schema.dropTableIfExists('form_templates');
  await knex.schema.dropTableIfExists('field_notes');

  // Drop enum
  await knex.raw('DROP TYPE IF EXISTS oil_sample_status');

  // Rename role back
  const roleCheck = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumlabel = 'foreman'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
    ) as has_foreman
  `);
  if (roleCheck.rows[0].has_foreman) {
    await knex.raw("ALTER TYPE user_role RENAME VALUE 'foreman' TO 'field_staff'");
    await knex('role_configurations').where('role_name', 'foreman').update({
      role_name: 'field_staff', display_name: 'Field Staff',
      allowed_tabs: JSON.stringify(['projects', 'inbox', 'notifications']),
    });
  }
};
