/**
 * Display Board Route (unauthenticated — kiosk/TV use)
 * 
 * Accessed via: GET /api/display/board?token=YOUR_DISPLAY_TOKEN
 * Token set in env: DISPLAY_TOKEN (default: 'shopfloor')
 * 
 * Returns today's equipment requests with filled/unfilled status.
 * Also returns equipment checked out today and cert expirations.
 * Designed for wall-mounted shop floor TV with auto-refresh frontend.
 */

const express = require('express');
const db = require('../config/database');

const router = express.Router();

// Simple token auth — not a user login, just a shared secret for the display
function displayAuth(req, res, next) {
  const token = req.query.token || req.headers['x-display-token'];
  const expected = process.env.DISPLAY_TOKEN || 'shopfloor';
  if (token !== expected) {
    return res.status(401).json({ error: 'Invalid display token' });
  }
  next();
}

router.use(displayAuth);

/**
 * GET /api/display/board — Full display board payload
 * Returns everything the kiosk screen needs in one call.
 */
router.get('/board', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // ── TODAY'S EQUIPMENT REQUESTS ──────────────────────────
    const requests = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as requested_by_name"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .join('users', 'equipment_requests.requested_by', 'users.id')
      .whereIn('equipment_requests.status', ['open', 'partially_filled', 'filled'])
      .where('equipment_requests.created_at', '>=', today)
      .orderBy('equipment_requests.created_at', 'desc');

    // ── UNFILLED REQUESTS FROM PREVIOUS DAYS (still open) ───
    const carryover = await db('equipment_requests')
      .select('equipment_requests.*', 'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as requested_by_name"))
      .join('projects', 'equipment_requests.project_id', 'projects.id')
      .join('users', 'equipment_requests.requested_by', 'users.id')
      .whereIn('equipment_requests.status', ['open', 'partially_filled'])
      .where('equipment_requests.created_at', '<', today)
      .orderBy('equipment_requests.created_at', 'desc');

    // Batch-fetch ALL request lines in one query (avoids N+1)
    const allRequestIds = [...requests, ...carryover].map(r => r.id);
    const allLines = allRequestIds.length > 0
      ? await db('equipment_request_lines')
          .select('equipment_request_lines.*', 'equipment.barcode_id', 'equipment.equipment_name as assigned_equipment_name')
          .leftJoin('equipment', 'equipment_request_lines.assigned_equipment_id', 'equipment.id')
          .whereIn('request_id', allRequestIds)
      : [];

    // Map lines to their requests
    const linesByRequest = {};
    for (const line of allLines) {
      if (!linesByRequest[line.request_id]) linesByRequest[line.request_id] = [];
      linesByRequest[line.request_id].push(line);
    }
    for (const r of [...requests, ...carryover]) {
      r.lines = linesByRequest[r.id] || [];
      r.total_lines = r.lines.length;
      r.filled_lines = r.lines.filter(l => l.assigned_equipment_id).length;
    }

    // ── TODAY'S CHECKOUTS ───────────────────────────────────
    const todayCheckouts = await db('equipment_checkout_log')
      .select('equipment_checkout_log.*',
        'equipment.barcode_id', 'equipment.equipment_name',
        'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as checked_out_by_name"))
      .join('equipment', 'equipment_checkout_log.equipment_id', 'equipment.id')
      .join('projects', 'equipment_checkout_log.project_id', 'projects.id')
      .join('users', 'equipment_checkout_log.checked_out_by', 'users.id')
      .where('equipment_checkout_log.checked_out_at', '>=', today)
      .orderBy('equipment_checkout_log.checked_out_at', 'desc');

    // ── TODAY'S RETURNS ─────────────────────────────────────
    const todayReturns = await db('equipment_checkout_log')
      .select('equipment_checkout_log.*',
        'equipment.barcode_id', 'equipment.equipment_name',
        'projects.name as project_name',
        db.raw("rb.first_name || ' ' || rb.last_name as returned_by_name"))
      .join('equipment', 'equipment_checkout_log.equipment_id', 'equipment.id')
      .join('projects', 'equipment_checkout_log.project_id', 'projects.id')
      .join('users as rb', 'equipment_checkout_log.returned_by', 'rb.id')
      .whereNotNull('equipment_checkout_log.returned_at')
      .where('equipment_checkout_log.returned_at', '>=', today)
      .orderBy('equipment_checkout_log.returned_at', 'desc');

    // ── CERTIFICATIONS EXPIRING SOON ────────────────────────
    const certCutoff = new Date();
    certCutoff.setDate(certCutoff.getDate() + 14);
    const expiringCerts = await db('equipment')
      .whereNotNull('certification_date')
      .where('certification_date', '<=', certCutoff.toISOString().split('T')[0])
      .whereNot('status', 'retired')
      .orderBy('certification_date', 'asc');

    // ── EQUIPMENT NEEDING MAINTENANCE ───────────────────────
    const maintenanceItems = await db('equipment')
      .where('status', 'maintenance_required')
      .orderBy('updated_at', 'desc');

    // ── SUMMARY STATS ───────────────────────────────────────
    const [equipStats] = await db('equipment')
      .select(
        db.raw("COUNT(*) as total"),
        db.raw("COUNT(*) FILTER (WHERE status = 'available') as available"),
        db.raw("COUNT(*) FILTER (WHERE status = 'checked_out') as checked_out"),
        db.raw("COUNT(*) FILTER (WHERE status = 'maintenance_required') as needs_maintenance"),
      );

    res.json({
      timestamp: now.toISOString(),
      date: today,
      requests_today: requests,
      requests_carryover: carryover,
      checkouts_today: todayCheckouts,
      returns_today: todayReturns,
      expiring_certs: expiringCerts,
      maintenance_items: maintenanceItems,
      stats: equipStats,
    });
  } catch (err) { next(err); }
});

module.exports = router;
