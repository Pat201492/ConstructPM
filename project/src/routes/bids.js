/**
 * Bid Routes (v2)
 * 
 * Complete bid lifecycle:
 *   POST   /              — Create bid (auto-generates bid number)
 *   GET    /              — List bids
 *   GET    /stats         — Bid statistics
 *   GET    /:id           — Bid detail + quote lines
 *   PATCH  /:id           — Update bid fields
 *   POST   /:id/quote     — Save/update quoting table (locks rates)
 *   POST   /:id/generate  — Generate Excel + Word documents
 *   POST   /:id/initiate-won — Step 1: OCR Word doc → return fields for verification
 *   POST   /:id/confirm-won  — Step 2: User confirms → project creation
 *   POST   /:id/mark-lost
 *   POST   /:id/archive
 *   POST   /:id/snooze
 *   DELETE /:id           — Cancel bid
 *   GET    /:id/files     — List files in bid folder
 */

const express = require('express');
const { body, param } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const Bid = require('../models/Bid');
const BidQuoteLine = require('../models/BidQuoteLine');
const RateSheet = require('../models/RateSheet');
const GlobalVariable = require('../models/GlobalVariable');
const Project = require('../models/Project');
const FileService = require('../services/FileService');
const db = require('../config/database');
const BidDocumentService = require('../services/BidDocumentService');
const NotificationService = require('../services/NotificationService');
const EmailTemplateService = require('../services/EmailTemplateService');
const EmailTriggerRecipientsService = require('../services/EmailTriggerRecipientsService');

const router = express.Router();
router.use(authenticate);

// ═══════════════════════════════════════════════════════════
// LIST & STATS
// ═══════════════════════════════════════════════════════════

// Helper: resolve bid visibility for current user
async function resolveBidVisibility(user) {
  const roleConfig = await db('role_configurations').where('role_name', user.role).first();
  // Per-user override > role default
  const userAccess = user.access_config ? (typeof user.access_config === 'string' ? JSON.parse(user.access_config) : user.access_config) : {};
  return userAccess.bid_visibility || roleConfig?.bid_visibility || 'own';
}

router.get('/', authorize('bids:read'), async (req, res, next) => {
  try {
    const { status, customer_id, location_id, search, limit, offset, pm_id } = req.query;
    const visibility = await resolveBidVisibility(req.user);
    const isAdmin = req.user.role === 'admin';

    if (visibility === 'none') return res.json({ bids: [], total: 0 });

    const findArgs = {
      status, customer_id, location_id, search,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    };

    if (visibility === 'own') {
      // 'own' = bids where the user is EITHER the estimator OR the assigned PM.
      // This is what makes the estimator hand-off work: when an estimator
      // assigns a bid to a PM, both can see it from this point on.
      findArgs.visible_to_user_id = req.user.id;
    } else if (isAdmin && pm_id) {
      // Admin filtering by a specific user — applies to BOTH columns
      // so admin sees bids that user is involved with either as estimator or PM.
      findArgs.visible_to_user_id = pm_id;
    }

    const result = await Bid.findAll(findArgs);

    // For 'assigned' visibility, filter to only bid_assignments-table-assigned bids
    if (visibility === 'assigned') {
      const assignedBidIds = await db('bid_assignments').where('user_id', req.user.id).pluck('bid_id');
      result.bids = result.bids.filter(b => assignedBidIds.includes(b.id));
      result.total = result.bids.length;
    }

    res.json(result);
  } catch (err) { next(err); }
});

router.get('/stats', authorize('bids:read'), async (req, res, next) => {
  try {
    const visibility = await resolveBidVisibility(req.user);
    const isAdmin = req.user.role === 'admin';

    // Determine the user-filter for the OR-match (estimator_id OR assigned_pm_id):
    //   - If non-admin with 'own' visibility, force their own user id
    //   - If admin and pm_id query param provided, filter by that user
    //   - Otherwise admin sees all bids
    let visible_to_user_id = null;
    if (visibility === 'own') {
      visible_to_user_id = req.user.id;
    } else if (isAdmin && req.query.pm_id) {
      visible_to_user_id = req.query.pm_id;
    }

    // Customer filter is available to anyone
    const customer_id = req.query.customer_id || null;

    const stats = await Bid.getStats({ visible_to_user_id, customer_id });
    res.json(stats);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// GET DETAIL
// ═══════════════════════════════════════════════════════════

router.get('/:id', authorize('bids:read'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    // Include quote lines
    const quoteLines = await BidQuoteLine.findByBid(bid.id);
    const totals = await BidQuoteLine.getTotals(bid.id);

    res.json({ ...bid, quote_lines: quoteLines, quote_totals: totals });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CREATE BID
// ═══════════════════════════════════════════════════════════

router.post('/',
  authorize('bids:create'),
  [body('project_scope').trim().notEmpty().withMessage('Scope is required')],
  async (req, res, next) => {
    try {
      const { customer_id, customer_contact_id, site_contact_id, location_id, project_scope, description, assigned_pm_id } = req.body;

      // Validate assigned PM if provided — must be a real user with project_manager role
      if (assigned_pm_id) {
        const pmUser = await db('users').where({ id: assigned_pm_id, role: 'project_manager', active: true }).first();
        if (!pmUser) {
          return res.status(400).json({ error: 'Assigned PM must be an active project manager' });
        }
      }

      // Generate bid number: YY-PMInitials-NextNum
      const bid_number = await Bid.generateBidNumber(req.user.id);

      // Pull location data if provided
      let local_union = null;
      let miles_from_hq = null;
      let locationName = '';
      if (location_id) {
        const Location = require('../models/Location');
        const loc = await Location.findById(location_id);
        if (loc) {
          local_union = loc.local_union;
          miles_from_hq = loc.miles_from_hq;
          locationName = loc.name || loc.town || '';
        }
      }

      // Resolve the default assigned PM:
      //   - explicit assigned_pm_id from the form takes priority (already validated above)
      //   - if current user is a PM, default to themselves (single-role workflow)
      //   - if current user is an estimator with no assignment, leave null (estimator queue)
      //   - if current user is admin and no assignment was provided, that's an error caught earlier
      let resolvedAssignedPmId = assigned_pm_id || null;
      if (!resolvedAssignedPmId && req.user.role === 'project_manager') {
        resolvedAssignedPmId = req.user.id;
      }

      // Resolve site contact → denormalized name + phone. Site contact
      // defaults to the customer contact (per Pat) when not explicitly
      // chosen; the frontend already mirrors, but enforce here too so
      // the API is correct even if called directly.
      const effectiveSiteContactId = site_contact_id || customer_contact_id || null;
      let siteContactName = null, siteContactPhone = null;
      if (effectiveSiteContactId) {
        const sc = await db('contacts').where('id', effectiveSiteContactId).first();
        if (sc) { siteContactName = sc.name; siteContactPhone = sc.phone || null; }
      }

      const bid = await Bid.create({
        bid_number,
        customer_id: customer_id || null,
        customer_contact_id: customer_contact_id || null,
        site_contact_id: effectiveSiteContactId,
        site_contact_name: siteContactName,
        site_contact_phone: siteContactPhone,
        location_id: location_id || null,
        estimator_id: req.user.id,
        assigned_pm_id: resolvedAssignedPmId,
        project_scope,
        description: description || null,
        local_union,
        miles_from_hq,
        bid_date: new Date().toISOString().split('T')[0],
        status: 'draft',
      });

      // Create bid folder: {PMInitials}{Seq}_{Location}_{Scope}
      try {
        const user = await db('users').where({id: req.user.id}).first();
        const initials = user.initials || (user.first_name[0] + user.last_name[0]).toUpperCase();
        // Extract seq number from bid_number (format: YY-XX-001 → 001)
        const seqMatch = bid_number.match(/(\d+)$/);
        const seqNum = seqMatch ? parseInt(seqMatch[1]) : 1;
        const folderPath = await FileService.createBidFolders(initials, seqNum, locationName, project_scope);
        await Bid.update(bid.id, { folder_path: folderPath });
        bid.folder_path = folderPath;
      } catch (err) {
        console.error('[Bids] Folder creation error:', err.message);
      }

      res.status(201).json(bid);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Bid number already exists' });
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// SAVE QUOTING TABLE
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/bids/:id/quote
 * Saves the quoting table data. Locks rates from rate_sheet at this moment.
 * Body: { markup_pct, project_length_days, lines: [{classification, personnel, st_hours, ot_hours, dt_hours}] }
 */
router.post('/:id/quote', authorize('bids:create'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.status !== 'draft') return res.status(400).json({ error: 'Can only edit quote on draft bids' });

    const { markup_pct, project_length_days, per_diem_rate, lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'At least one quote line is required' });
    }

    // Look up rates from rate_sheet for this local union and LOCK them.
    // Same fallback as on read (frontend bid-quote page): if the bid's
    // own local_union is null (e.g., bid created without a location, or
    // bid migrated from an older schema), try the linked location's
    // current local_union before giving up. Without this, the quote
    // would save with all rates = 0 silently.
    let localUnion = bid.local_union;
    if (!localUnion && bid.location_id) {
      try {
        const loc = await db('locations').where('id', bid.location_id).first();
        if (loc) localUnion = loc.local_union;
      } catch {}
    }
    const rateMap = {};
    if (localUnion) {
      const rates = await RateSheet.getByLocal(localUnion);
      for (const r of rates) {
        rateMap[r.classification] = { st_rate: r.st_rate, ot_rate: r.ot_rate, dt_rate: r.dt_rate };
      }
    }

    // Merge user-entered hours with locked rates (user rates used if no rate sheet match)
    const enrichedLines = lines.map(line => {
      const rates = rateMap[line.classification];
      return {
        classification: line.classification,
        personnel: line.personnel || 0,
        st_hours: line.st_hours || 0,
        ot_hours: line.ot_hours || 0,
        dt_hours: line.dt_hours || 0,
        st_rate: rates ? parseFloat(rates.st_rate) : parseFloat(line.st_rate || 0),
        ot_rate: rates ? parseFloat(rates.ot_rate) : parseFloat(line.ot_rate || 0),
        dt_rate: rates ? parseFloat(rates.dt_rate) : parseFloat(line.dt_rate || 0),
      };
    });

    // Save quote lines (replaces existing)
    const savedLines = await BidQuoteLine.replaceForBid(bid.id, enrichedLines);

    // Calculate totals
    const totals = await BidQuoteLine.getTotals(bid.id);
    const dollarPerMile = await GlobalVariable.getDollarPerMile();
    const milesOneWay = parseFloat(bid.miles_from_hq) || 0;
    const totalMileageCost = milesOneWay * 2 * totals.total_personnel * (project_length_days || 0) * dollarPerMile;

    // Per diem: rate × personnel × project days
    const effectivePerDiem = per_diem_rate != null ? parseFloat(per_diem_rate) : parseFloat(
      (await db('global_variables').where('key', 'per_diem_daily_rate').first())?.value || '0'
    );
    const totalPerDiem = effectivePerDiem * totals.total_personnel * (project_length_days || 0);

    // Check if markup applies to per diem
    const markupAppliesGlobal = (await db('global_variables').where('key', 'per_diem_markup_applies').first())?.value;
    const markupAppliesToPerDiem = markupAppliesGlobal === 'true';

    // Subtotal = labor + mileage (per diem is separate by default)
    const subtotal = totals.total_labor_cost + totalMileageCost;
    const markupBase = markupAppliesToPerDiem ? (subtotal + totalPerDiem) : subtotal;
    const markupAmount = markupBase * ((markup_pct || 0) / 100);
    const bidAmount = subtotal + markupAmount + totalPerDiem;

    // Update bid with calculated totals
    await Bid.update(bid.id, {
      markup_pct: markup_pct || 0,
      project_length_days: project_length_days || 0,
      total_labor_cost: totals.total_labor_cost,
      total_mileage_cost: totalMileageCost,
      per_diem_rate: effectivePerDiem,
      total_per_diem: totalPerDiem,
      subtotal,
      bid_amount: bidAmount,
    });

    res.json({
      bid_id: bid.id,
      markup_pct: markup_pct || 0,
      project_length_days: project_length_days || 0,
      per_diem_rate: effectivePerDiem,
      lines: savedLines,
      totals: {
        total_labor_cost: totals.total_labor_cost,
        total_mileage_cost: totalMileageCost,
        total_per_diem: totalPerDiem,
        subtotal,
        markup_amount: markupAmount,
        grand_total: bidAmount,
        total_personnel: totals.total_personnel,
        total_man_hours: totals.total_man_hours,
      },
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// GENERATE DOCUMENTS (Excel + Word)
// ═══════════════════════════════════════════════════════════

router.post('/:id/generate', authorize('bids:create'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    // If no quote lines exist yet, auto-save current lines from request body
    let quoteLines = await BidQuoteLine.findByBid(bid.id);
    if (quoteLines.length === 0 && req.body.lines && req.body.lines.length > 0) {
      // Save lines from request — apply the same local_union fallback
      // as the quote-save path so rates aren't silently $0 when the
      // bid's stored local_union is stale.
      let localUnion = bid.local_union;
      if (!localUnion && bid.location_id) {
        try {
          const loc = await db('locations').where('id', bid.location_id).first();
          if (loc) localUnion = loc.local_union;
        } catch {}
      }
      const rateMap = {};
      if (localUnion) {
        const rates = await RateSheet.getByLocal(localUnion);
        for (const r of rates) rateMap[r.classification] = { st_rate: r.st_rate, ot_rate: r.ot_rate, dt_rate: r.dt_rate };
      }
      const enrichedLines = req.body.lines.map(line => {
        const rates = rateMap[line.classification];
        return {
          classification: line.classification,
          personnel: line.personnel || 0,
          st_hours: line.st_hours || 0, ot_hours: line.ot_hours || 0, dt_hours: line.dt_hours || 0,
          st_rate: rates ? parseFloat(rates.st_rate) : parseFloat(line.st_rate || 0),
          ot_rate: rates ? parseFloat(rates.ot_rate) : parseFloat(line.ot_rate || 0),
          dt_rate: rates ? parseFloat(rates.dt_rate) : parseFloat(line.dt_rate || 0),
        };
      });
      await BidQuoteLine.replaceForBid(bid.id, enrichedLines);
      quoteLines = await BidQuoteLine.findByBid(bid.id);
    }

    if (quoteLines.length === 0) return res.status(400).json({ error: 'No quote lines — save the quoting table first' });

    const dollarPerMile = await GlobalVariable.getDollarPerMile();
    const basePath = bid.folder_path || `./storage/bids/${bid.estimator_id}/${bid.bid_number}`;

    // Generate Excel
    const excelPath = `${basePath}/Bid_${bid.bid_number}.xlsx`;
    const excelResult = await BidDocumentService.generateExcel(
      bid, quoteLines, { dollar_per_mile: dollarPerMile }, excelPath
    );

    // Calculate bid_amount with markup
    const markup = parseFloat(req.body.markup_pct || bid.markup_pct || 0);
    const subtotal = excelResult.totals.subtotal || 0;
    const bidAmount = subtotal + subtotal * (markup / 100);

    // Update bid with calculated totals
    await Bid.update(bid.id, {
      total_labor_cost: excelResult.totals.total_labor_cost,
      total_mileage_cost: excelResult.totals.total_mileage_cost,
      subtotal,
      bid_amount: bidAmount,
      excel_file_path: excelPath,
    });

    // Generate Word doc from template
    // Priority: PM's bid template > admin default bid template > skip
    let wordPath = null;
    let template = await db('bid_templates')
      .where('pm_id', bid.estimator_id)
      .where('template_type', 'bid')
      .orderBy('created_at', 'desc').first();

    if (!template) {
      // Fall back to any bid template (admin default)
      template = await db('bid_templates')
        .where('template_type', 'bid')
        .orderBy('created_at', 'asc').first();
    }

    if (template) {
      wordPath = `${basePath}/Bid_${bid.bid_number}.docx`;
      const storagePath = process.env.STORAGE_BASE_PATH || './storage';
      const templateFullPath = require('path').join(storagePath, template.file_path);
      const refreshedBid = await Bid.findById(bid.id);
      await BidDocumentService.generateWord(refreshedBid, quoteLines, templateFullPath, wordPath);
      await Bid.update(bid.id, { word_doc_path: wordPath });
    }

    res.json({
      excel_path: excelPath,
      word_doc_path: wordPath,
      totals: excelResult.totals,
      bid_amount: bidAmount,
      message: wordPath ? 'Excel and Word documents generated' : 'Excel generated (no Word template found — upload one in Settings)',
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// BID STATUS CHANGES
// ═══════════════════════════════════════════════════════════

/**
 * POST /:id/initiate-won — Step 1: OCR the Word doc, return fields for verification
 * Returns extracted fields with checkboxes for user to confirm/edit.
 */
router.post('/:id/initiate-won', authorize('bids:mark_won'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.status === 'won') return res.status(400).json({ error: 'Bid already won' });

    const quoteTotals = await BidQuoteLine.getTotals(bid.id);

    // If Word doc exists, OCR it to extract the final bid amount
    let ocrFields = null;
    if (bid.word_doc_path) {
      try {
        const ExtractionService = require('../services/ExtractionService');
        const { text } = await ExtractionService.extractText(bid.word_doc_path);
        const result = await ExtractionService.extractFields(text, 'contract'); // Use contract prompt for bid docs
        ocrFields = result.extracted_data;
      } catch (err) {
        console.error('[Bids] OCR failed:', err.message);
      }
    }

    // Location address fallback. If the join'd display_address is
    // empty (e.g. location row was created before the address-builder
    // updates landed and never re-saved), rebuild from the raw fields
    // so this modal doesn't show a blank. Doesn't write back to the
    // DB — that's the migration's job; this just keeps the UX clean.
    let resolvedAddress = bid.location_address;
    if (!resolvedAddress || !String(resolvedAddress).trim()) {
      if (bid.location_id) {
        try {
          const loc = await db('locations').where('id', bid.location_id).first();
          if (loc) {
            const cityState = [loc.town, loc.state].filter(Boolean).join(', ');
            const tail = [cityState, loc.zip].filter(Boolean).join(' ');
            resolvedAddress = [loc.street, tail].filter(Boolean).join(', ');
          }
        } catch {}
      }
    }

    // Build verification fields — pre-populated from bid data + OCR overlay.
    // bid.bid_amount is the FINAL customer-facing amount (subtotal + markup
    // + per diem) calculated and stored by the quote endpoint. Earlier
    // version of this code read bid.subtotal — which is the pre-markup
    // labor+mileage figure, so the verify modal would either show the
    // wrong number or empty when subtotal wasn't set. bid_amount is what
    // should land on the resulting project's contract_value.
    const verificationFields = {
      bid_amount: {
        value: ocrFields?.value || bid.bid_amount || bid.subtotal || 0,
        source: ocrFields?.value ? 'ocr' : 'calculated',
        editable: true,
      },
      customer_name: {
        value: bid.customer_name || '',
        source: 'database',
        editable: true,
      },
      location_name: {
        value: bid.location_name || '',
        source: 'database',
        editable: true,
      },
      location_address: {
        value: resolvedAddress || '',
        source: 'database',
        editable: true,
      },
      project_scope: {
        value: bid.project_scope || '',
        source: 'database',
        editable: true,
      },
      local_union: {
        value: bid.local_union || '',
        source: 'database',
        editable: true,
      },
      contract_man_hours: {
        value: quoteTotals.total_man_hours || 0,
        source: 'quoting_system',
        editable: true, // Pat: PM can adjust before submit
      },
      // Manpower + project length auto-populate from the bid matrix so
      // the project carries them into the scheduler. Editable here —
      // the PM gets a chance to correct the estimate before the project
      // is created and these flow to the scheduling card.
      manpower: {
        value: quoteTotals.total_personnel || 0,
        source: 'quoting_system',
        editable: true,
      },
      project_length_days: {
        value: bid.project_length_days || 0,
        source: 'bid',
        editable: true,
      },
      contact_name: {
        value: bid.contact_name || '',
        source: 'database',
        editable: true,
      },
    };

    res.json({
      bid_id: bid.id,
      bid_number: bid.bid_number,
      verification_fields: verificationFields,
      ocr_performed: !!ocrFields,
      message: 'Review and confirm these fields to create the project.',
    });
  } catch (err) { next(err); }
});

/**
 * POST /:id/confirm-won — Step 2: User confirms verified fields → create project
 * Body: { confirmed_fields: { bid_amount, customer_name, location_name, ... } }
 *
 * Both this endpoint and POST /:id/quick-project funnel into the same
 * createProjectFromBid() helper. The ONLY difference is where
 * confirmed_fields comes from:
 *   - confirm-won  : user-verified fields from the OCR verification modal
 *   - quick-project: fields read straight off the bid matrix (no OCR,
 *                     no modal) — for when the PM trusts the bid data
 *                     as-is and just wants the project created now.
 */

// Shared project-creation routine. Assumes bid is loaded and not
// already won. confirmedFields is a plain object with the same shape
// the verification modal produces. Returns { bid, project }.
async function createProjectFromBid(bid, confirmedFields) {
  // A project requires a PM owner. Resolution order:
  //   1. The bid's assigned_pm_id
  //   2. The estimator IF the estimator is a project_manager
  //   3. Otherwise — error
  let projectPmId = bid.assigned_pm_id || null;
  if (!projectPmId) {
    const estimator = await db('users').where({ id: bid.estimator_id }).first();
    if (estimator?.role === 'project_manager') {
      projectPmId = bid.estimator_id;
    } else {
      throw Object.assign(
        new Error('This bid has no Project Manager assigned. Edit the bid to assign a PM before marking it won.'),
        { status: 400 }
      );
    }
  }

  const bidAmount = confirmedFields.bid_amount || bid.bid_amount || bid.subtotal;

  const result = await db.transaction(async (trx) => {
    const [wonBid] = await trx('bids').where({ id: bid.id }).update({
      status: 'won', won_date: trx.fn.now(), bid_amount: bidAmount, updated_at: trx.fn.now(),
    }).returning('*');

    const quoteTotals = await BidQuoteLine.getTotals(bid.id);

    const projectName = `${confirmedFields.location_name || bid.location_name || 'Project'} - ${confirmedFields.project_scope || bid.project_scope}`;
    const [project] = await trx('projects').insert({
      name: projectName,
      year: new Date().getFullYear(),
      customer_id: bid.customer_id,
      location_id: bid.location_id,
      pm_id: projectPmId,
      bid_id: bid.id,
      status: 'active',
      contract_value: bidAmount,
      contract_man_hours: confirmedFields.contract_man_hours || quoteTotals.total_man_hours,
      local_union: confirmedFields.local_union || bid.local_union,
      miles_from_hq: bid.miles_from_hq,
      per_diem_rate: wonBid.per_diem_rate || 0,
      // Project length + manpower: prefer what the PM confirmed in the
      // verify modal (confirmedFields), fall back to bid/quote values.
      // quick-project passes neither so it falls back automatically.
      project_length_days: confirmedFields.project_length_days || wonBid.project_length_days || null,
      manpower: confirmedFields.manpower || quoteTotals.total_personnel || null,
      address: confirmedFields.location_address || bid.location_address || bid.location_name,
      description: confirmedFields.project_scope || bid.project_scope,
      // Carry both contacts onto the project, denormalized. Pat's rule:
      // store id + name (+ phone for site) so calendar cards, project
      // detail, equipment tickets, and the Work Order Email read the
      // name straight off the project row without a join, while the id
      // remains the stable link back to the contacts master.
      customer_contact_id: bid.customer_contact_id || null,
      customer_contact_name: bid.contact_name || null,
      site_contact_id: bid.site_contact_id || bid.customer_contact_id || null,
      site_contact_name: bid.site_contact_name || bid.contact_name || null,
      site_contact_phone: bid.site_contact_phone || bid.contact_phone || null,
    }).returning('*');

    const ProjectNumber = require('../models/ProjectNumber');
    let primaryNumber = (confirmedFields.project_number || '').trim();
    if (!primaryNumber) {
      const generated = await ProjectNumber.generateStructured(project, trx);
      if (generated?.error) {
        throw Object.assign(new Error(generated.error), { status: 400 });
      }
      primaryNumber = generated?.number || '';
    }
    if (primaryNumber) {
      const collision = await trx('project_numbers').where('number', primaryNumber).first();
      if (collision) {
        throw Object.assign(
          new Error(`Project number "${primaryNumber}" is already in use. Edit it before confirming.`),
          { status: 409 }
        );
      }
      await trx('project_numbers').insert({
        project_id: project.id,
        number: primaryNumber,
        label: 'Primary',
      });
    }

    try {
      const user = await trx('users').where({ id: bid.estimator_id }).first();
      const customer = bid.customer_name || 'Unknown';
      const staffName = `${user.first_name}_${user.last_name}`;
      const folderLeaf = primaryNumber || project.name;
      const folderPath = await FileService.createProjectFolders(
        project.year, staffName, customer, folderLeaf
      );
      await trx('projects').where({ id: project.id }).update({ folder_path: folderPath });
      project.folder_path = folderPath;
      if (bid.folder_path) {
        await FileService.copyBidToProject(bid.folder_path, folderPath);
      }
    } catch (err) {
      console.error('[Bids] Project folder error:', err.message);
    }

    return { bid: wonBid, project };
  });

  // Notify (non-blocking)
  try {
    await NotificationService.notifyBidWon(result.bid, result.project);
  } catch { /* notification failure not fatal */ }
  // Schedule dates aren't carried from the bid — fire a follow-up nudge so
  // the PM lands in the schedule-edit modal with one click instead of
  // hunting through the scheduler for the new card.
  if (!result.project.start_date) {
    try {
      await NotificationService.notifyScheduleDatesNeeded(result.project);
    } catch { /* notification failure not fatal */ }
  }

  return result;
}

router.post('/:id/confirm-won', authorize('bids:mark_won'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.status === 'won') return res.status(400).json({ error: 'Bid already won' });

    const { confirmed_fields } = req.body;
    if (!confirmed_fields) return res.status(400).json({ error: 'confirmed_fields required' });

    const result = await createProjectFromBid(bid, confirmed_fields);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/**
 * POST /:id/quick-project — Create the project straight from the bid
 * matrix. No OCR, no verification modal. The PM is asserting "the bid
 * data is correct, just make the project."
 *
 * confirmed_fields is assembled server-side from the bid record +
 * quote totals so the result is identical in shape to what the
 * verification modal would have produced with zero edits.
 */
router.post('/:id/quick-project', authorize('bids:mark_won'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.status === 'won') return res.status(400).json({ error: 'Bid already won' });

    // Resolve location address the same way initiate-won does, so a
    // quick project gets a proper address even on older location rows
    // whose display_address was never backfilled.
    let resolvedAddress = bid.location_address;
    if ((!resolvedAddress || !String(resolvedAddress).trim()) && bid.location_id) {
      try {
        const loc = await db('locations').where('id', bid.location_id).first();
        if (loc) {
          const cityState = [loc.town, loc.state].filter(Boolean).join(', ');
          const tail = [cityState, loc.zip].filter(Boolean).join(' ');
          resolvedAddress = [loc.street, tail].filter(Boolean).join(', ');
        }
      } catch {}
    }

    // Build confirmed_fields from the bid matrix. bid_amount uses the
    // post-markup figure; project_number left blank so the structured
    // generator auto-assigns it (PM can rename later on the project).
    const confirmed_fields = {
      bid_amount: bid.bid_amount || bid.subtotal || 0,
      customer_name: bid.customer_name,
      location_name: bid.location_name,
      location_address: resolvedAddress || bid.location_name,
      project_scope: bid.project_scope,
      local_union: bid.local_union,
      // contract_man_hours + project_number intentionally omitted so the
      // shared helper falls back to quote totals / auto-generation.
    };

    const result = await createProjectFromBid(bid, confirmed_fields);

    // Email the generated Word quote to the project's PM. The SPA's
    // Quick Project flow always runs /bids/:id/generate before this,
    // so word_doc_path is populated. If for some reason it isn't (API
    // hit directly, template missing, etc.) we surface that as a
    // non-fatal "skipped" result alongside the project. Body/subject
    // come from the `bid_project_quote` email template — admins can
    // edit it from Email Templates, and the receiving PM can author a
    // per-user override (render() picks the override row when one
    // exists for the project's pm_id, otherwise the admin row). The
    // *trigger* user (whoever clicked Quick Project) is intentionally
    // NOT used here — the override belongs to the inbox owner.
    let emailResult = { delivered: false, provider: 'none', reason: 'not attempted' };
    try {
      const refreshed = await Bid.findById(bid.id);
      const pm = result.project.pm_id
        ? await db('users').where({ id: result.project.pm_id }).first()
        : null;
      if (refreshed?.word_doc_path && pm?.email) {
        const primaryRow = await db('project_numbers')
          .where({ project_id: result.project.id, label: 'Primary' })
          .first();
        const projectLabel = primaryRow?.number || result.project.name;
        const filename = `Bid_${refreshed.bid_number}.docx`;

        const totalRaw = refreshed.bid_amount != null ? Number(refreshed.bid_amount) : null;
        const quoteTotal = Number.isFinite(totalRaw)
          ? totalRaw.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
          : '';

        const rendered = await EmailTemplateService.render(
          'bid_project_quote',
          {
            pm_first_name: pm.first_name || '',
            project_name: projectLabel,
            bid_number: refreshed.bid_number,
            quote_total: quoteTotal,
            attachment_filename: filename,
          },
          result.project.pm_id || null,
        );

        const { to, cc } = await EmailTriggerRecipientsService.resolve('bid_project_quote', [pm.email]);

        emailResult = await NotificationService.sendEmailWithAttachment({
          to,
          cc: cc.length > 0 ? cc : undefined,
          subject: rendered.subject,
          html: rendered.html,
          filePath: refreshed.word_doc_path,
          filename,
        });
      } else if (!refreshed?.word_doc_path) {
        emailResult = { delivered: false, provider: 'none', reason: 'word doc not generated (no template?)' };
      } else if (!pm?.email) {
        emailResult = { delivered: false, provider: 'none', reason: 'project PM has no email' };
      }
    } catch (err) {
      emailResult = { delivered: false, provider: 'none', reason: err.message };
      console.error('[quick-project] email step:', err.message);
    }

    res.json({ ...result, quote_email: emailResult });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/mark-lost', authorize('bids:mark_won'), async (req, res, next) => {
  try {
    const bid = await Bid.markLost(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    res.json(bid);
  } catch (err) { next(err); }
});

router.post('/:id/archive', authorize('bids:update'), async (req, res, next) => {
  try {
    const bid = await Bid.markArchived(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    res.json(bid);
  } catch (err) { next(err); }
});

router.post('/:id/snooze', authorize('bids:update'), async (req, res, next) => {
  try {
    const days = req.body.days || 21; // Default 3 weeks
    const bid = await Bid.snooze(req.params.id, days);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    res.json(bid);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// UPDATE & DELETE
// ═══════════════════════════════════════════════════════════

router.patch('/:id', authorize('bids:update'), async (req, res, next) => {
  try {
    const allowed = ['customer_id', 'customer_contact_id', 'site_contact_id', 'location_id',
      'project_scope', 'description', 'local_union', 'miles_from_hq', 'markup_pct',
      'project_length_days', 'due_date', 'submit_date', 'status', 'assigned_pm_id'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    // If assigned_pm_id is being changed, validate the user is an active PM
    if (data.assigned_pm_id !== undefined && data.assigned_pm_id !== null) {
      const pmUser = await db('users').where({ id: data.assigned_pm_id, role: 'project_manager', active: true }).first();
      if (!pmUser) {
        return res.status(400).json({ error: 'Assigned PM must be an active project manager' });
      }
    }

    // Cascade location → local_union + miles_from_hq whenever location_id
    // changes (or is set for the first time). Without this, a bid created
    // with no location, then later edited to add one, kept local_union =
    // NULL forever — which caused the bid quote page to fetch rates for
    // an empty local union and show "no rates" even when the location's
    // local was correctly populated and seeded.
    //
    // Only overrides when the caller didn't also explicitly supply those
    // fields — preserves explicit overrides (e.g., admin manually fixing
    // a bad local_union without changing location).
    if (data.location_id !== undefined && data.location_id !== null) {
      const Location = require('../models/Location');
      const loc = await Location.findById(data.location_id);
      if (loc) {
        if (data.local_union === undefined) data.local_union = loc.local_union;
        if (data.miles_from_hq === undefined) data.miles_from_hq = loc.miles_from_hq;
      }
    }

    // Auto-stamp submit_date when the status transition is the act of
    // submitting. Only fires if (a) status is being set to 'submitted',
    // (b) submit_date wasn't explicitly supplied in this PATCH, and
    // (c) the existing bid doesn't already have submit_date set. The
    // last guard prevents overwriting an existing date if a bid is
    // bounced back to draft and resubmitted later.
    if (data.status === 'submitted' && data.submit_date === undefined) {
      const existing = await db('bids').where('id', req.params.id).first('submit_date');
      if (existing && !existing.submit_date) {
        data.submit_date = new Date().toISOString().split('T')[0];
      }
    }

    const bid = await Bid.update(req.params.id, data);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    res.json(bid);
  } catch (err) { next(err); }
});

// DELETE /api/bids/:id — Cancel bid (default) or hard delete (?hard=true, admin only)
router.delete('/:id', authorize('bids:delete'), async (req, res, next) => {
  try {
    if (req.query.hard === 'true') {
      // Hard delete — admin only
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only for hard delete' });
      const bid = await Bid.findById(req.params.id);
      if (!bid) return res.status(404).json({ error: 'Bid not found' });

      await db.transaction(async (trx) => {
        await trx('bid_quote_lines').where('bid_id', req.params.id).delete();
        await trx('notifications').where('reference_type', 'bid').where('reference_id', req.params.id).delete();
        await trx('bids').where('id', req.params.id).delete();
      });

      return res.json({ deleted: true, message: `Bid "${bid.bid_number}" permanently deleted.` });
    }

    // Soft cancel (default)
    const bid = await Bid.cancel(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    res.json(bid);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// BID FILES
// ═══════════════════════════════════════════════════════════

router.get('/:id/files', authorize('bids:read'), async (req, res, next) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (!bid.folder_path) return res.json({ files: [] });

    const files = await FileService.listFilesFromPath(bid.folder_path);
    res.json({ files, folder_path: bid.folder_path });
  } catch (err) { next(err); }
});

module.exports = router;
