/**
 * Migration: Merge vendors into customers.
 *
 * Companies don't need a separate vendors table — a GC who is the customer
 * on Project A can be a sub-vendor on Project B. After this migration every
 * "vendor" is just a row in customers, and purchase_orders.vendor_id points
 * at the customers table.
 *
 * What this does:
 *   1. For each vendors row, find or create a matching customers row
 *      (case-insensitive name match). Address fields map
 *      street/town/state/zip -> billing_street/billing_town/billing_state/billing_zip.
 *   2. Vendor contact info (contact_name/email/phone) becomes a
 *      customer_contacts row tied to that customer.
 *   3. purchase_orders.vendor_id values are remapped to the customer ids.
 *   4. The FK is repointed from vendors -> customers; vendors table is dropped.
 *
 * One-way migration. down() recreates an empty vendors table but the merged
 * data stays in customers — restoring vendor rows would require a manual
 * rebuild.
 */

exports.up = async function (knex) {
  const vendors = await knex('vendors').select('*');
  const remap = new Map(); // vendor_id -> customer_id

  for (const v of vendors) {
    const trimmedName = String(v.name || '').trim();
    if (!trimmedName) continue;

    let customerId;
    const existing = await knex('customers')
      .whereRaw('LOWER(TRIM(name)) = LOWER(TRIM(?))', [trimmedName])
      .first();

    if (existing) {
      customerId = existing.id;
      // Only fill in blanks — don't overwrite billing data the customer
      // already had configured on the customer side.
      const patch = {};
      if (!existing.billing_street && v.street) patch.billing_street = v.street;
      if (!existing.billing_town && v.town) patch.billing_town = v.town;
      if (!existing.billing_state && v.state) patch.billing_state = v.state;
      if (!existing.billing_zip && v.zip) patch.billing_zip = v.zip;
      if (!existing.notes && v.notes) patch.notes = v.notes;
      if (Object.keys(patch).length) {
        patch.updated_at = knex.fn.now();
        await knex('customers').where({ id: customerId }).update(patch);
      }
    } else {
      const [row] = await knex('customers').insert({
        name: trimmedName,
        billing_street: v.street || null,
        billing_town: v.town || null,
        billing_state: v.state || null,
        billing_zip: v.zip || null,
        notes: v.notes || null,
        active: v.active !== false,
      }).returning('id');
      customerId = row.id;
    }

    remap.set(v.id, customerId);

    if (v.contact_name || v.email || v.phone) {
      const contactName = (v.contact_name || trimmedName).slice(0, 255);
      const dup = await knex('customer_contacts')
        .where('customer_id', customerId)
        .whereRaw('LOWER(TRIM(name)) = LOWER(TRIM(?))', [contactName])
        .first();
      if (!dup) {
        await knex('customer_contacts').insert({
          customer_id: customerId,
          name: contactName,
          // customer_contacts.phone is varchar(20) but vendors.phone is varchar(50);
          // truncate defensively so a long vendor phone doesn't fail the insert.
          email: v.email ? String(v.email).slice(0, 255) : null,
          phone: v.phone ? String(v.phone).slice(0, 20) : null,
          company: trimmedName,
          active: true,
        });
      }
    }
  }

  for (const [vendorId, customerId] of remap) {
    await knex('purchase_orders').where({ vendor_id: vendorId }).update({ vendor_id: customerId });
  }
  // Defensive: null out any PO vendor_id that points at a vendor row we
  // didn't see (already-orphaned references) — required before we can swap
  // the FK target without violating it.
  const customerIds = Array.from(remap.values());
  if (customerIds.length > 0) {
    await knex('purchase_orders')
      .whereNotNull('vendor_id')
      .whereNotIn('vendor_id', customerIds)
      .update({ vendor_id: null });
  } else {
    await knex('purchase_orders').whereNotNull('vendor_id').update({ vendor_id: null });
  }

  await knex.schema.alterTable('purchase_orders', (t) => {
    t.dropForeign('vendor_id');
  });
  await knex.schema.alterTable('purchase_orders', (t) => {
    t.foreign('vendor_id').references('id').inTable('customers').onDelete('SET NULL');
  });

  await knex.schema.dropTableIfExists('vendors');
  console.log(`  ✅ merged ${remap.size} vendor row(s) into customers; vendors table dropped`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('purchase_orders', (t) => {
    t.dropForeign('vendor_id');
  });
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
  // vendor_id can't be remapped back since rows now live in customers,
  // so null it out — operator rebuilds vendor data manually if needed.
  await knex('purchase_orders').update({ vendor_id: null });
  await knex.schema.alterTable('purchase_orders', (t) => {
    t.foreign('vendor_id').references('id').inTable('vendors').onDelete('SET NULL');
  });
};
