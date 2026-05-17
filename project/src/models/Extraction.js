/**
 * Extraction Model (v2)
 * 
 * Handles the AI extraction → user verification → database write → filing pipeline.
 * 
 * confirm() routes to type-specific handlers:
 *   invoice     → invoices + invoice_line_items + project revenue
 *   purchase_order → purchase_orders + po_line_items + project cost
 *   timesheet   → timesheets (ST/OT/DT) + rate lookup from bid_quote_lines (locked rates)
 *   contract    → contracts + update project contract_value/payment_terms
 * 
 * After confirm: file document into project subfolder + send notification.
 */

const db = require('../config/database');

const Extraction = {
  async findAll({ project_id, doc_type, status, inbox_source, limit = 50, offset = 0 } = {}) {
    const query = db('pending_extractions')
      .select('pending_extractions.*', 'projects.name as project_name')
      .leftJoin('projects', 'pending_extractions.project_id', 'projects.id')
      .orderBy('pending_extractions.created_at', 'desc')
      .limit(limit).offset(offset);

    if (project_id) query.where('pending_extractions.project_id', project_id);
    if (doc_type) query.where('pending_extractions.doc_type', doc_type);
    if (status && status !== 'all') query.where('pending_extractions.status', status);
    if (inbox_source) query.where('pending_extractions.inbox_source', inbox_source);

    const extractions = await query;
    const countQ = db('pending_extractions').count('* as count');
    if (status && status !== 'all') countQ.where('status', status);
    const [{ count }] = await countQ;
    return { extractions, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('pending_extractions')
      .select('pending_extractions.*', 'projects.name as project_name',
        'projects.local_union as project_local_union', 'projects.bid_id as project_bid_id')
      .leftJoin('projects', 'pending_extractions.project_id', 'projects.id')
      .where('pending_extractions.id', id)
      .first();
  },

  async getPendingCount(projectId = null) {
    const query = db('pending_extractions').where('status', 'pending').count('* as count');
    if (projectId) query.where('project_id', projectId);
    const [{ count }] = await query;
    return parseInt(count, 10);
  },

  async create(data) {
    const [extraction] = await db('pending_extractions').insert(data).returning('*');
    return extraction;
  },

  async update(id, data) {
    const [extraction] = await db('pending_extractions')
      .where({ id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
    return extraction;
  },

  /**
   * Confirm an extraction — write data to target tables + file document.
   * 
   * @param {string} id - Extraction ID
   * @param {object} confirmedData - User-verified field values
   * @param {string} confirmedBy - User ID who confirmed
   * @param {string} projectId - Project to assign (may differ from OCR match)
   */
  async confirm(id, confirmedData, confirmedBy, projectId = null) {
    const extraction = await this.findById(id);
    if (!extraction) throw new Error('Extraction not found');
    if (extraction.status !== 'pending') throw new Error(`Cannot confirm: status is ${extraction.status}`);

    const targetProjectId = projectId || extraction.project_id;
    if (!targetProjectId) throw new Error('Project ID required — assign a project before confirming');

    const txResult = await db.transaction(async (trx) => {
      // Update extraction record
      const [updated] = await trx('pending_extractions').where({ id }).update({
        status: 'confirmed',
        project_id: targetProjectId,
        confirmed_data: JSON.stringify(confirmedData),
        confirmed_by: confirmedBy,
        confirmed_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      }).returning('*');

      // Route to type-specific handler
      let record;
      let isVendorQuote = false; // flag to delete source file post-confirm
      switch (extraction.doc_type) {
        case 'invoice':
          record = await this._createInvoice(trx, targetProjectId, confirmedData, confirmedBy, extraction);
          break;
        case 'purchase_order':
          record = await this._createPurchaseOrder(trx, targetProjectId, confirmedData, confirmedBy, extraction);
          break;
        case 'vendor_quote':
          // Vendor quotes get converted to internal POs. The quote document
          // itself is discarded after extraction (per design — only the
          // extracted pattern is retained for vendor learning).
          record = await this._createPurchaseOrderFromQuote(trx, targetProjectId, confirmedData, confirmedBy, extraction);
          isVendorQuote = true;
          break;
        case 'timesheet':
          record = await this._createTimesheetEntries(trx, targetProjectId, confirmedData, extraction);
          break;
        case 'contract':
          record = await this._createContract(trx, targetProjectId, confirmedData, confirmedBy, extraction);
          break;
        default:
          throw new Error(`Unknown doc_type: ${extraction.doc_type}`);
      }

      return { extraction: updated, record, isVendorQuote };
    });

    // File document into project subfolder, OR delete it if it was a vendor quote.
    try {
      if (txResult.isVendorQuote) {
        // Vendor quote: extract data is now on the PO, the source file is no
        // longer needed. Delete from storage to keep things tidy.
        try {
          const StorageService = require('../services/StorageService');
          await StorageService.deleteFile(extraction.file_path);
          console.log('[Extraction] Vendor quote source file deleted post-extraction:', extraction.file_path);
        } catch (delErr) {
          console.error('[Extraction] Could not delete vendor quote source file:', delErr.message);
        }
      } else {
        const project = await db('projects').where({ id: targetProjectId }).first();
        if (project?.folder_path && extraction.file_path) {
          const subfolderMap = { invoice: 'invoices', purchase_order: 'purchase_orders', timesheet: 'timesheets', contract: 'Contract' };
          const subfolder = subfolderMap[extraction.doc_type];
          const filedKey = await FileService_fileToProject(extraction.file_path, project.folder_path, subfolder, extraction.file_name);

          // Stamp the filed PDF with the platform's canonical identifier
          // so anyone opening the file from the project folder can match
          // it back to the platform record without cross-referencing.
          // Only invoices and POs get stamped — timesheets and contracts
          // don't need it (timesheets are aggregated; contracts have their
          // own identity from the customer's signed terms).
          if (extraction.doc_type === 'invoice' || extraction.doc_type === 'purchase_order') {
            try {
              const PdfStampService = require('../services/PdfStampService');
              const StorageService = require('../services/StorageService');
              const filedAbsPath = await StorageService.getFullPath(filedKey);
              const stampInfo = {
                platformNumber: txResult.record.invoice_number || txResult.record.po_number,
                docKind: extraction.doc_type === 'invoice' ? 'INVOICE' : 'PURCHASE ORDER',
                projectName: project.name,
                externalRef: txResult.record.external_reference,
                filedDate: new Date().toISOString().split('T')[0],
              };
              const result = await PdfStampService.stampPdf(filedAbsPath, stampInfo);
              if (!result.stamped) {
                console.log(`[Extraction] Stamp skipped for ${extraction.file_name}: ${result.reason}`);
              }
            } catch (stampErr) {
              // Stamping failure must NEVER fail the extraction — the
              // record exists, the file is filed, the stamp is just a
              // visual aid. Log and move on.
              console.error('[Extraction] Stamp error (non-fatal):', stampErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Extraction] Filing error:', err.message);
    }

    // Vendor learning (non-blocking)
    try {
      const VendorLearning = require('../services/VendorLearning');
      const originalData = typeof extraction.extracted_data === 'string'
        ? JSON.parse(extraction.extracted_data) : extraction.extracted_data;
      await VendorLearning.recordConfirmation(extraction, confirmedData, originalData);
    } catch { /* vendor learning optional */ }

    // If timesheet confirmed by admin, notify PM that data is in system
    if (extraction.doc_type === 'timesheet') {
      try {
        const project = await db('projects').where({ id: targetProjectId }).first();
        if (project) {
          const NotificationService = require('../services/NotificationService');
          await NotificationService.send({
            userId: project.pm_id,
            type: 'timesheet_confirmed',
            category: 'informational',
            title: `Timesheets uploaded for ${project.name}`,
            body: 'Timesheet data has been verified and added to the system.',
            referenceType: 'project',
            referenceId: project.id,
          });
        }
      } catch { /* notification optional */ }
    }

    return txResult;
  },

  async reject(id, rejectedBy, reason = null) {
    const [extraction] = await db('pending_extractions')
      .where({ id })
      .update({ status: 'rejected', confirmed_by: rejectedBy, error_message: reason, updated_at: db.fn.now() })
      .returning('*');
    return extraction;
  },

  // ══════════════════════════════════════════════════════════
  // TYPE-SPECIFIC HANDLERS
  // ══════════════════════════════════════════════════════════

  async _createInvoice(trx, projectId, data, confirmedBy, extraction) {
    // Get payment terms from project
    const project = await trx('projects').where({ id: projectId }).first();
    let paymentDueDate = null;
    if (data.invoice_date && project?.payment_terms) {
      const days = parseInt(project.payment_terms.replace(/\D/g, '')) || 30;
      const d = new Date(data.invoice_date);
      d.setDate(d.getDate() + days);
      paymentDueDate = d.toISOString().split('T')[0];
    }

    // Generate the platform's canonical invoice number — INV-<PrimaryProjectNumber>-<Seq>
    // The number that was on the source document (QuickBooks, Excel, etc.) goes
    // to external_reference. Platform numbering is the canonical identifier
    // throughout the app; external_reference is for audit/reconciliation only.
    const primaryNum = await trx('project_numbers')
      .where('project_id', projectId).where('label', 'Primary').first();
    const projNumStr = primaryNum?.number
      || (await trx('project_numbers').where('project_id', projectId).orderBy('created_at').first())?.number
      || project?.name?.substring(0, 10) || 'UNK';
    const existingCount = await trx('invoices').where('project_id', projectId).count('* as cnt').first();
    const seq = parseInt(existingCount.cnt) + 1;
    const platformInvoiceNumber = `INV-${projNumStr}-${String(seq).padStart(3, '0')}`;

    const [invoice] = await trx('invoices').insert({
      project_id: projectId,
      invoice_number: platformInvoiceNumber,
      external_reference: data.invoice_number || null, // what was on the source doc
      customer: data.customer || null,
      amount: data.amount || null,
      invoice_date: data.invoice_date || null,
      payment_due_date: paymentDueDate,
      status: 'approved',
      file_path: extraction.file_path,
      confirmed_by: confirmedBy,
    }).returning('*');

    // Write line items to separate table
    if (Array.isArray(data.line_items) && data.line_items.length > 0) {
      const lineRows = data.line_items.map((item, i) => ({
        invoice_id: invoice.id,
        description: item.description || null,
        quantity: item.quantity || null,
        unit_price: item.unit_price || null,
        total: item.total || null,
        sort_order: i,
      }));
      await trx('invoice_line_items').insert(lineRows);
    }

    // Recompute project's percent_billed inside the transaction so the
    // dashboard "Billed %" reflects this new invoice immediately.
    // Inline (rather than calling the projects route helper) to avoid
    // circular requires.
    const proj = await trx('projects').where('id', projectId).first();
    if (proj && parseFloat(proj.contract_value || 0) > 0) {
      const sumRow = await trx('invoices')
        .where('project_id', projectId)
        .whereNot('status', 'cancelled')
        .sum('amount as total').first();
      const pct = (parseFloat(sumRow?.total || 0) / parseFloat(proj.contract_value)) * 100;
      await trx('projects').where('id', projectId).update({ percent_billed: pct.toFixed(2) });
    }

    return invoice;
  },

  async _createPurchaseOrder(trx, projectId, data, confirmedBy, extraction) {
    // Generate the platform's canonical PO number — <PrimaryProjectNumber>-PO-<Seq>
    // Whatever was on the vendor's PO document (their internal PO number,
    // confirmation reference, etc.) goes to external_reference for audit.
    const primaryNum = await trx('project_numbers')
      .where('project_id', projectId).where('label', 'Primary').first();
    const projNumStr = primaryNum?.number
      || (await trx('project_numbers').where('project_id', projectId).orderBy('created_at').first())?.number
      || 'UNK';
    const existingCount = await trx('purchase_orders').where('project_id', projectId).count('* as cnt').first();
    const seq = parseInt(existingCount.cnt) + 1;
    const platformPoNumber = `${projNumStr}-PO-${String(seq).padStart(3, '0')}`;

    const [po] = await trx('purchase_orders').insert({
      project_id: projectId,
      po_number: platformPoNumber,
      external_reference: data.po_number || null, // what was on the source doc
      vendor: data.vendor || null,
      total: data.total || null,
      order_date: data.order_date || null,
      delivery_date: data.delivery_date || null,
      status: 'received',
      file_path: extraction.file_path,
      confirmed_by: confirmedBy,
    }).returning('*');

    // Write line items to separate table
    if (Array.isArray(data.line_items) && data.line_items.length > 0) {
      const lineRows = data.line_items.map((item, i) => ({
        po_id: po.id,
        description: item.description || null,
        quantity: item.quantity || null,
        unit_price: item.unit_price || null,
        total: item.total || null,
        sort_order: i,
      }));
      await trx('po_line_items').insert(lineRows);
    }

    return po;
  },

  /**
   * Create a PO from extracted vendor quote data.
   *
   * Differs from _createPurchaseOrder in:
   *   - Status starts as 'pending' (firm hasn't sent the PO to vendor yet —
   *     the verification confirm just creates the draft; the firm reviews
   *     and sends separately)
   *   - po_number is auto-generated using the firm's project number,
   *     since vendor quotes don't carry the firm's PO format
   *   - file_path is null because the source quote will be deleted
   *     post-confirmation (per design)
   *   - delivery_lead_time, payment_terms, etc. from the quote are
   *     stored on the PO as notes for now (no dedicated columns)
   */
  async _createPurchaseOrderFromQuote(trx, projectId, data, confirmedBy, extraction) {
    // Generate firm's PO number based on the project's primary number
    const primaryNum = await trx('project_numbers')
      .where('project_id', projectId).where('label', 'Primary').first();
    const projNumStr = primaryNum?.number || 'UNK';
    const existingCount = await trx('purchase_orders').where('project_id', projectId).count('* as cnt').first();
    const seq = parseInt(existingCount.cnt) + 1;
    const poNumber = `${projNumStr}-PO-${String(seq).padStart(3, '0')}`;

    // Compose notes capturing source-quote metadata that doesn't have its own column.
    // (quote_number itself goes to external_reference, not notes.)
    const notesParts = [];
    if (data.quote_date) notesParts.push(`Quote date: ${data.quote_date}`);
    if (data.valid_until) notesParts.push(`Quote valid until: ${data.valid_until}`);
    if (data.payment_terms) notesParts.push(`Payment terms: ${data.payment_terms}`);
    if (data.delivery_lead_time) notesParts.push(`Lead time: ${data.delivery_lead_time}`);
    if (data.vendor_phone) notesParts.push(`Vendor phone: ${data.vendor_phone}`);
    if (data.vendor_email) notesParts.push(`Vendor email: ${data.vendor_email}`);
    if (data.notes) notesParts.push(data.notes);

    const [po] = await trx('purchase_orders').insert({
      project_id: projectId,
      po_number: poNumber,
      external_reference: data.quote_number || null, // source vendor quote number
      vendor: data.vendor || null,
      total: data.total || data.subtotal || null,
      order_date: new Date().toISOString().split('T')[0], // today — when firm cut the PO
      // delivery_date left null — set when vendor confirms shipping
      status: 'pending',
      file_path: null, // source quote will be deleted; no PO file generated yet
      confirmed_by: confirmedBy,
      notes: notesParts.join(' • ') || null,
    }).returning('*');

    // Write line items
    if (Array.isArray(data.line_items) && data.line_items.length > 0) {
      const lineRows = data.line_items.map((item, i) => ({
        po_id: po.id,
        description: item.description || null,
        quantity: item.quantity || null,
        unit_price: item.unit_price || null,
        total: item.total || null,
        sort_order: i,
      }));
      await trx('po_line_items').insert(lineRows);
    }

    return po;
  },

  async _createTimesheetEntries(trx, projectId, data, extraction) {
    // Get project info for local union + locked rates
    const project = await trx('projects').where({ id: projectId }).first();
    const localUnion = project?.local_union;

    // Get locked rates from bid_quote_lines (not current rate_sheet)
    const rateMap = {};
    if (project?.bid_id) {
      const quoteLines = await trx('bid_quote_lines').where('bid_id', project.bid_id);
      for (const ql of quoteLines) {
        rateMap[ql.classification] = {
          st_rate: parseFloat(ql.st_rate),
          ot_rate: parseFloat(ql.ot_rate),
          dt_rate: parseFloat(ql.dt_rate),
        };
      }
    }

    // Get global $/mile for mileage cost
    const GlobalVariable = require('./GlobalVariable');
    const dollarPerMile = await GlobalVariable.getDollarPerMile();

    const entries = data.entries || [data]; // Support both array and single entry
    const created = [];

    for (const entry of entries) {
      const classification = entry.classification || null;
      const rates = rateMap[classification] || { st_rate: 0, ot_rate: 0, dt_rate: 0 };

      const stHrs = parseFloat(entry.st_hours) || 0;
      const otHrs = parseFloat(entry.ot_hours) || 0;
      const dtHrs = parseFloat(entry.dt_hours) || 0;
      const miles = parseFloat(entry.miles_driven) || 0;

      const potentialRevenue = (stHrs * rates.st_rate) + (otHrs * rates.ot_rate) + (dtHrs * rates.dt_rate);
      const mileageCost = miles * dollarPerMile;

      const [timesheet] = await trx('timesheets').insert({
        project_id: projectId,
        worker_name: entry.worker_name || null,
        classification,
        local_union: localUnion,
        work_date: entry.work_date || new Date().toISOString().split('T')[0],
        st_hours: stHrs,
        ot_hours: otHrs,
        dt_hours: dtHrs,
        miles_driven: miles,
        billing_rate_st: rates.st_rate,
        billing_rate_ot: rates.ot_rate,
        billing_rate_dt: rates.dt_rate,
        potential_revenue: potentialRevenue,
        mileage_cost: mileageCost,
        source: 'inbox',
        file_path: extraction.file_path,
      }).returning('*');

      created.push(timesheet);
    }

    return created;
  },

  async _createContract(trx, projectId, data, confirmedBy, extraction) {
    const [contract] = await trx('contracts').insert({
      project_id: projectId,
      contract_number: data.contract_number || null,
      parties: data.parties || null,
      value: data.value || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      retention_pct: data.retention_pct || null,
      payment_terms: data.payment_terms || null,
      file_path: extraction.file_path,
      confirmed_by: confirmedBy,
      key_terms: data.key_terms ? JSON.stringify(data.key_terms) : null,
    }).returning('*');

    // Update project with contract data
    const updates = {};
    if (data.value) updates.contract_value = data.value;
    if (data.payment_terms) updates.payment_terms = data.payment_terms;
    if (Object.keys(updates).length > 0) {
      await trx('projects').where({ id: projectId }).update({ ...updates, updated_at: trx.fn.now() });
    }

    return contract;
  },
};

// Helper: file document into project subfolder
async function FileService_fileToProject(sourceKey, projectFolderPath, subfolder, fileName) {
  const FileService = require('../services/FileService');
  return FileService.fileToProjectFolder(sourceKey, projectFolderPath, subfolder, fileName);
}

module.exports = Extraction;
