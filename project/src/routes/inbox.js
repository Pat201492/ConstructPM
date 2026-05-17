/**
 * Inbox Routes
 * 
 * Three centralized inbox upload endpoints:
 *   POST /api/inbox/timesheets       — Admin confirms, PM gets notified after
 *   POST /api/inbox/invoices         — PM confirms
 *   POST /api/inbox/purchase-orders  — PM confirms
 * 
 * Flow:
 *   1. User uploads file(s) to inbox endpoint
 *   2. AI OCR → extract fields + project number
 *   3. System matches project number to existing project
 *   4. Notification sent to correct user (admin for timesheets, PM for invoices/POs)
 *   5. User verifies with checkboxes (can edit any field including project)
 *   6. Data written to database tables
 *   7. Document filed into correct project subfolder
 * 
 * Access controlled via inbox_access table (admin-configurable).
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const authenticate = require('../middleware/authenticate');
const db = require('../config/database');
const ExtractionService = require('../services/ExtractionService');
const DocumentQueue = require('../services/DocumentQueue');
const NotificationService = require('../services/NotificationService');
const Extraction = require('../models/Extraction');
const FileService = require('../services/FileService');

const router = express.Router();
router.use(authenticate);

// Multer config for file uploads
const upload = multer({
  dest: '/tmp/inbox_uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/**
 * Check if user has access to a specific inbox.
 * Admin always has access. Others checked via inbox_access table.
 */
async function checkInboxAccess(userId, userRole, inboxType) {
  if (userRole === 'admin') return true;

  // Check by user ID
  const byUser = await db('inbox_access')
    .where({ inbox_type: inboxType, user_id: userId })
    .first();
  if (byUser) return true;

  // Check by role
  const byRole = await db('inbox_access')
    .where({ inbox_type: inboxType, role: userRole })
    .first();
  return !!byRole;
}

/**
 * Process an uploaded file through the extraction pipeline.
 * Returns the pending extraction record.
 */
async function processInboxUpload(file, docType, inboxType, uploadedBy, explicitProjectId = null) {
  // Store the file
  const storageKey = `inbox/${inboxType}/${Date.now()}_${file.originalname}`;
  const stored = await FileService.storeUploadedFile(file.path, storageKey);

  // Clean up temp file
  try { await require('fs').promises.unlink(file.path); } catch {}

  // Create extraction record (project_id null until matched)
  const extraction = await Extraction.create({
    file_path: stored.key,
    file_name: file.originalname,
    doc_type: docType,
    inbox_source: inboxType,
    status: 'processing',
    project_id: explicitProjectId,  // user-selected, overrides AI guess
  });

  // Process through AI pipeline
  try {
    const result = await ExtractionService.processDocument(stored.key, docType);

    // For invoices and POs, the uploader has already chosen the project at
    // upload time (enforced by the route handlers). Use that explicit choice.
    // For timesheets and other doc types, fall back to AI-extracted matching.
    let projectId = explicitProjectId;
    const projectNumber = result.extracted_data?.project_number;
    if (!projectId && projectNumber) {
      projectId = await ExtractionService.matchProjectNumber(projectNumber, db);
    }

    // Update extraction with results
    await Extraction.update(extraction.id, {
      project_id: projectId,
      extracted_data: JSON.stringify(result.extracted_data),
      confidence_scores: JSON.stringify(result.confidence_scores),
      status: 'pending',
      model_used: result.model_used,
      processing_time_ms: result.processing_time_ms,
      overall_confidence: result.overall_confidence,
      validation_errors: result.validation ? JSON.stringify(result.validation) : null,
      vendor_name: result.vendor_name,
    });

    return {
      extraction_id: extraction.id,
      project_id: projectId,
      project_number: projectNumber,
      extracted_data: result.extracted_data,
      confidence_scores: result.confidence_scores,
      overall_confidence: result.overall_confidence,
    };
  } catch (err) {
    await Extraction.update(extraction.id, {
      status: 'failed',
      error_message: err.message,
    });
    throw err;
  }
}

/**
 * Send notification to the correct user for verification.
 * 
 * Routing per user spec:
 *   #1 Timesheets     → PM + PM admin (delegate)
 *   #2 Invoices       → PM admin (delegate)
 *   #3 Purchase Orders → PM
 *   #4 Unmatched docs → PM admin (delegate, fallback to all admins)
 */
async function notifyForVerification(extraction, inboxType, projectId) {
  // Helper: get PM + delegate for a project
  async function getProjectRecipients(pid) {
    const project = await db('projects').where({ id: pid }).first();
    if (!project) return { pm: null, delegate: null, project: null };
    const delegate = await db('pm_notification_delegates')
      .where({ pm_user_id: project.pm_id }).first();
    return {
      pm: project.pm_id,
      delegate: delegate ? delegate.delegate_user_id : null,
      project,
    };
  }

  if (inboxType === 'timesheets') {
    // #1: PM + PM admin (delegate)
    if (projectId) {
      const { pm, delegate, project } = await getProjectRecipients(projectId);
      const recipients = [pm, delegate].filter(Boolean);
      for (const userId of recipients) {
        await NotificationService.send({
          userId,
          type: 'extraction_ready',
          category: 'actionable',
          title: 'Timesheet ready for verification',
          body: `Timesheet uploaded for project "${project?.name || 'Unknown'}"`,
          priority: 'normal',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.extraction_id,
        });
      }
    } else {
      // No project matched — send to all admins
      const admins = await db('users').where({ role: 'admin', active: true }).pluck('id');
      for (const adminId of admins) {
        await NotificationService.send({
          userId: adminId,
          type: 'extraction_ready',
          category: 'actionable',
          title: 'Timesheet — project not matched',
          body: 'Timesheet uploaded but project number could not be determined. Manual assignment needed.',
          priority: 'high',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.extraction_id,
        });
      }
    }
  } else if (inboxType === 'invoices') {
    // #2: PM admin (delegate only, fallback to admins if no delegate)
    if (projectId) {
      const { delegate } = await getProjectRecipients(projectId);
      if (delegate) {
        await NotificationService.send({
          userId: delegate,
          type: 'extraction_ready',
          category: 'actionable',
          title: 'Invoice ready for verification',
          body: `Invoice uploaded — awaiting your review`,
          priority: 'normal',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.extraction_id,
        });
      } else {
        // No delegate configured — fallback to admins
        const admins = await db('users').where({ role: 'admin', active: true }).pluck('id');
        for (const adminId of admins) {
          await NotificationService.send({
            userId: adminId,
            type: 'extraction_ready',
            category: 'actionable',
            title: 'Invoice ready for verification (no PM admin assigned)',
            body: 'Invoice uploaded but no PM delegate is configured. Please verify.',
            priority: 'normal',
            actionType: 'verify_extraction',
            referenceType: 'extraction',
            referenceId: extraction.extraction_id,
          });
        }
      }
    } else {
      // #4: Unmatched → PM admin / admins
      const admins = await db('users').where({ role: 'admin', active: true }).pluck('id');
      for (const adminId of admins) {
        await NotificationService.send({
          userId: adminId,
          type: 'extraction_ready',
          category: 'actionable',
          title: 'Invoice — project not matched',
          body: 'Invoice uploaded but project number could not be determined. Manual assignment needed.',
          priority: 'high',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.extraction_id,
        });
      }
    }
  } else {
    // #3: Purchase Orders → PM only
    if (projectId) {
      const { pm, project } = await getProjectRecipients(projectId);
      if (pm) {
        await NotificationService.send({
          userId: pm,
          type: 'extraction_ready',
          category: 'actionable',
          title: 'Purchase order ready for verification',
          body: `PO uploaded for project "${project?.name || 'Unknown'}"`,
          priority: 'normal',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.extraction_id,
        });
      }
    } else {
      // #4: Unmatched → PM admin / admins
      const admins = await db('users').where({ role: 'admin', active: true }).pluck('id');
      for (const adminId of admins) {
        await NotificationService.send({
          userId: adminId,
          type: 'extraction_ready',
          category: 'actionable',
          title: 'Purchase order — project not matched',
          body: 'PO uploaded but project number could not be determined. Manual assignment needed.',
          priority: 'high',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.extraction_id,
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// TIMESHEET INBOX
// ═══════════════════════════════════════════════════════════

router.post('/timesheets', upload.array('files', 20), async (req, res, next) => {
  try {
    const hasAccess = await checkInboxAccess(req.user.id, req.user.role, 'timesheets');
    if (!hasAccess) return res.status(403).json({ error: 'No access to timesheets inbox' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const extraction = await processInboxUpload(file, 'timesheet', 'timesheets', req.user.id);
        await notifyForVerification(extraction, 'timesheets', extraction.project_id);
        results.push({ file: file.originalname, status: 'processed', ...extraction });
      } catch (err) {
        results.push({ file: file.originalname, status: 'error', error: err.message });
      }
    }

    res.json({
      inbox: 'timesheets',
      uploaded: req.files.length,
      results,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// INVOICE INBOX
// ═══════════════════════════════════════════════════════════

router.post('/invoices', upload.array('files', 20), async (req, res, next) => {
  try {
    const hasAccess = await checkInboxAccess(req.user.id, req.user.role, 'invoices');
    if (!hasAccess) return res.status(403).json({ error: 'No access to invoices inbox' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Order of operations for ALL OCR uploads:
    //   1. AI reviews the submission
    //   2. User confirms on the verification screen
    // Project picker is OPTIONAL — if the user supplies project_id at
    // upload time, that overrides the AI's auto-match. Otherwise AI
    // tries to find the project number in the document. Either way the
    // user gets the verification screen before anything is committed.
    const explicitProjectId = req.body.project_id || null;
    if (explicitProjectId) {
      const projectExists = await db('projects').where({ id: explicitProjectId }).first();
      if (!projectExists) {
        return res.status(400).json({ error: 'Selected project does not exist.' });
      }
    }

    const results = [];
    for (const file of req.files) {
      try {
        const extraction = await processInboxUpload(file, 'invoice', 'invoices', req.user.id, explicitProjectId);
        await notifyForVerification(extraction, 'invoices', extraction.project_id);
        results.push({ file: file.originalname, status: 'processed', ...extraction });
      } catch (err) {
        results.push({ file: file.originalname, status: 'error', error: err.message });
      }
    }

    res.json({
      inbox: 'invoices',
      uploaded: req.files.length,
      results,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// PURCHASE ORDER INBOX
// ═══════════════════════════════════════════════════════════

router.post('/purchase-orders', upload.array('files', 20), async (req, res, next) => {
  try {
    const hasAccess = await checkInboxAccess(req.user.id, req.user.role, 'purchase_orders');
    if (!hasAccess) return res.status(403).json({ error: 'No access to purchase orders inbox' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Order of operations for ALL OCR uploads:
    //   1. AI reviews the submission (project number + vendor + amounts)
    //   2. User confirms on the verification screen
    // Project picker is OPTIONAL here — if the user supplies project_id
    // at upload time, it overrides AI auto-match. Otherwise AI tries to
    // find the project number in the document. Either way the user gets
    // the verification screen before anything is committed.
    const explicitProjectId = req.body.project_id || null;
    if (explicitProjectId) {
      const projectExists = await db('projects').where({ id: explicitProjectId }).first();
      if (!projectExists) {
        return res.status(400).json({ error: 'Selected project does not exist.' });
      }
    }

    const results = [];
    for (const file of req.files) {
      try {
        const extraction = await processInboxUpload(file, 'purchase_order', 'purchase_orders', req.user.id, explicitProjectId);
        await notifyForVerification(extraction, 'purchase_orders', extraction.project_id);
        results.push({ file: file.originalname, status: 'processed', ...extraction });
      } catch (err) {
        results.push({ file: file.originalname, status: 'error', error: err.message });
      }
    }

    res.json({
      inbox: 'purchase_orders',
      uploaded: req.files.length,
      results,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// VENDOR QUOTE INBOX
// ═══════════════════════════════════════════════════════════
//
// Vendor quotes are inbound documents from vendors (Greybar, Phillips,
// etc.) that the firm uses to draft an internal PO. The quote itself
// has no project information — the firm employee assigns it to a
// project at upload time, AI extracts vendor + line items + total,
// then the user reviews and confirms a PO draft on the verification
// screen.
//
// Difference from invoice/PO uploads:
//   - project_id IS required at upload (the quote can't tell us)
//   - The quote file is NOT persisted — once the PO is created,
//     the source quote is deleted from storage. Only the extracted
//     pattern feeds back to vendor_profiles for learning.
//   - On verification confirm, a PO record is created (not a quote
//     record — there's no quote table).

router.post('/vendor-quotes', upload.array('files', 20), async (req, res, next) => {
  try {
    const hasAccess = await checkInboxAccess(req.user.id, req.user.role, 'purchase_orders');
    if (!hasAccess) return res.status(403).json({ error: 'No access to vendor quotes / purchase orders inbox' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Vendor quotes have no project info in them — the firm employee
    // must pick the project at upload time.
    const projectId = req.body.project_id;
    if (!projectId) {
      return res.status(400).json({ error: 'project_id is required — vendor quotes do not contain project information, so you must pick which project this quote is for.' });
    }
    const projectExists = await db('projects').where({ id: projectId }).first();
    if (!projectExists) {
      return res.status(400).json({ error: 'Selected project does not exist.' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const extraction = await processInboxUpload(file, 'vendor_quote', 'purchase_orders', req.user.id, projectId);
        await notifyForVerification(extraction, 'purchase_orders', extraction.project_id);
        results.push({ file: file.originalname, status: 'processed', ...extraction });
      } catch (err) {
        results.push({ file: file.originalname, status: 'error', error: err.message });
      }
    }

    res.json({
      inbox: 'vendor_quotes',
      uploaded: req.files.length,
      results,
    });
  } catch (err) { next(err); }
});

module.exports = router;
