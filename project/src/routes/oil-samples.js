const express = require('express');
const multer = require('multer');
const path = require('path');
const fsPromises = require('fs').promises;
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const OilSampleRequest = require('../models/OilSampleRequest');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);

const upload = multer({ dest: '/tmp/oil_sample_uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/oil-samples/upload — foreman uploads photo → vision extraction
router.post('/upload', authorize('oil_samples:create'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    // Store photo in inbox
    const timestamp = Date.now();
    const ext = path.extname(req.file.originalname) || '.jpg';
    const inboxKey = `inbox/oil-samples/${timestamp}_${req.file.originalname}`;
    const FileService = require('../services/FileService');
    await FileService.storeUploadedFile(req.file.path, inboxKey);

    // Clean up temp
    try { await fsPromises.unlink(req.file.path); } catch {}

    // Get full path for vision processing
    const fullPath = await FileService.getFullPath(inboxKey);

    // Run vision extraction
    const ExtractionService = require('../services/ExtractionService');
    const visionResult = await ExtractionService.processVisionDocument(fullPath, 'oil_sample');

    // Create oil sample record
    const extracted = visionResult.extracted_data || {};
    const sample = await OilSampleRequest.create({
      project_id,
      foreman_id: req.user.id,
      original_photo_path: inboxKey,
      extracted_fields: JSON.stringify(extracted),
      equipment_id_field: extracted.equipment_id || null,
      equipment_location: extracted.equipment_location || null,
      sample_date: extracted.sample_date || new Date().toISOString().split('T')[0],
      sample_type: extracted.sample_type || null,
      condition_notes: extracted.condition_notes || null,
      status: 'pending_data_confirm',
      vision_backend_used: visionResult.method,
    });

    res.status(201).json({
      sample,
      extraction: {
        fields: extracted,
        confidence: visionResult.confidence_scores,
        method: visionResult.method,
        model: visionResult.model,
        processing_time_ms: visionResult.processing_time_ms,
        overall_confidence: visionResult.overall_confidence,
        template_name: visionResult.template_name || null,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/oil-samples — list (filter by project, status, foreman, equipment, location)
router.get('/', authorize('oil_samples:read'), async (req, res, next) => {
  try {
    const { project_id, status, foreman_id, equipment_id, location, limit, offset } = req.query;

    const effectiveForeman = req.user.role === 'foreman' ? req.user.id : foreman_id;

    // PM sees only their projects
    let pm_filter = null;
    if (req.user.role === 'project_manager') {
      pm_filter = req.user.id;
    }

    let query = OilSampleRequest.findAll({
      project_id, foreman_id: effectiveForeman, status, equipment_id, location,
      limit: parseInt(limit) || 100, offset: parseInt(offset) || 0,
    });

    if (pm_filter) {
      // Re-query with PM filter
      const samples = await db('oil_sample_requests')
        .select('oil_sample_requests.*', 'projects.name as project_name',
          db.raw("users.first_name || ' ' || users.last_name as foreman_name"))
        .leftJoin('projects', 'oil_sample_requests.project_id', 'projects.id')
        .leftJoin('users', 'oil_sample_requests.foreman_id', 'users.id')
        .where('projects.pm_id', pm_filter)
        .modify(q => {
          if (status) q.where('oil_sample_requests.status', status);
          if (equipment_id) q.whereILike('oil_sample_requests.equipment_id_field', `%${equipment_id}%`);
          if (location) q.whereILike('oil_sample_requests.equipment_location', `%${location}%`);
        })
        .orderBy('oil_sample_requests.submitted_at', 'desc')
        .limit(parseInt(limit) || 100);
      return res.json({ samples });
    }

    const samples = await query;
    res.json({ samples });
  } catch (err) { next(err); }
});

// GET /api/oil-samples/pending-count — for nav badge
router.get('/pending-count', authorize('oil_samples:read'), async (req, res, next) => {
  try {
    const pm_id = req.user.role === 'project_manager' ? req.user.id : null;
    const count = await OilSampleRequest.pendingCount({ pm_id });
    res.json({ count });
  } catch (err) { next(err); }
});

// GET /api/oil-samples/:id — detail
router.get('/:id', authorize('oil_samples:read'), async (req, res, next) => {
  try {
    const sample = await OilSampleRequest.findById(req.params.id);
    if (!sample) return res.status(404).json({ error: 'Not found' });
    res.json(sample);
  } catch (err) { next(err); }
});

// POST /api/oil-samples — create (foreman submits, or admin/PM creates manually)
router.post('/', authorize('oil_samples:create'), async (req, res, next) => {
  try {
    const { project_id, equipment_id_field, equipment_location, sample_date, sample_type, condition_notes, extracted_fields } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const sample = await OilSampleRequest.create({
      project_id,
      foreman_id: req.user.id,
      equipment_id_field: equipment_id_field || null,
      equipment_location: equipment_location || null,
      sample_date: sample_date || new Date().toISOString().split('T')[0],
      sample_type: sample_type || null,
      condition_notes: condition_notes || null,
      extracted_fields: extracted_fields ? JSON.stringify(extracted_fields) : null,
      status: 'pending_data_confirm',
    });
    res.status(201).json(sample);
  } catch (err) { next(err); }
});

// POST /api/oil-samples/:id/confirm-data — foreman confirms extracted fields
router.post('/:id/confirm-data', authorize('oil_samples:update'), async (req, res, next) => {
  try {
    const sample = await OilSampleRequest.findById(req.params.id);
    if (!sample) return res.status(404).json({ error: 'Not found' });
    if (sample.status !== 'pending_data_confirm') {
      return res.status(400).json({ error: 'Sample is not pending data confirmation' });
    }

    // Allow updating extracted fields on confirm
    if (req.body.extracted_fields || req.body.equipment_id_field) {
      await db('oil_sample_requests').where('id', req.params.id).update({
        extracted_fields: req.body.extracted_fields ? JSON.stringify(req.body.extracted_fields) : undefined,
        equipment_id_field: req.body.equipment_id_field || undefined,
        equipment_location: req.body.equipment_location || undefined,
        sample_date: req.body.sample_date || undefined,
        sample_type: req.body.sample_type || undefined,
        condition_notes: req.body.condition_notes || undefined,
      });
    }

    const updated = await OilSampleRequest.confirmData(req.params.id, req.user.id);

    // Dual-file: copy photo from inbox to project folder + central folder
    if (sample.original_photo_path) {
      try {
        const StorageService = require('../services/StorageService');
        const project = await db('projects').where('id', sample.project_id).first();
        const filename = path.basename(sample.original_photo_path);
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');

        // Project subfolder
        let filedProject = null;
        if (project?.folder_path) {
          const projKey = await StorageService.getKeyFromPath(project.folder_path);
          filedProject = `${projKey}/oil_samples/${filename}`;
          await StorageService.copyFile(sample.original_photo_path, filedProject);
        }

        // Central folder
        const filedCentral = `oil_samples/${year}/${month}/${filename}`;
        await StorageService.copyFile(sample.original_photo_path, filedCentral);

        await db('oil_sample_requests').where('id', req.params.id).update({
          filed_path_project: filedProject,
          filed_path_central: filedCentral,
        });
      } catch (fileErr) {
        console.error('[OilSample] Dual-filing error:', fileErr.message);
      }
    }

    res.json({ sample: updated, message: 'Data confirmed. Sample is now pending physical return.' });
  } catch (err) { next(err); }
});

// POST /api/oil-samples/:id/confirm-returned — PM/admin marks physical sample returned
router.post('/:id/confirm-returned', authorize('oil_samples:update'), async (req, res, next) => {
  try {
    const sample = await OilSampleRequest.findById(req.params.id);
    if (!sample) return res.status(404).json({ error: 'Not found' });
    if (sample.status !== 'pending_return') {
      return res.status(400).json({ error: 'Sample is not pending return' });
    }
    // Only PM or admin can confirm return
    if (!['admin', 'project_manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only PM or admin can confirm sample return' });
    }
    const updated = await OilSampleRequest.confirmReturned(req.params.id, req.user.id);
    res.json({ sample: updated, message: 'Sample marked as returned.' });
  } catch (err) { next(err); }
});

// POST /api/oil-samples/:id/snooze — snooze reminder
router.post('/:id/snooze', authorize('oil_samples:update'), async (req, res, next) => {
  try {
    const snoozeDays = parseInt(
      (await db('global_variables').where('key', 'oil_sample_snooze_days').first())?.value || '3'
    );
    const updated = await OilSampleRequest.snoozeReminder(req.params.id, snoozeDays);
    res.json({ sample: updated, message: `Reminder snoozed for ${snoozeDays} days.` });
  } catch (err) { next(err); }
});

// DELETE /api/oil-samples/:id — cancel (admin only)
router.delete('/:id', authorize('oil_samples:delete'), async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await OilSampleRequest.delete(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
