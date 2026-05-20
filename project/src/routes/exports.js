/**
 * CSV Export Routes
 *
 * Hardcoded format exports (integration-specific):
 *   GET  /quickbooks/invoices, /quickbooks/timesheets, /quickbooks/purchase-orders
 *   GET  /procore/budget, /procore/invoices, /procore/timecards
 *   GET  /equipment
 *
 * Cross-table column-picker builder (drives the Data Export UI):
 *   GET  /builder/sources           — Sources + grouped joinable columns
 *   POST /builder/preview           — First 20 rows preview
 *   POST /builder/download          — Full CSV download
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const ExportService = require('../services/ExportService');

const router = express.Router();
router.use(authenticate);
router.use(authorize('exports:read'));

function sendCSV(res, csv, filename) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get('/quickbooks/invoices', async (req, res, next) => {
  try {
    const csv = await ExportService.quickbooksInvoices(req.query);
    sendCSV(res, csv, `qb_invoices_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/quickbooks/timesheets', async (req, res, next) => {
  try {
    const csv = await ExportService.quickbooksTimesheets(req.query);
    sendCSV(res, csv, `qb_timesheets_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/quickbooks/purchase-orders', async (req, res, next) => {
  try {
    const csv = await ExportService.quickbooksPurchaseOrders(req.query);
    sendCSV(res, csv, `qb_purchase_orders_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/procore/budget', async (req, res, next) => {
  try {
    const csv = await ExportService.procoreBudget(req.query);
    sendCSV(res, csv, `procore_budget_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/procore/invoices', async (req, res, next) => {
  try {
    const csv = await ExportService.procoreInvoices(req.query);
    sendCSV(res, csv, `procore_invoices_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/procore/timecards', async (req, res, next) => {
  try {
    const csv = await ExportService.procoreTimecards(req.query);
    sendCSV(res, csv, `procore_timecards_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

router.get('/equipment', async (req, res, next) => {
  try {
    const csv = await ExportService.equipmentExport(req.query);
    sendCSV(res, csv, `equipment_${Date.now()}.csv`);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// CROSS-TABLE EXPORT BUILDER
// ═══════════════════════════════════════════════════════════

const ExportBuilder = require('../services/ExportBuilder');

// GET /api/exports/builder/sources — all available sources with joinable columns
router.get('/builder/sources', async (req, res, next) => {
  try {
    res.json(ExportBuilder.getSources());
  } catch (err) { next(err); }
});

// GET /api/exports/builder/fanout-config?source=<key> — userScopeColumns + roles
// PR #20: feeds the fan-out config dropdowns on the schedule modal.
router.get('/builder/fanout-config', async (req, res, next) => {
  try {
    const M = require('../services/exportMetadata');
    const db = require('../config/database');
    const source = req.query.source;
    const userScopeColumns = source ? M.getUserScopeColumns(source) : [];
    // Roles in use today — distinct values from the users table (active
    // only). Returning live distinct beats a hardcoded list so newly-
    // added roles surface automatically.
    const roleRows = await db('users').where('active', true).distinct('role').orderBy('role');
    const roles = roleRows.map(r => r.role).filter(Boolean);
    res.json({ userScopeColumns, roles });
  } catch (err) { next(err); }
});

// POST /api/exports/builder/preview — preview first 20 rows
router.post('/builder/preview', async (req, res, next) => {
  try {
    const { source, columns, filters } = req.body;
    if (!source) return res.status(400).json({ error: 'source required' });
    const result = await ExportBuilder.execute(source, columns, { ...filters, limit: 20 });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/exports/builder/download — full CSV download
router.post('/builder/download', async (req, res, next) => {
  try {
    const { source, columns, filters } = req.body;
    if (!source) return res.status(400).json({ error: 'source required' });
    const result = await ExportBuilder.execute(source, columns, filters || {});
    const csv = ExportService.toCSV(result.headers, result.rows);
    sendCSV(res, csv, `${source}_export_${new Date().toISOString().split('T')[0]}.csv`);
  } catch (err) { next(err); }
});

module.exports = router;
