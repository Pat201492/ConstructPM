/**
 * Migration: Add external_reference to invoices and purchase_orders
 *
 * Why: when invoices/POs are uploaded via the inbox (rather than generated
 * inside the platform), they often have a document number from whatever
 * external system the firm uses — QuickBooks invoice numbers, vendor PO
 * numbers, customer-issued purchase order references, etc.
 *
 * Behavior:
 *   - The platform always assigns its own canonical number to the record:
 *       Invoice: INV-<PrimaryProjectNumber>-<Seq>
 *       PO:     <PrimaryProjectNumber>-PO-<Seq>
 *   - Whatever was on the original document goes in external_reference.
 *   - This keeps the platform's identifiers consistent (one format, one
 *     numbering authority) while preserving the source-document number
 *     for audit and reconciliation.
 *
 * Display:
 *   - Lists/details show the platform number prominently with the
 *     external reference in parens: "INV-M26-1308.1-001 (QB: Q-12847)"
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('invoices', 'external_reference'))) {
    await knex.schema.alterTable('invoices', (t) => {
      t.string('external_reference', 100);
    });
    console.log('  ✅ invoices.external_reference added');
  }

  if (!(await knex.schema.hasColumn('purchase_orders', 'external_reference'))) {
    await knex.schema.alterTable('purchase_orders', (t) => {
      t.string('external_reference', 100);
    });
    console.log('  ✅ purchase_orders.external_reference added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('invoices', 'external_reference')) {
    await knex.schema.alterTable('invoices', (t) => t.dropColumn('external_reference'));
  }
  if (await knex.schema.hasColumn('purchase_orders', 'external_reference')) {
    await knex.schema.alterTable('purchase_orders', (t) => t.dropColumn('external_reference'));
  }
};
