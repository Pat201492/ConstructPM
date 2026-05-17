/**
 * Migration: Vendors + PO outbound generation support
 *
 * Adds:
 *   1. vendors table — central vendor list, managed via Admin → Vendors
 *   2. purchase_orders.vendor_id — FK to vendors (nullable; existing free-text
 *      `vendor` column is kept so historical extracted POs still display)
 *   3. purchase_orders.tax_amount and shipping_amount — for the Excel-embedded
 *      formulas the customer wants on outbound POs
 *   4. purchase_orders.created_by — who created this PO (vs `confirmed_by` for
 *      incoming-extraction POs verified by a PM)
 *
 * Outbound POs (created in our app) and incoming POs (extracted from vendor
 * documents) share the same purchase_orders table; the difference is which
 * fields are populated and the workflow that created the row.
 */

exports.up = async function (knex) {
  // 1. VENDORS TABLE
  await knex.schema.createTable('vendors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.string('contact_name', 255);
    t.string('email', 255);
    t.string('phone', 50);
    t.string('street', 255);
    t.string('town', 100);
    t.string('state', 50);
    t.string('zip', 20);
    t.text('notes');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('name');
  });
  console.log('  ✅ vendors table created');

  // 2. PO ADDITIONS
  await knex.schema.alterTable('purchase_orders', (t) => {
    t.uuid('vendor_id').references('id').inTable('vendors').onDelete('SET NULL');
    t.decimal('tax_amount', 12, 2).defaultTo(0);
    t.decimal('shipping_amount', 12, 2).defaultTo(0);
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
  });
  console.log('  ✅ purchase_orders.vendor_id, tax_amount, shipping_amount, created_by added');
};

exports.down = async function (knex) {
  await knex.schema.alterTable('purchase_orders', (t) => {
    t.dropColumn('vendor_id');
    t.dropColumn('tax_amount');
    t.dropColumn('shipping_amount');
    t.dropColumn('created_by');
  });
  await knex.schema.dropTableIfExists('vendors');
};
