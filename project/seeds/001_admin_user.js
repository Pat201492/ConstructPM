/**
 * Seed: Create initial admin user + provision default document templates.
 * 
 * Templates are copied from templates/defaults/ to storage/templates/bid/
 * and registered in the bid_templates table for the admin user.
 */
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

exports.seed = async function (knex) {
  // ── ADMIN USER ──────────────────────────────────────────
  let adminId;
  const existing = await knex('users').where({ email: 'admin@company.com' }).first();
  if (existing) {
    adminId = existing.id;
    console.log('Admin user already exists, skipping user seed.');
  } else {
    const password_hash = await bcrypt.hash('ChangeMe123!', 12);

    const [admin] = await knex('users').insert({
      email: 'admin@company.com',
      password_hash,
      first_name: 'System',
      last_name: 'Admin',
      initials: 'SA',
      role: 'admin',
      active: true,
      // Note: is_superadmin is NOT set here — it's controlled by
      // migration 20260513_003 which assigns superadmin to a specific
      // email (pegan604@gmail.com). admin@company.com is purely the
      // firm-level seed admin and shouldn't have Pat-only privileges.
      notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
    }).returning('*');
    adminId = admin.id;

    console.log('='.repeat(50));
    console.log('Initial admin user created:');
    console.log('  Email:    admin@company.com');
    console.log('  Password: ChangeMe123!');
    console.log('  ** CHANGE THIS PASSWORD IMMEDIATELY **');
    console.log('='.repeat(50));
  }

  // ── DEFAULT TEMPLATES ───────────────────────────────────
  const basePath = process.env.STORAGE_BASE_PATH || './storage';
  const templateDir = path.join(basePath, 'templates', 'bid');

  const defaults = [
    { type: 'bid', src: 'bid_template_default.docx', name: 'Default Bid Template' },
    { type: 'invoice', src: 'invoice_template_default.docx', name: 'Default Invoice Template' },
    { type: 'timesheet', src: 'timesheet_template_default.docx', name: 'Default Timesheet Template' },
  ];

  for (const tpl of defaults) {
    // Check if already seeded
    const existingTpl = await knex('bid_templates')
      .where({ pm_id: adminId, template_type: tpl.type, template_name: tpl.name })
      .first();
    if (existingTpl) {
      console.log(`Default ${tpl.type} template already exists, skipping.`);
      continue;
    }

    // Copy template file from defaults/ to storage
    const srcPath = path.join(__dirname, '..', 'templates', 'defaults', tpl.src);
    if (!fs.existsSync(srcPath)) {
      console.log(`Default template not found at ${srcPath}, skipping.`);
      continue;
    }

    fs.mkdirSync(templateDir, { recursive: true });
    const destFilename = `admin_default_${tpl.type}_${Date.now()}.docx`;
    const destPath = path.join(templateDir, destFilename);
    fs.copyFileSync(srcPath, destPath);

    // Register in database
    await knex('bid_templates').insert({
      pm_id: adminId,
      template_type: tpl.type,
      template_name: tpl.name,
      original_filename: tpl.src,
      file_path: `templates/bid/${destFilename}`,
    });

    console.log(`✅ Default ${tpl.type} template provisioned: ${tpl.name}`);
  }
};
