/**
 * Migration: Equipment Ticket tables.
 *
 * LIVE tables (rows exist only while a ticket is active, deleted after
 * pickup per Pat's design — the permanent record is the archive row +
 * a generated PDF):
 *
 *   ticket_project   — one row per ticket: project/location/contacts/
 *                       pickup info. Keyed by ticket_number.
 *   ticket_equipment — N rows per ticket: the requested line items
 *                       (qty + eq name/type/subtype/manufacturer).
 *
 * ARCHIVE (permanent, tiny):
 *   ticket_archive   — ticket_number, filled_date, picked_up_date,
 *                      pickup_person, filler, pdf_path. The full data
 *                      lives in the generated PDF named by ticket #.
 *
 * Ticket number = global monotonic counter. Stored in global_variables
 * key 'equipment.ticket_seq' so it survives live-table deletion. No
 * hidden data encoded — it's purely the join key between the two live
 * tables and the archive (Pat said either is fine; simplest wins).
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('ticket_project'))) {
    await knex.schema.createTable('ticket_project', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.integer('ticket_number').notNullable().unique();
      t.uuid('project_id').references('id').inTable('projects').onDelete('SET NULL');
      t.string('project_number', 100);
      t.string('pickup_person', 255);
      t.string('requestor_name', 255);
      t.string('location_name', 255);
      t.text('location_address');
      t.string('site_contact_name', 255);
      t.string('site_contact_phone', 50);
      t.string('status', 20).notNullable().defaultTo('open'); // open | filled | picked_up
      t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
      t.index('ticket_number');
      t.index('status');
    });
    console.log('  ✅ ticket_project created');
  }

  if (!(await knex.schema.hasTable('ticket_equipment'))) {
    await knex.schema.createTable('ticket_equipment', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.integer('ticket_number').notNullable();
      t.integer('quantity').notNullable().defaultTo(1);
      t.string('equipment_name', 255);
      t.string('equipment_type', 100);
      t.string('equipment_subtype', 100);
      t.string('manufacturer', 255);
      // Filled-in scan results (populated when mobile fills the order) —
      // a free list of scanned equipment numbers + names shown at the
      // bottom of the active-ticket card.
      t.jsonb('filled_items').defaultTo('[]');
      t.timestamps(true, true);
      t.index('ticket_number');
    });
    console.log('  ✅ ticket_equipment created');
  }

  if (!(await knex.schema.hasTable('ticket_archive'))) {
    await knex.schema.createTable('ticket_archive', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.integer('ticket_number').notNullable().unique();
      t.string('project_number', 100);
      t.date('filled_date');
      t.date('picked_up_date');
      t.string('pickup_person', 255);
      t.string('filler', 255);
      t.string('pdf_path', 500);
      t.timestamps(true, true);
      t.index('ticket_number');
    });
    console.log('  ✅ ticket_archive created');
  }

  // Global ticket counter — survives live-row deletion.
  await knex.raw(
    `INSERT INTO global_variables (key, value, description)
     VALUES ('equipment.ticket_seq', '0', 'Last issued equipment ticket number (monotonic)')
     ON CONFLICT (key) DO NOTHING`
  );
  console.log('  ✅ ticket_seq counter seeded');
};

exports.down = async function (knex) {
  for (const tbl of ['ticket_equipment', 'ticket_project', 'ticket_archive']) {
    if (await knex.schema.hasTable(tbl)) await knex.schema.dropTable(tbl);
  }
  await knex('global_variables').where('key', 'equipment.ticket_seq').del();
};
