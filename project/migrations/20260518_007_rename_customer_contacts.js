/**
 * Migration: rename customer_contacts → contacts.
 *
 * "Customer contacts" was a holdover from when contacts only belonged to
 * customers. After the vendor-customer merge (20260517_001) any company
 * — customer or vendor — can carry contacts, so the qualifier no longer
 * fits. Pat wants the table simply called `contacts`.
 *
 * What this does:
 *   - Renames the table. Postgres updates FK metadata
 *     (pg_constraint.confrelid) automatically; the FK constraints on
 *     bids.customer_contact_id and projects.customer_contact_id keep
 *     working without touching the column names.
 *
 * What this does NOT do (deliberate — keeps the diff focused):
 *   - Rename FK columns `customer_contact_id` → `contact_id`. That's a
 *     separate pass touching every reference in code; defer.
 *   - Rename the model filename `CustomerContact.js`. Defer.
 *
 * Idempotent: no-op if the new table already exists OR the old one is
 * already gone.
 */

exports.up = async function (knex) {
  const oldExists = await knex.schema.hasTable('customer_contacts');
  const newExists = await knex.schema.hasTable('contacts');
  if (oldExists && !newExists) {
    await knex.schema.renameTable('customer_contacts', 'contacts');
    console.log('  ✅ customer_contacts → contacts (FKs preserved)');
  } else if (newExists) {
    console.log('  ✓ contacts table already present, skipping rename');
  }
};

exports.down = async function (knex) {
  const newExists = await knex.schema.hasTable('contacts');
  const oldExists = await knex.schema.hasTable('customer_contacts');
  if (newExists && !oldExists) {
    await knex.schema.renameTable('contacts', 'customer_contacts');
  }
};
