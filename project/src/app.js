const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { errorHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const contactRoutes = require('./routes/contacts');
const locationRoutes = require('./routes/locations');
const vendorRoutes = require('./routes/vendors');
const purchaseOrderRoutes = require('./routes/purchase-orders');
const bidRoutes = require('./routes/bids');
const projectRoutes = require('./routes/projects');
const schedulerRoutes = require('./routes/scheduler');
const fileRoutes = require('./routes/files');
const extractionRoutes = require('./routes/extractions');
const notificationRoutes = require('./routes/notifications');
const timesheetRoutes = require('./routes/timesheets');
const inventoryRoutes = require('./routes/inventory');
const exportRoutes = require('./routes/exports');
const savedExportRoutes = require('./routes/savedExports');
const adminRoutes = require('./routes/admin');
const inboxRoutes = require('./routes/inbox');
const equipmentRoutes = require('./routes/equipment');
const equipmentTicketsRoutes = require('./routes/equipmentTickets');
const displayRoutes = require('./routes/display');
const financialsRoutes = require('./routes/financials');

const app = express();

// ── SECURITY & PARSING ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── STATIC FRONTEND ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── LOGGING ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '2.0.0',
  });
});

// ── ROUTES ────────────────────────────────────────────────────
// Core
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);

// Bids & Projects
app.use('/api/bids', bidRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/scheduler', schedulerRoutes);

// Files & AI Extraction
app.use('/api/files', fileRoutes);
app.use('/api/extractions', extractionRoutes);

// Notifications
app.use('/api/notifications', notificationRoutes);

// Timesheets (list, group by project/worker, summary)
app.use('/api/timesheets', timesheetRoutes);

// Inventory (consumable materials — separate from equipment)
app.use('/api/inventory', inventoryRoutes);

// CSV Exports (QuickBooks, Procore, equipment, custom).
// Schedules MUST mount first so its handlers run before the broader
// `/api/exports` prefix middleware (which would otherwise authenticate
// + authorize twice and risk a future 404 catch-all in exportRoutes
// swallowing schedule requests).
app.use('/api/exports/schedules', savedExportRoutes);
app.use('/api/exports', exportRoutes);

// Admin (rate sheet, global variables, templates, inbox access)
app.use('/api/admin', adminRoutes);

// Centralized document inboxes (timesheets, invoices, purchase orders)
app.use('/api/inbox', inboxRoutes);

// Equipment management (barcode tracking, checkout/return, maintenance)
app.use('/api/equipment', equipmentRoutes);
app.use('/api/equipment-tickets', equipmentTicketsRoutes);

// Display board (unauthenticated kiosk — uses DISPLAY_TOKEN)
app.use('/api/display', displayRoutes);

// Financials (cross-project invoices & POs — accounting, PM, admin)
app.use('/api/financials', financialsRoutes);

// Field Notes (foreman notes per project)
const fieldNoteRoutes = require('./routes/field-notes');
app.use('/api/field-notes', fieldNoteRoutes);

// Oil Samples (oil sample request lifecycle)
const oilSampleRoutes = require('./routes/oil-samples');
app.use('/api/oil-samples', oilSampleRoutes);

// Form Templates (admin — vision extraction templates)
const formTemplateRoutes = require('./routes/form-templates');
app.use('/api/form-templates', formTemplateRoutes);

// ── 404 HANDLER ───────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Not found',
      message: `Route ${req.method} ${req.path} does not exist.`,
    });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
