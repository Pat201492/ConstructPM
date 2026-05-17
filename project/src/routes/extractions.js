const express = require('express');
const { param, body, validationResult } = require('express-validator');
const Extraction = require('../models/Extraction');
const DocumentQueue = require('../services/DocumentQueue');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const router = express.Router();
router.use(authenticate);

// ── LIST EXTRACTIONS ──────────────────────────────────────────

/**
 * GET /api/extractions
 * List pending extractions (filterable by project, doc_type, status)
 * 
 * Default: returns only "pending" status (items awaiting human review)
 */
router.get(
  '/',
  authorize('extractions:read'),
  async (req, res, next) => {
    try {
      const filters = {
        project_id: req.query.project_id,
        doc_type: req.query.doc_type,
        status: req.query.status || 'pending', // default to pending
        limit: parseInt(req.query.limit, 10) || 50,
        offset: parseInt(req.query.offset, 10) || 0,
      };

      // "all" status returns everything
      if (req.query.status === 'all') delete filters.status;

      const result = await Extraction.findAll(filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/extractions/pending-count
 * Quick count of pending extractions (for notification badges)
 */
router.get(
  '/pending-count',
  authorize('extractions:read'),
  async (req, res, next) => {
    try {
      const count = await Extraction.getPendingCount(req.query.project_id);
      res.json({ pending_count: count });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/extractions/queue-stats
 * Job queue health (Admin only)
 */
router.get(
  '/queue-stats',
  authorize('extractions:read'),
  async (req, res, next) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
      }
      const stats = await DocumentQueue.getStats();
      res.json({ queue: stats });
    } catch (err) {
      // Queue might not be available
      res.json({ queue: { error: 'Queue unavailable', message: err.message } });
    }
  }
);

// ── VIEW SINGLE EXTRACTION ────────────────────────────────────

/**
 * GET /api/extractions/:id
 * View an extraction with AI-extracted data, confidence scores, and file info.
 * This is the "review screen" data — shows the AI's guesses alongside the file.
 */
router.get(
  '/:id',
  authorize('extractions:read'),
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const extraction = await Extraction.findById(req.params.id);
      if (!extraction) {
        return res.status(404).json({ error: 'Extraction not found' });
      }

      // Parse JSON fields if stored as strings
      let extractedData = extraction.extracted_data;
      let confidenceScores = extraction.confidence_scores;
      let confirmedData = extraction.confirmed_data;

      if (typeof extractedData === 'string') extractedData = JSON.parse(extractedData);
      if (typeof confidenceScores === 'string') confidenceScores = JSON.parse(confidenceScores);
      if (typeof confirmedData === 'string') confirmedData = JSON.parse(confirmedData);

      res.json({
        extraction: {
          ...extraction,
          extracted_data: extractedData,
          confidence_scores: confidenceScores,
          confirmed_data: confirmedData,
        },
        // File download URL for the review screen
        file_url: `/api/files/download?path=${encodeURIComponent(extraction.file_path)}`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── CONFIRM EXTRACTION ────────────────────────────────────────

/**
 * POST /api/extractions/:id/confirm
 * Confirm (accept or correct) an AI extraction.
 * 
 * The request body contains the final verified data. This may be:
 *   - The AI's guess as-is (user accepted without changes)
 *   - Modified fields (user corrected some values)
 * 
 * On confirmation:
 *   1. pending_extractions status → confirmed
 *   2. Data written to the target table (invoices, timesheets, POs, or contracts)
 */
router.post(
  '/:id/confirm',
  authorize('extractions:confirm'),
  [
    param('id').isUUID(),
    body('data').isObject().withMessage('Confirmed data object required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation error', details: errors.array() });
      }

      const extraction = await Extraction.findById(req.params.id);
      if (!extraction) {
        return res.status(404).json({ error: 'Extraction not found' });
      }

      if (extraction.status !== 'pending') {
        return res.status(400).json({
          error: 'Cannot confirm',
          message: `Extraction status is "${extraction.status}". Only pending extractions can be confirmed.`,
        });
      }

      const result = await Extraction.confirm(
        req.params.id,
        req.body.data,
        req.user.id,
        req.body.project_id || null // Allow user to override/set project assignment
      );

      res.json({
        extraction: result.extraction,
        record: result.record,
        message: `${extraction.doc_type} confirmed and saved to database.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── REJECT EXTRACTION ─────────────────────────────────────────

/**
 * POST /api/extractions/:id/reject
 * Reject an extraction. The file remains on disk but no database record is created.
 */
router.post(
  '/:id/reject',
  authorize('extractions:confirm'),
  [
    param('id').isUUID(),
    body('reason').optional().isString().trim(),
  ],
  async (req, res, next) => {
    try {
      const extraction = await Extraction.findById(req.params.id);
      if (!extraction) {
        return res.status(404).json({ error: 'Extraction not found' });
      }

      if (!['pending', 'failed'].includes(extraction.status)) {
        return res.status(400).json({
          error: 'Cannot reject',
          message: `Extraction status is "${extraction.status}".`,
        });
      }

      const rejected = await Extraction.reject(
        req.params.id,
        req.user.id,
        req.body.reason
      );

      res.json({
        extraction: rejected,
        message: 'Extraction rejected. File remains on disk for manual processing.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── RETRY FAILED EXTRACTION ──────────────────────────────────

/**
 * POST /api/extractions/:id/retry
 * Re-queue a failed extraction for another attempt
 */
router.post(
  '/:id/retry',
  authorize('extractions:confirm'),
  [param('id').isUUID()],
  async (req, res, next) => {
    try {
      const extraction = await Extraction.findById(req.params.id);
      if (!extraction) {
        return res.status(404).json({ error: 'Extraction not found' });
      }

      if (!['failed', 'rejected'].includes(extraction.status)) {
        return res.status(400).json({
          error: 'Cannot retry',
          message: `Only failed or rejected extractions can be retried. Current status: "${extraction.status}".`,
        });
      }

      // Reset status
      await Extraction.update(extraction.id, {
        status: 'processing',
        error_message: null,
        confirmed_by: null,
        confirmed_data: null,
        confirmed_at: null,
      });

      // Re-queue
      try {
        await DocumentQueue.addExtractionJob({
          extractionId: extraction.id,
          filePath: extraction.file_path,
          docType: extraction.doc_type,
          projectId: extraction.project_id,
        });
      } catch {
        await DocumentQueue.processSync({
          extractionId: extraction.id,
          filePath: extraction.file_path,
          docType: extraction.doc_type,
          projectId: extraction.project_id,
        });
      }

      res.json({ message: 'Extraction re-queued for processing.', extraction_id: extraction.id });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
