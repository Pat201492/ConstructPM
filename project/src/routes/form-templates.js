/**
 * Form Templates Routes
 * 
 * Admin-only endpoints for managing form extraction templates.
 * 
 * Flow:
 *   1. Admin uploads a color-coded reference image (blue=labels, red=data zones)
 *   2. Backend sends image to vision AI → AI identifies fields + data types
 *   3. Admin reviews proposed field_map, edits names/types, adjusts as needed
 *   4. Admin activates template → used for all future oil sample extractions
 * 
 * POST   /upload          — Upload annotated reference image, AI proposes field_map
 * GET    /                — List all templates (filter by form_type, active)
 * GET    /:id             — Template detail including field_map
 * PUT    /:id/field-map   — Admin edits field_map (rename fields, set data_types)
 * POST   /:id/activate    — Activate template (deactivates prior active for same form_type)
 * POST   /:id/deactivate  — Deactivate template
 * DELETE /:id             — Delete (only if never activated)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fsPromises = require('fs').promises;
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const FormTemplate = require('../models/FormTemplate');

const router = express.Router();
router.use(authenticate);

const upload = multer({ dest: '/tmp/form_template_uploads/', limits: { fileSize: 20 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════════════
// TEMPLATE ANALYSIS PROMPT
// ═══════════════════════════════════════════════════════════

const TEMPLATE_ANALYSIS_PROMPT = `You are analyzing a color-coded reference form template for a document extraction system.

This image is an ANNOTATED REFERENCE COPY of a form. The annotations use two colors:
- BLUE regions mark FIELD LABELS (the names/descriptions of each field)
- RED regions mark DATA ZONES (where handwritten data would appear on a filled form)

Your task: identify every labeled field on this form and describe what type of data each expects.

Return ONLY valid JSON in this format:
{
  "fields": [
    {
      "field_name": "short_snake_case_name",
      "label_text": "The exact label text you read from the blue region",
      "data_type": "text|number|date|checkbox|filled_circle",
      "description": "Brief description of what this field captures"
    }
  ]
}

Rules for data_type:
- "text" — handwritten or printed text (names, descriptions, notes)
- "number" — numeric values (hours, quantities, readings)
- "date" — dates in any format
- "checkbox" — a box that can be checked or unchecked (X mark or checkmark)
- "filled_circle" — a circle that can be filled in or left empty

List fields in order from top-left to bottom-right as they appear on the form.
If a field label is partially obscured or unclear, make your best guess and note it in the description.`;

// ═══════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════

// POST /api/form-templates/upload — upload annotated reference + AI analysis
router.post('/upload', authorize('admin:manage'), upload.single('template_image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const { form_type, name } = req.body;
    if (!form_type) return res.status(400).json({ error: 'form_type required (e.g., oil_sample)' });
    if (!name) return res.status(400).json({ error: 'name required' });

    // Store the template image
    const ext = path.extname(req.file.originalname) || '.png';
    const destKey = `form_templates/${form_type}/${Date.now()}_${req.file.originalname}`;
    const FileService = require('../services/FileService');
    await FileService.storeUploadedFile(req.file.path, destKey);
    try { await fsPromises.unlink(req.file.path); } catch {}

    // Run vision AI to analyze the annotated image
    const fullPath = await FileService.getFullPath(destKey);
    const ExtractionService = require('../services/ExtractionService');

    let proposedFields = [];
    try {
      // Use extractWithVision with a special analysis field map
      const analysisFieldMap = [{ field_name: 'analysis', data_type: 'text' }];
      
      // Instead, use the raw vision methods with the template analysis prompt
      const AIConfig = require('../config/aiConfig');
      const imageBuffer = await fsPromises.readFile(fullPath);
      const base64Image = imageBuffer.toString('base64');
      const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

      let analysisResult = null;

      // Try Llava first
      if (AIConfig.visionBackend === 'ollama' || AIConfig.visionBackend === 'auto') {
        try {
          const response = await fetch(`${AIConfig.ollamaHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: AIConfig.ollamaVisionModel,
              messages: [{ role: 'user', content: TEMPLATE_ANALYSIS_PROMPT, images: [base64Image] }],
              stream: false, format: 'json',
              options: { temperature: 0.1, num_predict: 4096 },
            }),
          });
          if (response.ok) {
            const data = await response.json();
            const text = (data.message?.content || '').replace(/```json\s*|```/g, '').trim();
            analysisResult = JSON.parse(text);
          }
        } catch (e) { console.log('[FormTemplate] Llava analysis failed:', e.message); }
      }

      // Fallback to Claude Vision
      if (!analysisResult && AIConfig.anthropicApiKey) {
        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': AIConfig.anthropicApiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: AIConfig.claudeVisionModel,
              max_tokens: 4096,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
                { type: 'text', text: TEMPLATE_ANALYSIS_PROMPT },
              ] }],
            }),
          });
          if (response.ok) {
            const data = await response.json();
            const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
            analysisResult = JSON.parse(text.replace(/```json\s*|```/g, '').trim());
          }
        } catch (e) { console.log('[FormTemplate] Claude Vision analysis failed:', e.message); }
      }

      if (analysisResult?.fields) {
        proposedFields = analysisResult.fields.map(f => ({
          field_name: f.field_name || f.label_text?.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unknown',
          label_text: f.label_text || '',
          data_type: f.data_type || 'text',
          description: f.description || '',
        }));
      }
    } catch (analysisErr) {
      console.error('[FormTemplate] AI analysis error:', analysisErr.message);
    }

    // Create the template record
    const template = await FormTemplate.create({
      form_type,
      name,
      template_image_path: destKey,
      field_map: proposedFields.length > 0 ? JSON.stringify(proposedFields) : null,
      created_by: req.user.id,
      active: false,
    });

    res.status(201).json({
      template,
      proposed_fields: proposedFields,
      message: proposedFields.length > 0
        ? `AI identified ${proposedFields.length} fields. Review and edit before activating.`
        : 'AI could not analyze the image. Add fields manually via PUT /field-map.',
    });
  } catch (err) { next(err); }
});

// GET /api/form-templates — list all templates
router.get('/', authorize('admin:manage'), async (req, res, next) => {
  try {
    const { form_type, active } = req.query;
    const templates = await FormTemplate.findAll({
      form_type,
      active: active !== undefined ? active === 'true' : undefined,
    });
    res.json({ templates });
  } catch (err) { next(err); }
});

// GET /api/form-templates/:id — detail
router.get('/:id', authorize('admin:manage'), async (req, res, next) => {
  try {
    const template = await FormTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Not found' });
    // Parse field_map if string
    if (typeof template.field_map === 'string') {
      template.field_map = JSON.parse(template.field_map);
    }
    res.json({ template });
  } catch (err) { next(err); }
});

// PUT /api/form-templates/:id/field-map — admin edits field map
router.put('/:id/field-map', authorize('admin:manage'), async (req, res, next) => {
  try {
    const { field_map } = req.body;
    if (!field_map || !Array.isArray(field_map)) {
      return res.status(400).json({ error: 'field_map must be an array of {field_name, data_type, ...}' });
    }
    // Validate each field
    const validTypes = ['text', 'number', 'date', 'checkbox', 'filled_circle'];
    for (const f of field_map) {
      if (!f.field_name) return res.status(400).json({ error: 'Each field must have a field_name' });
      if (f.data_type && !validTypes.includes(f.data_type)) {
        return res.status(400).json({ error: `Invalid data_type "${f.data_type}". Valid: ${validTypes.join(', ')}` });
      }
    }
    const template = await FormTemplate.updateFieldMap(req.params.id, field_map);
    if (!template) return res.status(404).json({ error: 'Not found' });
    res.json({ template, message: `Field map updated with ${field_map.length} fields.` });
  } catch (err) { next(err); }
});

// POST /api/form-templates/:id/activate
router.post('/:id/activate', authorize('admin:manage'), async (req, res, next) => {
  try {
    const template = await FormTemplate.activate(req.params.id);
    res.json({ template, message: `Template "${template.name}" is now active for ${template.form_type}. Previous active template (if any) was deactivated.` });
  } catch (err) { next(err); }
});

// POST /api/form-templates/:id/deactivate
router.post('/:id/deactivate', authorize('admin:manage'), async (req, res, next) => {
  try {
    const template = await FormTemplate.deactivate(req.params.id);
    if (!template) return res.status(404).json({ error: 'Not found' });
    res.json({ template, message: 'Template deactivated.' });
  } catch (err) { next(err); }
});

// DELETE /api/form-templates/:id — only if never activated
router.delete('/:id', authorize('admin:manage'), async (req, res, next) => {
  try {
    await FormTemplate.delete(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
