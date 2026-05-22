/**
 * Work Order Service.
 *
 * Pat: "I want customer name, address, contact name, phone email, site
 * contact name, phone, location name and address project number any
 * SPN(s) ... the system should automatically create one when a project
 * is created, and when anyone of the project lines are edited it
 * should create a copy".
 *
 * Versioned PDF generation per project. Pulls from multiple tables
 * (projects, customers, customer_contacts, locations, project_numbers)
 * and emits a single-page Work Order PDF written into the project's
 * storage folder. Caller passes only projectId — the service does the
 * lookups, renders the PDF, dedupes against the latest version via
 * SHA-256 of the rendering inputs, and writes a new project_work_orders
 * row only when the content actually differs.
 *
 * Hooks:
 *   - bids.js createProjectFromBid (project create) — first generation
 *   - projects.js PATCH /:id (project edit)         — every save
 *
 * Both hooks call generateForProject(projectId, { userId, reason })
 * and intentionally swallow errors (so a Work Order failure never
 * blocks the underlying save). Errors are console.error'd for debugging.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../config/database');
const FileService = require('./FileService');
const storage = require('./StorageService');

const WorkOrderService = {
  /**
   * Generate a new Work Order PDF for the given project, dedupe against
   * the latest version, and return the resulting row (or null when the
   * content was unchanged so no new version was created).
   *
   * @param {string} projectId
   * @param {{ userId?: string, reason?: string }} [opts]
   */
  async generateForProject(projectId, opts = {}) {
    const inputs = await this._gatherInputs(projectId);
    if (!inputs) return null; // project not found — nothing to do

    const contentHash = hashInputs(inputs);

    // Dedupe: if the most-recent row's content_hash matches, skip.
    const latest = await db('project_work_orders')
      .where({ project_id: projectId })
      .orderBy('version', 'desc')
      .first('version', 'content_hash');
    if (latest && latest.content_hash === contentHash) {
      return null;
    }

    // Two concurrent PATCH hooks on the same project could both read the
    // same `latest.version` and try to INSERT the same `version + 1`,
    // colliding on the UNIQUE (project_id, version) index. Retry once
    // with a fresh max-version read if that happens. The hook is fire-
    // and-forget, so a 23505 would otherwise vanish into console.error.
    let row = null;
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const cur = await db('project_work_orders')
        .where({ project_id: projectId })
        .max({ v: 'version' })
        .first();
      const nextVersion = (cur && cur.v) ? cur.v + 1 : 1;
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `WorkOrder_v${nextVersion}_${dateStr}.pdf`;

      const buf = await renderWorkOrderPDF(inputs, nextVersion);
      const folderPath = await ensureProjectWorkOrderFolder(inputs);
      const filePath = path.join(folderPath, filename);
      await fs.writeFile(filePath, Buffer.from(buf));

      try {
        [row] = await db('project_work_orders').insert({
          project_id: projectId,
          version: nextVersion,
          file_path: filePath,
          content_hash: contentHash,
          generated_by_user_id: opts.userId || null,
        }).returning('*');
        break;
      } catch (err) {
        // 23505 = unique_violation. Could be (project_id, version) — a
        // concurrent writer beat us — or (project_id, content_hash) — the
        // concurrent writer happened to produce the same hash (effectively
        // the same dedupe outcome, just async). In both cases, retrying
        // re-reads max version and either steps to the next slot or finds
        // the hash already present and bails via the dedupe check above.
        if (err && err.code === '23505') {
          // Clean up the temp file we just wrote since we won't be
          // referencing it from any row.
          await fs.unlink(filePath).catch(() => {});
          // Re-check dedupe with the latest after this race.
          const afterRace = await db('project_work_orders')
            .where({ project_id: projectId, content_hash: contentHash })
            .first();
          if (afterRace) return null; // the other writer landed the same content
          continue; // retry with a higher version
        }
        throw err;
      }
    }
    return row;
  },

  /**
   * List Work Order versions for a project, newest first.
   */
  async listForProject(projectId) {
    return db('project_work_orders')
      .where({ project_id: projectId })
      .orderBy('version', 'desc');
  },

  /**
   * Get one specific version's file path (for download streaming).
   */
  async getVersion(projectId, version) {
    return db('project_work_orders')
      .where({ project_id: projectId, version })
      .first();
  },

  /**
   * Fire-and-forget wrapper used by hooks. Logs and swallows errors so
   * the caller's primary action (project save) is never blocked by a
   * Work Order generation hiccup.
   */
  async generateInBackground(projectId, opts = {}) {
    this.generateForProject(projectId, opts).catch((err) => {
      console.error('[WorkOrderService] generateForProject failed for', projectId, ':', err.message);
    });
  },

  // ── Internals ─────────────────────────────────────────────

  async _gatherInputs(projectId) {
    const project = await db('projects').where({ id: projectId }).first();
    if (!project) return null;

    const [customer, location, billingContact, siteContact, projectNumbers] = await Promise.all([
      project.customer_id ? db('customers').where({ id: project.customer_id }).first() : null,
      project.location_id ? db('locations').where({ id: project.location_id }).first() : null,
      project.customer_contact_id ? db('contacts').where({ id: project.customer_contact_id }).first() : null,
      project.site_contact_id ? db('contacts').where({ id: project.site_contact_id }).first() : null,
      db('project_numbers').where({ project_id: projectId }).orderBy('label'),
    ]);

    const pm = project.pm_id ? await db('users').where({ id: project.pm_id }).first('first_name', 'last_name') : null;

    return {
      project,
      customer,
      location,
      billingContact,
      siteContact,
      projectNumbers,
      pm,
    };
  },
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Stable content hash so a no-op edit (e.g. saving with no changes)
 * doesn't bump the version. Only the fields that visibly appear on the
 * generated PDF are hashed — internal IDs / timestamps are excluded.
 */
function hashInputs(inputs) {
  const { project, customer, location, billingContact, siteContact, projectNumbers, pm } = inputs;
  const payload = {
    project: {
      name: project.name,
      address: project.address,
    },
    customer: customer ? {
      name: customer.name,
      display_address: customer.billing_display_address,
      billing_street: customer.billing_street,
      billing_town: customer.billing_town,
      billing_state: customer.billing_state,
      billing_zip: customer.billing_zip,
    } : null,
    location: location ? {
      name: location.name,
      display_address: location.display_address,
    } : null,
    billingContact: billingContact ? {
      name: billingContact.name,
      phone: billingContact.phone,
      email: billingContact.email,
    } : null,
    siteContact: siteContact ? {
      name: siteContact.name,
      phone: siteContact.phone,
    } : null,
    projectNumbers: projectNumbers.map(n => `${n.label}: ${n.number}`).sort(),
    pm: pm ? `${pm.first_name || ''} ${pm.last_name || ''}`.trim() : null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function ensureProjectWorkOrderFolder(inputs) {
  const { project, customer, pm } = inputs;
  const year = String(new Date(project.created_at || Date.now()).getFullYear());
  const pmName = pm ? `${pm.first_name || ''}_${pm.last_name || ''}`.replace(/^_|_$/g, '') : 'no_pm';
  const customerName = customer ? customer.name : 'no_customer';
  const projectName = project.name || project.id;
  const projectPrefix = [
    'projects', year,
    FileService.sanitizeFolderName(pmName),
    FileService.sanitizeFolderName(customerName),
    FileService.sanitizeFolderName(projectName),
    'work_orders',
  ].join('/');
  await storage.ensureDir(projectPrefix);
  return storage.getFullPath(projectPrefix);
}

async function renderWorkOrderPDF(inputs, version) {
  const { project, customer, location, billingContact, siteContact, projectNumbers, pm } = inputs;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 612;     // 8.5"
  const PAGE_H = 792;     // 11"
  const MARGIN = 54;      // 0.75"
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // Title bar.
  page.drawText('WORK ORDER', {
    x: MARGIN, y: y - 22, size: 22, font: fontBold, color: rgb(0.12, 0.31, 0.47),
  });
  y -= 28;
  page.drawText(`Version ${version} · Generated ${new Date().toISOString().split('T')[0]}`, {
    x: MARGIN, y: y - 10, size: 9, font, color: rgb(0.45, 0.45, 0.45),
  });
  y -= 18;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: rgb(0.12, 0.31, 0.47) });
  y -= 18;

  // Section renderer — labeled rows with a header band.
  function section(title, items) {
    page.drawRectangle({ x: MARGIN, y: y - 16, width: PAGE_W - 2 * MARGIN, height: 16, color: rgb(0.94, 0.94, 0.94) });
    page.drawText(title, { x: MARGIN + 6, y: y - 12, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 22;
    for (const [label, value] of items) {
      const lbl = `${label}:`;
      page.drawText(lbl, { x: MARGIN + 6, y: y - 10, size: 9, font: fontBold, color: rgb(0.25, 0.25, 0.25) });
      const text = value == null || value === '' ? '—' : String(value);
      // Simple wrap: split on 80 char boundary. Long addresses rare here
      // (display_address is one line by convention); keep it minimal.
      const wrapped = text.length > 80 ? text.slice(0, 80) + '…' : text;
      page.drawText(wrapped, { x: MARGIN + 130, y: y - 10, size: 9, font, color: rgb(0, 0, 0) });
      y -= 16;
    }
    y -= 6;
  }

  // Project numbers — primary + every SPN inline.
  const primary = projectNumbers.find(n => n.label === 'Primary');
  const spns = projectNumbers.filter(n => n.label !== 'Primary').map(n => `${n.label}: ${n.number}`).join(', ') || '—';

  section('PROJECT', [
    ['Project Number', primary ? primary.number : '—'],
    ['SPNs', spns],
    ['Name', project.name],
    ['Site Address', project.address],
    ['PM', pm ? `${pm.first_name || ''} ${pm.last_name || ''}`.trim() : '—'],
  ]);

  section('CUSTOMER', [
    ['Name', customer ? customer.name : '—'],
    ['Billing Address', customer ? (customer.billing_display_address
      || [customer.billing_street, customer.billing_town, customer.billing_state, customer.billing_zip].filter(Boolean).join(', ')
      || '—') : '—'],
  ]);

  section('BILLING CONTACT', [
    ['Name', billingContact ? billingContact.name : '—'],
    ['Phone', billingContact ? billingContact.phone : '—'],
    ['Email', billingContact ? billingContact.email : '—'],
  ]);

  section('SITE CONTACT', [
    ['Name', siteContact ? siteContact.name : '—'],
    ['Phone', siteContact ? siteContact.phone : '—'],
  ]);

  section('LOCATION', [
    ['Name', location ? location.name : '—'],
    ['Address', location ? location.display_address : '—'],
  ]);

  // Footer.
  page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: PAGE_W - MARGIN, y: MARGIN }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
  page.drawText('Generated by ConstructPM', { x: MARGIN, y: MARGIN - 12, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  return doc.save();
}

module.exports = WorkOrderService;
