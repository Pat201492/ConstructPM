/**
 * Equipment Tickets Routes
 *
 * Three concerns:
 *   1. Cascading equipment lookup (type → subtype → name/id) for the
 *      request form's reducing dropdowns.
 *   2. Ticket lifecycle: create → (fill) → mark picked up → archive.
 *   3. The McDonald's-style Active Tickets board feed.
 *
 * Ticket numbers come from the global monotonic counter
 * global_variables['equipment.ticket_seq'] so they survive the live-
 * row deletion that happens on pickup.
 *
 * On "mark picked up":
 *   - each scanned/filled equipment item's location → the project number
 *   - equipment.status_change_date → today
 *   - an archive row is written (ticket #, dates, pickup person, filler)
 *   - a PDF named by ticket # is generated into the system folder
 *   - the live ticket_project / ticket_equipment rows are deleted
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const db = require('../config/database');
const NotificationService = require('../services/NotificationService');
const EmailTemplateService = require('../services/EmailTemplateService');
const EmailTriggerRecipientsService = require('../services/EmailTriggerRecipientsService');

const router = express.Router();
router.use(authenticate);

// Equipment-status state machine glue. When items move on or off a
// ticket's filled list, flip equipment.status so the master list and
// the in-shop picker reflect reservation:
//   available  ─(scan/add to ticket)→  on_ticket
//   on_ticket  ─(remove from ticket)→  available
//   on_ticket  ─(ticket picked up)→    checked_out   (handled by /pickup)
// Pass arrays of barcode_id strings. UUIDs are tolerated but matched
// only when they look like UUIDs (same defensive guard as /pickup).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function syncTicketStatus({ addedIds, removedIds, trx }) {
  const knex = trx || db;
  const flip = async (ids, toStatus, fromStatuses) => {
    for (const raw of ids) {
      const num = String(raw || '').trim();
      if (!num) continue;
      await knex('equipment')
        .where(function () {
          this.where('barcode_id', num);
          if (UUID_RE.test(num)) this.orWhere('id', num);
        })
        .whereIn('status', fromStatuses)
        .update({ status: toStatus, status_change_date: knex.fn.now(), updated_at: knex.fn.now() });
    }
  };
  if (addedIds && addedIds.length) {
    // Only flip when it was sitting available — don't pull stock out
    // of maintenance_required / retired by surprise. checked_out items
    // also stay put; a separate /return path moves them back.
    await flip(addedIds, 'on_ticket', ['available']);
  }
  if (removedIds && removedIds.length) {
    // Reverse: only items still in on_ticket flip back to available.
    // If somebody picked it up between the add and the remove, leave
    // it as checked_out.
    await flip(removedIds, 'available', ['on_ticket']);
  }
}

// ── Next ticket number (atomic-ish; single-process app) ──────────
async function nextTicketNumber(trx) {
  const q = trx || db;
  const row = await q('global_variables').where('key', 'equipment.ticket_seq').first();
  const current = parseInt(row?.value || '0', 10);
  const next = current + 1;
  await q('global_variables').where('key', 'equipment.ticket_seq')
    .update({ value: String(next) });
  return next;
}

// ═══════════════════════════════════════════════════════════
// CASCADING EQUIPMENT LOOKUP
// ═══════════════════════════════════════════════════════════
//
// The request form needs reducing lists. Given any of type / subtype /
// name, return the distinct options for the others, plus the matching
// equipment rows. Empty filters → all distinct values.
router.get('/equipment-options', authorize('equipment:read'), async (req, res, next) => {
  try {
    const { equipment_type, equipment_subtype, equipment_name } = req.query;
    let q = db('equipment').whereNot('status', 'retired');
    if (equipment_type) q = q.where('equipment_type', equipment_type);
    if (equipment_subtype) q = q.where('equipment_subtype', equipment_subtype);
    if (equipment_name) q = q.where('equipment_name', equipment_name);
    const rows = await q.select(
      'id', 'barcode_id', 'equipment_name', 'equipment_type',
      'equipment_subtype', 'manufacturer'
    );

    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    res.json({
      types: uniq(rows.map(r => r.equipment_type)),
      subtypes: uniq(rows.map(r => r.equipment_subtype)),
      names: uniq(rows.map(r => r.equipment_name)),
      manufacturers: uniq(rows.map(r => r.manufacturer)),
      items: rows,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// TICKET CREATE  (web request form OR mobile)
// ═══════════════════════════════════════════════════════════
//
// Body: { project_id?, project_number, pickup_person, requestor_name,
//         location_name, location_address, site_contact_name,
//         site_contact_phone, lines: [{quantity, equipment_name,
//         equipment_type, equipment_subtype, manufacturer}] }
router.post('/', authorize('equipment:read'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!Array.isArray(b.lines) || b.lines.length === 0) {
      return res.status(400).json({ error: 'At least one equipment line is required' });
    }
    // Pat's rule: every ticket must be tied to a project so the pickup-
    // time location flip + project_number stamp have a real target.
    if (!b.project_id) {
      return res.status(400).json({ error: 'A project is required for every ticket' });
    }

    // Resolve project info. If a project_id is given, pull its number +
    // location + SITE contact (Pat: tickets use the SITE contact, not
    // the customer contact) so the form's auto-fill is authoritative
    // server-side too.
    let projInfo = {
      project_number: b.project_number || null,
      location_name: b.location_name || null,
      location_address: b.location_address || null,
      site_contact_name: b.site_contact_name || null,
      site_contact_phone: b.site_contact_phone || null,
    };
    if (b.project_id) {
      const proj = await db('projects').where('id', b.project_id).first();
      if (proj) {
        const pn = await db('project_numbers')
          .where({ project_id: proj.id, label: 'Primary' }).first();
        projInfo.project_number = projInfo.project_number || pn?.number || proj.name;
        projInfo.location_name = projInfo.location_name || proj.address || null;
        projInfo.location_address = projInfo.location_address || proj.address || null;
        projInfo.site_contact_name = projInfo.site_contact_name || proj.site_contact_name || null;
        projInfo.site_contact_phone = projInfo.site_contact_phone || proj.site_contact_phone || null;
      }
    }

    const result = await db.transaction(async (trx) => {
      const ticketNumber = await nextTicketNumber(trx);

      const [tp] = await trx('ticket_project').insert({
        ticket_number: ticketNumber,
        project_id: b.project_id || null,
        project_number: projInfo.project_number,
        pickup_person: b.pickup_person || null,
        requestor_name: b.requestor_name || null,
        location_name: projInfo.location_name,
        location_address: projInfo.location_address,
        site_contact_name: projInfo.site_contact_name,
        site_contact_phone: projInfo.site_contact_phone,
        status: 'open',
        created_by: req.user.id,
      }).returning('*');

      const lineRows = b.lines.map(l => ({
        ticket_number: ticketNumber,
        quantity: parseInt(l.quantity, 10) || 1,
        equipment_name: l.equipment_name || null,
        equipment_type: l.equipment_type || null,
        equipment_subtype: l.equipment_subtype || null,
        manufacturer: l.manufacturer || null,
        filled_items: JSON.stringify([]),
      }));
      await trx('ticket_equipment').insert(lineRows);

      return { ticket_number: ticketNumber, project: tp };
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// ACTIVE TICKETS BOARD FEED
// ═══════════════════════════════════════════════════════════
router.get('/active', authorize('equipment:read'), async (req, res, next) => {
  try {
    const projects = await db('ticket_project').orderBy('ticket_number', 'asc');
    const allLines = await db('ticket_equipment');
    const byTicket = {};
    for (const l of allLines) {
      (byTicket[l.ticket_number] = byTicket[l.ticket_number] || []).push(l);
    }
    const tickets = projects.map(p => {
      const lines = byTicket[p.ticket_number] || [];
      const totalQty = lines.reduce((s, l) => s + (l.quantity || 0), 0);
      return {
        ...p,
        total_quantity: totalQty,
        lines,
      };
    });
    res.json({ count: tickets.length, tickets });
  } catch (err) { next(err); }
});

// Single ticket detail (for the fullscreen expand)
// NOTE: defined AFTER all fixed-path GETs (/active, /archive/all,
// /equipment-options) so Express doesn't match those as a ticket
// number. Param routes must come last among GETs.
router.get('/archive/all', authorize('equipment:read'), async (req, res, next) => {
  try {
    const rows = await db('ticket_archive').orderBy('ticket_number', 'desc').limit(500);
    res.json({ archive: rows });
  } catch (err) { next(err); }
});

router.get('/:ticketNumber', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });
    const lines = await db('ticket_equipment').where('ticket_number', tn);
    res.json({ project, lines, total_quantity: lines.reduce((s, l) => s + (l.quantity || 0), 0) });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// FILL  (mobile sends scanned equipment list)
// ═══════════════════════════════════════════════════════════
//
// Body: { items: [{ equipment_number, equipment_name }] }
// Appends to the ticket's filled list (shown at card bottom). Does NOT
// flip the ticket status — shop staff scan whatever pieces are actually
// available (which may not match what the PM requested) and then press
// "Ready for Pickup" as an explicit action. That separate endpoint is
// what records the trigger_event the email pipeline keys off of.
// Equipment.status still flips to 'on_ticket' on add so the in-shop
// picker doesn't double-list anything.
router.post('/:ticketNumber/fill', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const newIds = items.map(i => String(i.equipment_number || i.barcode_id || '').trim()).filter(Boolean);

    // Read the prior list so we can diff and flip equipment.status only
    // for entries that actually changed (add or remove).
    const firstLine = await db('ticket_equipment').where('ticket_number', tn).first();
    let priorIds = [];
    if (firstLine?.filled_items) {
      try {
        const arr = typeof firstLine.filled_items === 'string'
          ? JSON.parse(firstLine.filled_items) : firstLine.filled_items;
        priorIds = (arr || []).map(i => String(i.equipment_number || i.barcode_id || '').trim()).filter(Boolean);
      } catch {}
    }
    const newSet = new Set(newIds.map(s => s.toLowerCase()));
    const priorSet = new Set(priorIds.map(s => s.toLowerCase()));
    const addedIds = newIds.filter(s => !priorSet.has(s.toLowerCase()));
    const removedIds = priorIds.filter(s => !newSet.has(s.toLowerCase()));

    if (firstLine) {
      await db('ticket_equipment').where('id', firstLine.id)
        .update({ filled_items: JSON.stringify(items), updated_at: db.fn.now() });
    }

    await syncTicketStatus({ addedIds, removedIds });

    res.json({ ok: true, ticket_number: tn, filled: items.length, added: addedIds.length, removed: removedIds.length });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// READY FOR PICKUP  → manual button + trigger_event for email
// ═══════════════════════════════════════════════════════════
// Pat's rule: shop staff press this when they've gathered whatever they
// could actually find (which may not match the PM's request — sometimes
// the exact piece is out, so a substitute gets scanned). The press is
// the email trigger. The deferred email pipeline reads trigger_events
// and fans the notice out to PM + Shop Manager + pickup person.
router.post('/:ticketNumber/ready-for-pickup', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });

    await db('ticket_project').where('ticket_number', tn)
      .update({ status: 'filled', updated_at: db.fn.now() });

    await db('trigger_events').insert({
      event_type: 'ticket_ready_for_pickup',
      reference_type: 'equipment_ticket',
      payload: JSON.stringify({
        ticket_number: tn,
        project_id: project.project_id,
        project_number: project.project_number,
        pickup_person: project.pickup_person,
        requestor_name: project.requestor_name,
      }),
      created_by: req.user.id,
    });

    res.json({ ok: true, ticket_number: tn, status: 'filled' });
  } catch (err) { next(err); }
});

// Edit ticket lines (mobile add/remove → marks unpicked)
router.patch('/:ticketNumber/lines', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (!lines) return res.status(400).json({ error: 'lines array required' });

    // Edits reset filled_items to []. Capture the prior filled list so
    // any equipment we had reserved (status='on_ticket') flips back to
    // available before the row is rewritten.
    const priorFirstLine = await db('ticket_equipment').where('ticket_number', tn).first();
    let priorIds = [];
    if (priorFirstLine?.filled_items) {
      try {
        const arr = typeof priorFirstLine.filled_items === 'string'
          ? JSON.parse(priorFirstLine.filled_items) : priorFirstLine.filled_items;
        priorIds = (arr || []).map(i => String(i.equipment_number || i.barcode_id || '').trim()).filter(Boolean);
      } catch {}
    }

    await db.transaction(async (trx) => {
      await trx('ticket_equipment').where('ticket_number', tn).del();
      if (lines.length) {
        await trx('ticket_equipment').insert(lines.map(l => ({
          ticket_number: tn,
          quantity: parseInt(l.quantity, 10) || 1,
          equipment_name: l.equipment_name || null,
          equipment_type: l.equipment_type || null,
          equipment_subtype: l.equipment_subtype || null,
          manufacturer: l.manufacturer || null,
          filled_items: JSON.stringify([]),
        })));
      }
      // Any edit un-fills the ticket — must be re-confirmed/picked.
      await trx('ticket_project').where('ticket_number', tn)
        .update({ status: 'open', updated_at: trx.fn.now() });
      if (priorIds.length) {
        await syncTicketStatus({ removedIds: priorIds, trx });
      }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Confirm picked (mobile) — after an add/remove edit unpicked the
// ticket, the user re-confirms. This REGENERATES the PDF (overwriting
// the prior copy named by ticket #) and flips status back to 'filled',
// but does NOT archive/delete — that only happens on the authoritative
// /pickup. Per the mobile contract: "reconfirm overrides the PDF".
router.post('/:ticketNumber/confirm-picked', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });
    const lines = await db('ticket_equipment').where('ticket_number', tn);
    let filled = [];
    if (lines[0]) {
      try {
        filled = typeof lines[0].filled_items === 'string'
          ? JSON.parse(lines[0].filled_items) : (lines[0].filled_items || []);
      } catch { filled = []; }
    }
    let pdfPath = null;
    try { pdfPath = await generateTicketPdf(project, lines, filled); }
    catch (e) { console.error('[confirm-picked] PDF failed:', e.message); }
    await db('ticket_project').where('ticket_number', tn)
      .update({ status: 'filled', updated_at: db.fn.now() });
    res.json({ ok: true, ticket_number: tn, pdf_path: pdfPath });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// MARK READY FOR PICK-UP → notify requestor (in-app + email)
// ═══════════════════════════════════════════════════════════
//
// Manual gate between /fill (shop has scanned items in) and /pickup
// (crew has physically taken them). Clicking the button on the active-
// ticket card flips status to 'ready_for_pickup', stamps ready_at +
// ready_by, and sends a notification to the user who created the ticket
// plus all admins. Email delivery rides on NotificationService.send —
// in dev (no EMAIL_PROVIDER) it logs; in prod it ships via SES/SendGrid
// with zero code change. See [[email-provider-status]] memory.
router.post('/:ticketNumber/ready', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });

    // Require something filled first — clicking Ready on an empty ticket
    // would mean "notify the requestor we've staged nothing," which is
    // never the intent.
    if (project.status === 'open') {
      return res.status(409).json({ error: 'Ticket has no scanned items yet — fill it before marking ready' });
    }
    if (project.status === 'picked_up') {
      return res.status(409).json({ error: 'Ticket already picked up' });
    }

    const readyAt = new Date();
    await db('ticket_project').where('ticket_number', tn).update({
      status: 'ready_for_pickup',
      ready_at: readyAt,
      ready_by: req.user.id,
      updated_at: db.fn.now(),
    });

    // Fire-and-forget notification — never block the status flip on a
    // delivery hiccup. Email channel is the trigger Pat asked for; the
    // body summarises the ticket so the requestor knows what's ready.
    notifyTicketReady({ project, ticketNumber: tn, triggerUser: req.user })
      .catch(err => console.error('[ticket ready] Notification failed:', err.message));

    res.json({ ok: true, ticket_number: tn, ready_at: readyAt.toISOString() });
  } catch (err) { next(err); }
});

async function notifyTicketReady({ project, ticketNumber, triggerUser }) {
  const recipients = new Set();
  if (project.created_by) recipients.add(project.created_by);
  const admins = await db('users').where({ role: 'admin', active: true }).pluck('id');
  admins.forEach(id => recipients.add(id));
  if (recipients.size === 0) return;

  const locationLine = [project.location_name, project.location_address]
    .filter(Boolean).join(' — ');
  const title = `Ticket #${ticketNumber} ready for pick-up`;
  const bodyParts = [
    `Equipment for project ${project.project_number || '—'} is staged and ready.`,
    project.pickup_person ? `Pick-up: ${project.pickup_person}.` : null,
    locationLine ? `Location: ${locationLine}.` : null,
  ].filter(Boolean);

  // In-app channel: still one notifications row per recipient + WebSocket
  // push. Email channel is split out below so the body comes from the
  // admin-editable `ticket_ready_pickup` template and the recipient list
  // merges the admin-configured static list (shop manager + extras) with
  // the modular set derived from this row.
  await NotificationService.send({
    userIds: [...recipients],
    type: 'equipment_ticket_ready',
    title,
    body: bodyParts.join(' '),
    category: 'actionable',
    priority: 'high',
    // actionUrl intentionally omitted — SPA doesn't have a deep-link
    // route to a specific ticket modal yet; in-app users will see the
    // notification and click into the Active Tickets board. The ticket
    // number is in the title/body so email recipients can still locate it.
    referenceType: 'equipment_ticket',
    referenceId: project.id, // uuid — notifications.reference_id is uuid; ticket # rides in actionUrl
    channels: ['in_app'],
  });

  // Email channel: render the editable template, then merge active
  // recipient emails with the admin static list (resolve()) and send
  // one bulk email. No userId passed to render() — this is a bulk
  // send to N recipients (created_by + admins + admin-configured
  // static list), so no single user's override can govern the body;
  // we always use the admin template. `triggerUser` is still used to
  // populate the `{{created_by_name}}` variable so the recipients can
  // see who flagged the ticket ready.
  const recipientUsers = await db('users')
    .whereIn('id', [...recipients])
    .where('active', true)
    .pluck('email');
  const modularEmails = recipientUsers.filter(Boolean);

  const createdByName = triggerUser
    ? `${triggerUser.first_name || ''} ${triggerUser.last_name || ''}`.trim()
    : '';

  const rendered = await EmailTemplateService.render(
    'ticket_ready_pickup',
    {
      ticket_number: String(ticketNumber),
      project_number: project.project_number || '',
      pickup_person: project.pickup_person || '',
      location: locationLine,
      created_by_name: createdByName,
    },
    null,
  );

  const { to, cc } = await EmailTriggerRecipientsService.resolve('ticket_ready_pickup', modularEmails);
  if (to.length === 0) return;

  await NotificationService.sendEmail({
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text || undefined,
  });
}

// ═══════════════════════════════════════════════════════════
// MARK PICKED UP  → side effects + archive + PDF + delete live rows
// ═══════════════════════════════════════════════════════════
router.post('/:ticketNumber/pickup', authorize('equipment:read'), async (req, res, next) => {
  try {
    const tn = parseInt(req.params.ticketNumber, 10);
    const project = await db('ticket_project').where('ticket_number', tn).first();
    if (!project) return res.status(404).json({ error: 'Ticket not found' });
    const lines = await db('ticket_equipment').where('ticket_number', tn);

    const today = new Date().toISOString().slice(0, 10);
    const me = await db('users').where('id', req.user.id).first();
    const fillerName = me ? `${me.first_name} ${me.last_name}`.trim() : null;

    // Equipment location side-effect: for every scanned/filled item,
    // set that equipment's location to the project number and stamp
    // status_change_date. Filled items live on the first line's
    // filled_items jsonb (populated by /fill).
    const firstLine = lines[0];
    let filled = [];
    if (firstLine) {
      try {
        filled = typeof firstLine.filled_items === 'string'
          ? JSON.parse(firstLine.filled_items) : (firstLine.filled_items || []);
      } catch { filled = []; }
    }
    // Flip every scanned/typed item over to the project: location label,
    // status, and current_project_id (so the Equipment master list shows
    // it as checked out and the project's detail page sees it in
    // equipment_out). Per Pat's rule the ticket is the authoritative
    // hand-off — pickup is the only place this transition happens.
    // Match by barcode_id always; also try id only when the value looks
    // like a UUID — otherwise pg rejects the string with "invalid input
    // syntax for type uuid" and the whole transaction blows up. That
    // crash existed pre-fully_staffed too; the merge here just made it
    // user-visible.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const f of filled) {
      const num = f.equipment_number || f.barcode_id || f.equipment_id;
      if (!num) continue;
      await db('equipment')
        .where(function () {
          this.where('barcode_id', num);
          if (UUID_RE.test(String(num))) this.orWhere('id', num);
        })
        .update({
          current_location: project.project_number || 'project',
          current_project_id: project.project_id || null,
          status: 'checked_out',
          status_change_date: today,
          updated_at: db.fn.now(),
        });
    }

    // Generate the ticket PDF into the system folder.
    let pdfPath = null;
    try {
      pdfPath = await generateTicketPdf(project, lines, filled);
    } catch (e) {
      console.error('[ticket pickup] PDF generation failed:', e.message);
      // Non-fatal — archive still recorded; PDF can be regenerated.
    }

    await db.transaction(async (trx) => {
      await trx('ticket_archive').insert({
        ticket_number: tn,
        project_number: project.project_number,
        filled_date: project.status === 'filled' ? today : today,
        picked_up_date: today,
        pickup_person: project.pickup_person || null,
        filler: fillerName,
        pdf_path: pdfPath,
      }).onConflict('ticket_number').merge();

      // Delete live rows — the archive + PDF are the permanent record.
      await trx('ticket_equipment').where('ticket_number', tn).del();
      await trx('ticket_project').where('ticket_number', tn).del();
    });

    res.json({ ok: true, ticket_number: tn, pdf_path: pdfPath });
  } catch (err) { next(err); }
});

// ── PDF generation ───────────────────────────────────────────────
// Writes a ticket PDF named by ticket number into the system tickets
// folder. Uses pdf-lib (the project's PDF library — pdfkit is NOT a
// dependency). pdf-lib has no text-flow, so we lay out lines manually
// with a simple cursor and page-break guard.
async function generateTicketPdf(project, lines, filled) {
  const path = require('path');
  const fs = require('fs');
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  const base = process.env.STORAGE_BASE_PATH || './storage';
  const dir = path.join(base, 'tickets');
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `Ticket_${project.ticket_number}.pdf`);

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const left = 50;
  let y = 742;

  const line = (text, opts = {}) => {
    const size = opts.size || 11;
    const f = opts.bold ? bold : font;
    if (y < 60) { page = pdf.addPage([612, 792]); y = 742; }
    page.drawText(String(text == null ? '' : text), {
      x: left, y, size, font: f,
      color: opts.color || rgb(0, 0, 0),
    });
    y -= (opts.gap || size + 6);
  };

  line(`Equipment Ticket #${project.ticket_number}`, { size: 20, bold: true, gap: 30 });
  line(`Project: ${project.project_number || '—'}`);
  line(`Pickup Person: ${project.pickup_person || '—'}`);
  line(`Requestor: ${project.requestor_name || '—'}`);
  line(`Location: ${project.location_name || '—'}`);
  line(`Address: ${project.location_address || '—'}`);
  line(`Site Contact: ${project.site_contact_name || '—'} ${project.site_contact_phone || ''}`);
  y -= 8;
  line('Requested Equipment', { size: 13, bold: true, gap: 22 });
  for (const l of lines) {
    const detail = l.equipment_type
      ? ` (${l.equipment_type}${l.equipment_subtype ? ' / ' + l.equipment_subtype : ''})` : '';
    line(`  ${l.quantity} x ${l.equipment_name || '—'}${detail}`);
  }

  if (filled && filled.length) {
    y -= 8;
    line('Filled / Scanned', { size: 13, bold: true, gap: 22 });
    for (const f of filled) {
      line(`  ${f.equipment_number || f.barcode_id || '—'}  ${f.equipment_name || ''}`);
    }
  }

  y -= 10;
  line(`Generated ${new Date().toLocaleString()}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });

  const bytes = await pdf.save();
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

// Archived tickets list is defined earlier (before the /:ticketNumber
// param route) to avoid Express shadowing.

module.exports = router;
