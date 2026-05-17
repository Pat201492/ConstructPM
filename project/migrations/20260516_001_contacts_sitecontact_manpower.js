/**
 * Migration: Phase 1 — Contacts unification, Site Contact, Manpower.
 *
 * Three coordinated changes:
 *
 * 1. CONTACT CODE
 *    customer_contacts gains `contact_code` — an auto-generated stable
 *    identifier (scheme: initials + last 3 of phone, computed in the
 *    model layer). UNIQUE constraint so any add-contact UI rejects
 *    duplicates. The physical table keeps its name (per Pat: UI says
 *    "Contacts", DB unchanged — renaming 39 refs buys nothing).
 *
 * 2. SITE CONTACT
 *    bids + projects gain site_contact_id (FK → customer_contacts) plus
 *    DENORMALIZED site_contact_name + site_contact_phone. Pat's rule:
 *    store both the id (stable link for verification/editing) and the
 *    name/phone (so calendar cards, project detail, equipment tickets,
 *    and the Work Order Email never break if a contact is later edited
 *    or deleted). Customer contact gets the same denormalized name on
 *    projects for the same reason.
 *
 * 3. MANPOWER RENAME
 *    projects.total_personnel → projects.manpower. Identical meaning;
 *    Pat wants the single canonical name everywhere. Done as add-copy-
 *    drop so existing data is preserved. All code references updated in
 *    the same tarball.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  // ── 1. contact_code ──────────────────────────────────────────
  if (!(await knex.schema.hasColumn('customer_contacts', 'contact_code'))) {
    await knex.schema.alterTable('customer_contacts', (t) => {
      t.string('contact_code', 32);
    });
    // Backfill existing rows with a deterministic code: initials from
    // name + last 3 digits of phone. Collisions get a numeric suffix so
    // the unique index can be applied cleanly.
    const rows = await knex('customer_contacts').select('id', 'name', 'phone');
    const seen = new Set();
    for (const r of rows) {
      const initials = String(r.name || 'XX')
        .split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'XX';
      const digits = String(r.phone || '').replace(/\D/g, '');
      const last3 = digits ? digits.slice(-3) : '000';
      let code = `${initials}${last3}`;
      let n = 1;
      while (seen.has(code)) { code = `${initials}${last3}-${n++}`; }
      seen.add(code);
      await knex('customer_contacts').where('id', r.id).update({ contact_code: code });
    }
    // Unique index — partial so legacy NULLs (shouldn't exist after
    // backfill, but defensive) don't collide.
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_contact_code_unique
      ON customer_contacts (contact_code)
      WHERE contact_code IS NOT NULL
    `);
    console.log(`  ✅ contact_code added + backfilled (${rows.length} contacts)`);
  }

  // ── 2. site contact on bids ──────────────────────────────────
  const bidCols = [];
  if (!(await knex.schema.hasColumn('bids', 'site_contact_id'))) bidCols.push('site_contact_id');
  if (!(await knex.schema.hasColumn('bids', 'site_contact_name'))) bidCols.push('site_contact_name');
  if (!(await knex.schema.hasColumn('bids', 'site_contact_phone'))) bidCols.push('site_contact_phone');
  if (bidCols.length) {
    await knex.schema.alterTable('bids', (t) => {
      if (bidCols.includes('site_contact_id')) t.uuid('site_contact_id').references('id').inTable('customer_contacts').onDelete('SET NULL');
      if (bidCols.includes('site_contact_name')) t.string('site_contact_name', 255);
      if (bidCols.includes('site_contact_phone')) t.string('site_contact_phone', 20);
    });
    console.log(`  ✅ bids: ${bidCols.join(', ')}`);
  }

  // ── 2b. site + customer contact denormalized on projects ─────
  const projCols = [];
  if (!(await knex.schema.hasColumn('projects', 'customer_contact_id'))) projCols.push('customer_contact_id');
  if (!(await knex.schema.hasColumn('projects', 'customer_contact_name'))) projCols.push('customer_contact_name');
  if (!(await knex.schema.hasColumn('projects', 'site_contact_id'))) projCols.push('site_contact_id');
  if (!(await knex.schema.hasColumn('projects', 'site_contact_name'))) projCols.push('site_contact_name');
  if (!(await knex.schema.hasColumn('projects', 'site_contact_phone'))) projCols.push('site_contact_phone');
  if (projCols.length) {
    await knex.schema.alterTable('projects', (t) => {
      if (projCols.includes('customer_contact_id')) t.uuid('customer_contact_id').references('id').inTable('customer_contacts').onDelete('SET NULL');
      if (projCols.includes('customer_contact_name')) t.string('customer_contact_name', 255);
      if (projCols.includes('site_contact_id')) t.uuid('site_contact_id').references('id').inTable('customer_contacts').onDelete('SET NULL');
      if (projCols.includes('site_contact_name')) t.string('site_contact_name', 255);
      if (projCols.includes('site_contact_phone')) t.string('site_contact_phone', 20);
    });
    console.log(`  ✅ projects: ${projCols.join(', ')}`);
  }

  // ── 3. total_personnel → manpower ────────────────────────────
  const hasOld = await knex.schema.hasColumn('projects', 'total_personnel');
  const hasNew = await knex.schema.hasColumn('projects', 'manpower');
  if (hasOld && !hasNew) {
    await knex.schema.alterTable('projects', (t) => { t.integer('manpower').defaultTo(0); });
    await knex.raw('UPDATE projects SET manpower = COALESCE(total_personnel, 0)');
    await knex.schema.alterTable('projects', (t) => { t.dropColumn('total_personnel'); });
    console.log('  ✅ projects.total_personnel → projects.manpower (data preserved)');
  } else if (!hasOld && !hasNew) {
    await knex.schema.alterTable('projects', (t) => { t.integer('manpower').defaultTo(0); });
    console.log('  ✅ projects.manpower created (no prior total_personnel)');
  }
};

exports.down = async function (knex) {
  // Reverse manpower rename
  if (await knex.schema.hasColumn('projects', 'manpower')) {
    if (!(await knex.schema.hasColumn('projects', 'total_personnel'))) {
      await knex.schema.alterTable('projects', (t) => { t.integer('total_personnel').defaultTo(0); });
      await knex.raw('UPDATE projects SET total_personnel = COALESCE(manpower, 0)');
    }
    await knex.schema.alterTable('projects', (t) => { t.dropColumn('manpower'); });
  }
  for (const col of ['site_contact_id', 'site_contact_name', 'site_contact_phone',
                      'customer_contact_id', 'customer_contact_name']) {
    if (await knex.schema.hasColumn('projects', col)) {
      await knex.schema.alterTable('projects', (t) => t.dropColumn(col));
    }
  }
  for (const col of ['site_contact_id', 'site_contact_name', 'site_contact_phone']) {
    if (await knex.schema.hasColumn('bids', col)) {
      await knex.schema.alterTable('bids', (t) => t.dropColumn(col));
    }
  }
  await knex.raw('DROP INDEX IF EXISTS customer_contacts_contact_code_unique');
  if (await knex.schema.hasColumn('customer_contacts', 'contact_code')) {
    await knex.schema.alterTable('customer_contacts', (t) => t.dropColumn('contact_code'));
  }
};
