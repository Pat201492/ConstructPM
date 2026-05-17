/**
 * File Routes
 * 
 * Handles direct file uploads (NOT centralized inboxes — those are in inbox.js).
 * 
 *   POST /bid/:bidId              — Upload files to a bid folder
 *   POST /project/:id/Contract — Upload contract to project (triggers extraction + Contract vs T&M notification)
 *   GET  /download                — Download file (S3 redirect or local stream)
 *   GET  /storage-info            — Storage backend info (admin)
 *   GET  /activity/:type/:id      — File activity log for a bid or project
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const StorageService = require('../services/StorageService');
const FileService = require('../services/FileService');
const Extraction = require('../models/Extraction');
const ExtractionService = require('../services/ExtractionService');
const NotificationService = require('../services/NotificationService');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);

const upload = multer({
  dest: '/tmp/file_uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ═══════════════════════════════════════════════════════════
// BID FILE UPLOAD
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/files/bid/:bidId — Upload files to a bid folder
 */
router.post('/bid/:bidId', authorize('files:upload'), upload.array('files', 20), async (req, res, next) => {
  try {
    const bid = await db('bids').where({ id: req.params.bidId }).first();
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (!bid.folder_path) return res.status(400).json({ error: 'Bid has no folder' });

    const results = [];
    const bidKey = await StorageService.getKeyFromPath(bid.folder_path);

    for (const file of (req.files || [])) {
      const destKey = `${bidKey}/${file.originalname}`;
      const stored = await FileService.storeUploadedFile(file.path, destKey);
      try { await require('fs').promises.unlink(file.path); } catch {}

      // Log activity
      await db('file_activity_log').insert({
        folder_path: bid.folder_path,
        file_name: file.originalname,
        action: 'upload',
        user_id: req.user.id,
        reference_type: 'bid',
        reference_id: bid.id,
        metadata: JSON.stringify({ size: file.size, mimetype: file.mimetype }),
      });

      results.push({ file: file.originalname, key: stored.key });
    }

    res.json({ uploaded: results.length, files: results });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CONTRACT_PO UPLOAD (per-project, triggers extraction)
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/files/project/:projectId/Contract — Upload contract to project
 * Triggers AI extraction → notification to PM for verification.
 * This is NOT centralized — Contract stays per-project (decision #27).
 */
router.post('/project/:projectId/Contract', authorize('files:upload'), upload.array('files', 10), async (req, res, next) => {
  try {
    const project = await db('projects').where({ id: req.params.projectId }).first();
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const results = [];

    for (const file of (req.files || [])) {
      // Store in the project's Contract subfolder
      const projectKey = project.folder_path
        ? await StorageService.getKeyFromPath(project.folder_path)
        : `projects/${project.year}/${project.id}`;
      const destKey = `${projectKey}/Contract/${file.originalname}`;
      const stored = await FileService.storeUploadedFile(file.path, destKey);
      try { await require('fs').promises.unlink(file.path); } catch {}

      // Log activity
      await db('file_activity_log').insert({
        folder_path: project.folder_path || '',
        file_name: file.originalname,
        action: 'upload',
        user_id: req.user.id,
        reference_type: 'project',
        reference_id: project.id,
        metadata: JSON.stringify({ size: file.size, mimetype: file.mimetype, subfolder: 'Contract' }),
      });

      // Create extraction record and process through AI
      const extraction = await Extraction.create({
        project_id: project.id,
        file_path: stored.key,
        file_name: file.originalname,
        doc_type: 'contract',
        inbox_source: 'contract_po',
        status: 'processing',
      });

      try {
        const result = await ExtractionService.processDocument(stored.key, 'contract');

        await Extraction.update(extraction.id, {
          extracted_data: JSON.stringify(result.extracted_data),
          confidence_scores: JSON.stringify(result.confidence_scores),
          status: 'pending',
          model_used: result.model_used,
          processing_time_ms: result.processing_time_ms,
          overall_confidence: result.overall_confidence,
          vendor_name: result.vendor_name,
        });

        // Notify PM for verification
        await NotificationService.send({
          userId: project.pm_id,
          type: 'extraction_ready',
          category: 'actionable',
          title: `Contract uploaded for ${project.name}`,
          body: 'Contract document ready for verification. Please review the extracted fields.',
          priority: 'high',
          actionType: 'verify_extraction',
          referenceType: 'extraction',
          referenceId: extraction.id,
        });

        results.push({ file: file.originalname, extraction_id: extraction.id, status: 'processing' });
      } catch (err) {
        await Extraction.update(extraction.id, { status: 'failed', error_message: err.message });
        results.push({ file: file.originalname, extraction_id: extraction.id, status: 'error', error: err.message });
      }
    }

    res.json({ uploaded: results.length, files: results });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════════════════

router.get('/download', authorize('files:download'), async (req, res, next) => {
  try {
    const fileRef = req.query.path;
    if (!fileRef) return res.status(400).json({ error: 'Missing path parameter' });

    if (StorageService.getType() === 's3') {
      const key = await FileService.getKeyFromPath(fileRef);
      const url = await FileService.getDownloadUrl(key);
      return res.redirect(url);
    }

    // Resolve path using storage backend's base
    const LocalBackend = require('../services/storage/LocalBackend');
    const storageRoot = path.resolve(await LocalBackend.getBase());
    const fullPath = path.resolve(fileRef.startsWith('/') ? fileRef : path.join(storageRoot, fileRef));
    if (!fullPath.startsWith(storageRoot)) return res.status(403).json({ error: 'Access denied' });

    try { await fs.access(fullPath); } catch { return res.status(404).json({ error: 'File not found' }); }

    const mime = require('mime-types');
    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath)}"`);
    require('fs').createReadStream(fullPath).pipe(res);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// FILE ACTIVITY LOG
// ═══════════════════════════════════════════════════════════

router.get('/activity/:referenceType/:referenceId', async (req, res, next) => {
  try {
    const logs = await db('file_activity_log')
      .where({
        reference_type: req.params.referenceType,
        reference_id: req.params.referenceId,
      })
      .select('file_activity_log.*',
        db.raw("users.first_name || ' ' || users.last_name as user_name"))
      .leftJoin('users', 'file_activity_log.user_id', 'users.id')
      .orderBy('file_activity_log.created_at', 'desc');

    res.json({ logs });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// STORAGE INFO
// ═══════════════════════════════════════════════════════════

router.get('/storage-info', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    res.json({
      type: StorageService.getType(),
      bucket: process.env.S3_BUCKET || null,
      region: process.env.S3_REGION || null,
      basePath: StorageService.getType() === 'local' ? (process.env.STORAGE_BASE_PATH || './storage') : null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
