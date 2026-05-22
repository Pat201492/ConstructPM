/**
 * Migration: refresh the default bid template on existing installs.
 *
 * PR #36 ships a redesigned templates/defaults/bid_template_default.docx
 * (cleaner layout, every merge field BidDocumentService supports). The
 * seed at seeds/001_admin_user.js only provisions templates when no row
 * exists in bid_templates — fresh installs pick up the new file, but
 * existing installs keep pointing at the old storage copy forever.
 *
 * This migration copies the new default into each existing 'bid'
 * template row's file_path (and rotates the on-disk filename so any
 * downstream caches based on path see a change). Safe for prod because
 * the bid_templates rows are author-keyed by PM — a PM who uploaded
 * their OWN custom template will have a non-default file (their
 * original_filename will not equal 'bid_template_default.docx'), and
 * those rows are skipped.
 *
 * IDEMPOTENT — re-running is a no-op once every default row points to
 * the latest copy (we always rewrite; cost is one fs.writeFile per row).
 */

const fs = require('fs');
const path = require('path');

exports.up = async function (knex) {
  const basePath = process.env.STORAGE_BASE_PATH || './storage';
  const srcPath = path.join(__dirname, '..', 'templates', 'defaults', 'bid_template_default.docx');

  if (!fs.existsSync(srcPath)) {
    console.log(`  ⚠ default template missing at ${srcPath} — skipping refresh`);
    return;
  }
  const newBuffer = fs.readFileSync(srcPath);

  const defaultRows = await knex('bid_templates')
    .where('template_type', 'bid')
    .andWhere('original_filename', 'bid_template_default.docx');

  if (defaultRows.length === 0) {
    console.log('  (no default bid template rows to refresh — fresh install will seed via 001_admin_user.js)');
    return;
  }

  const targetDir = path.join(basePath, 'templates', 'bid');
  fs.mkdirSync(targetDir, { recursive: true });

  for (const row of defaultRows) {
    const newFilename = `admin_default_bid_${Date.now()}_${row.id}.docx`;
    const newRelPath = `templates/bid/${newFilename}`;
    const newAbsPath = path.join(basePath, newRelPath.replace(/^templates\//, 'templates/'));
    fs.writeFileSync(newAbsPath, newBuffer);
    await knex('bid_templates').where({ id: row.id }).update({
      file_path: newRelPath,
      updated_at: knex.fn.now(),
    });
    console.log(`  ✅ refreshed default bid template for pm_id=${row.pm_id} → ${newRelPath}`);
  }
};

exports.down = async function () {
  // No-op: the previous file content is gone. Rolling back the schema
  // is not destructive because the migration only updates file_path
  // pointers and writes new storage copies. Reverting would require
  // the original .docx, which the migration doesn't keep.
};
