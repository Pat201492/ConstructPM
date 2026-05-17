const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const FieldNote = require('../models/FieldNote');
const db = require('../config/database');

const router = express.Router();
router.use(authenticate);

// GET /api/field-notes — list (filter by project, foreman, date range)
router.get('/', authorize('field_notes:read'), async (req, res, next) => {
  try {
    const { project_id, foreman_id, start_date, end_date, limit, offset } = req.query;

    // Foreman only sees own notes
    const effectiveForeman = req.user.role === 'foreman' ? req.user.id : foreman_id;

    const notes = await FieldNote.findAll({
      project_id, foreman_id: effectiveForeman, start_date, end_date,
      limit: parseInt(limit) || 100, offset: parseInt(offset) || 0,
    });
    res.json({ notes });
  } catch (err) { next(err); }
});

// GET /api/field-notes/export — CSV export (must be before /:id)
router.get('/export', authorize('field_notes:read'), async (req, res, next) => {
  try {
    const { project_id, start_date, end_date } = req.query;
    const notes = await FieldNote.findAll({ project_id, start_date, end_date, limit: 10000 });

    const headers = ['Date', 'Foreman', 'Project', 'Note'];
    const rows = notes.map(n => [n.note_date, n.foreman_name || '', n.project_name || '', n.note_text || '']);

    const escape = v => { const s = String(v||''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s; };
    const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=field_notes_${Date.now()}.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/field-notes/:id — detail
router.get('/:id', authorize('field_notes:read'), async (req, res, next) => {
  try {
    const note = await FieldNote.findById(req.params.id);
    if (!note) return res.status(404).json({ error: 'Not found' });
    // Foreman can only see own
    if (req.user.role === 'foreman' && note.foreman_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(note);
  } catch (err) { next(err); }
});

// POST /api/field-notes — create
router.post('/', authorize('field_notes:create'), async (req, res, next) => {
  try {
    const { project_id, note_date, note_text } = req.body;
    if (!project_id || !note_text) return res.status(400).json({ error: 'project_id and note_text required' });

    // Check max length
    const maxLen = await db('global_variables').where('key', 'field_note_max_length').first();
    const limit = parseInt(maxLen?.value) || 5000;
    if (note_text.length > limit) return res.status(400).json({ error: `Note exceeds max length of ${limit} characters` });

    // Resolve the author's timezone — this is what gets locked to the
    // note for its lifetime so future readers see "the author's clock".
    // Resolution order:
    //   1. Explicit `timezone` in the request body (sent by browser via
    //      Intl.DateTimeFormat().resolvedOptions().timeZone — most accurate)
    //   2. The author's stored default_timezone on their user record
    //   3. America/New_York as a final fallback (firm is NJ-based)
    let authorTimezone = req.body.timezone;
    if (!authorTimezone) {
      const u = await db('users').where({ id: req.user.id }).first();
      authorTimezone = u?.default_timezone || 'America/New_York';
    }

    const note = await FieldNote.create({
      project_id,
      foreman_id: req.user.id,
      note_date: note_date || new Date().toISOString().split('T')[0],
      note_text,
      author_timezone: authorTimezone,
    });
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// PUT /api/field-notes/:id — edit own note (no time limit)
router.put('/:id', authorize('field_notes:update'), async (req, res, next) => {
  try {
    const existing = await FieldNote.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // Only owner or admin can edit
    if (req.user.role !== 'admin' && existing.foreman_id !== req.user.id) {
      return res.status(403).json({ error: 'Can only edit your own notes' });
    }
    const { note_date, note_text } = req.body;
    const note = await FieldNote.update(req.params.id, {
      ...(note_date && { note_date }),
      ...(note_text && { note_text }),
    });
    res.json(note);
  } catch (err) { next(err); }
});

// DELETE /api/field-notes/:id — admin or owner
router.delete('/:id', authorize('field_notes:delete'), async (req, res, next) => {
  try {
    const existing = await FieldNote.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && existing.foreman_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await FieldNote.delete(req.params.id);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
