/**
 * Target-state database schema for Construction PM Platform v2
 * 
 * Fresh migration — replaces all previous migrations.
 * Based on PROJECT_REFERENCE.md Section 11.
 * 
 * Tables: 30 total
 *   Core:       users, refresh_tokens, customers, customer_contacts, locations
 *   Bids:       bids, bid_quote_lines, bid_templates
 *   Projects:   projects, project_numbers, project_assignments
 *   Financials: invoices, invoice_line_items, purchase_orders, po_line_items, contracts
 *   Labor:      timesheets, rate_sheet
 *   Inventory:  inventory, inventory_allocations
 *   Equipment:  equipment, equipment_requests, equipment_request_lines,
 *               equipment_checkout_log, equipment_documents
 *   System:     notifications, pending_extractions, file_activity_log,
 *               vendor_profiles, global_variables, inbox_access,
 *               pm_notification_delegates, audit_log
 */

exports.up = async function (knex) {
  // ══════════════════════════════════════════════════════════
  // ENUM TYPES
  // ══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TYPE user_role AS ENUM (
      'admin', 'project_manager', 'accounting', 'shop_staff', 'field_staff'
    );
    CREATE TYPE bid_status AS ENUM (
      'draft', 'submitted', 'pending', 'won', 'lost', 'archived', 'cancelled'
    );
    CREATE TYPE project_status AS ENUM (
      'active', 'on_hold', 'completed', 'cancelled'
    );
    CREATE TYPE contract_type AS ENUM (
      'contract', 't_and_m'
    );
    CREATE TYPE invoice_status AS ENUM (
      'pending', 'pending_review', 'approved', 'paid', 'partial_paid', 'disputed', 'overdue', 'cancelled'
    );
    CREATE TYPE po_status AS ENUM (
      'draft', 'submitted', 'partially_received', 'received', 'cancelled'
    );
    CREATE TYPE extraction_status AS ENUM (
      'processing', 'pending', 'confirmed', 'rejected', 'failed'
    );
    CREATE TYPE doc_type AS ENUM (
      'invoice', 'timesheet', 'purchase_order', 'contract'
    );
    CREATE TYPE notification_channel AS ENUM (
      'in_app', 'email', 'push'
    );
    CREATE TYPE notification_priority AS ENUM (
      'low', 'normal', 'high', 'urgent'
    );
    CREATE TYPE notification_category AS ENUM (
      'actionable', 'informational'
    );
    CREATE TYPE equipment_status AS ENUM (
      'available', 'checked_out', 'maintenance_required', 'in_maintenance', 'retired'
    );
    CREATE TYPE equipment_request_status AS ENUM (
      'open', 'partially_filled', 'filled', 'cancelled'
    );
  `);

  // ══════════════════════════════════════════════════════════
  // CORE TABLES
  // ══════════════════════════════════════════════════════════

  // ── USERS ─────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('initials', 10);
    t.specificType('role', 'user_role').notNullable().defaultTo('field_staff');
    t.string('phone', 20);
    t.boolean('active').notNullable().defaultTo(true);
    t.jsonb('notification_preferences').defaultTo(JSON.stringify({
      in_app: true, email: true, push: true,
    }));
    // Per-user overrides (null = use role defaults)
    t.jsonb('tab_overrides');       // Array of tab IDs, or null for role default
    t.jsonb('access_config');       // {bid_visibility, project_visibility, bid_ids, project_ids}
    t.decimal('default_markup_pct', 5, 2).defaultTo(15); // Default markup % for quoting
    t.timestamp('last_login_at');
    t.timestamps(true, true);
  });

  // ── REFRESH TOKENS ────────────────────────────────────────
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.string('device_info', 255);
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);
    t.index('user_id');
    t.index('expires_at');
  });

  // ── PM NOTIFICATION DELEGATES ─────────────────────────────
  await knex.schema.createTable('pm_notification_delegates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('pm_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('delegate_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamps(true, true);
    t.unique(['pm_user_id', 'delegate_user_id']);
  });

  // ── CUSTOMERS ─────────────────────────────────────────────
  await knex.schema.createTable('customers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.string('billing_street', 500);
    t.string('billing_town', 100);
    t.string('billing_state', 50);
    t.string('billing_zip', 20);
    t.string('billing_display_address', 500); // Auto-generated: street, town, state (no zip)
    t.text('notes');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  // ── CUSTOMER CONTACTS ─────────────────────────────────────
  await knex.schema.createTable('customer_contacts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.string('name', 255).notNullable();
    t.string('email', 255);
    t.string('phone', 20);
    t.string('company', 255); // Stored on contact, NOT a separate table
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('customer_id');
  });

  // ── LOCATIONS ─────────────────────────────────────────────
  await knex.schema.createTable('locations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.string('street', 500);
    t.string('town', 100);
    t.string('state', 50);
    t.string('zip', 20);
    t.string('display_address', 500); // Auto: street, town, state (no zip)
    t.string('local_union', 50);
    t.decimal('miles_from_hq', 8, 2); // Google Maps calculated, user confirmed
    t.decimal('latitude', 10, 7);
    t.decimal('longitude', 10, 7);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('local_union');
  });

  // ══════════════════════════════════════════════════════════
  // BID TABLES
  // ══════════════════════════════════════════════════════════

  // ── RATE SHEET (global lookup) ────────────────────────────
  await knex.schema.createTable('rate_sheet', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('local_union', 50).notNullable();
    t.string('classification', 100).notNullable(); // e.g., 'Foreman', 'Journeyman', 'AP5'
    t.decimal('st_rate', 10, 2).notNullable(); // Straight time rate
    t.decimal('ot_rate', 10, 2).notNullable(); // Overtime rate
    t.decimal('dt_rate', 10, 2).notNullable(); // Double time rate
    t.timestamps(true, true);
    t.unique(['local_union', 'classification']);
    t.index('local_union');
  });

  // ── BID TEMPLATES ─────────────────────────────────────────
  await knex.schema.createTable('bid_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('pm_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('template_type', 20).notNullable().defaultTo('bid'); // 'bid' or 'invoice'
    t.string('template_name', 255);
    t.string('original_filename', 255);
    t.string('file_path', 500).notNullable();
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('pm_id');
    t.index('template_type');
  });

  // ── BIDS ──────────────────────────────────────────────────
  await knex.schema.createTable('bids', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('bid_number', 50).notNullable().unique(); // Format: YY-PMInitials-NextNum (per-PM sequence)
    t.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.uuid('customer_contact_id').references('id').inTable('customer_contacts').onDelete('SET NULL');
    t.uuid('location_id').references('id').inTable('locations').onDelete('SET NULL');
    t.uuid('estimator_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.string('project_scope', 500).notNullable();
    t.specificType('status', 'bid_status').notNullable().defaultTo('draft');
    t.text('description');
    // Location-derived fields (editable)
    t.string('local_union', 50); // From location, editable by user
    t.decimal('miles_from_hq', 8, 2); // From location
    // Quoting system fields
    t.decimal('markup_pct', 5, 2); // Markup percentage
    t.integer('project_length_days'); // Estimator enters for mileage calc
    t.decimal('total_labor_cost', 14, 2); // Calculated from quote lines
    t.decimal('total_mileage_cost', 14, 2); // Calculated: miles×2 × personnel × days × $/mile
    t.decimal('subtotal', 14, 2); // Labor + mileage
    t.decimal('bid_amount', 14, 2); // OCR from final Word doc on Won (source of truth)
    // Dates
    t.date('bid_date');
    t.date('due_date');
    t.date('won_date');
    t.date('archived_date');
    // Storage
    t.string('folder_path', 500);
    t.string('excel_file_path', 500);
    t.string('word_doc_path', 500);
    // Snooze tracking for inactivity archiver
    t.timestamp('snooze_until');
    t.timestamps(true, true);
    t.index('estimator_id');
    t.index('customer_id');
    t.index('location_id');
    t.index('status');
  });

  // ── BID QUOTE LINES ───────────────────────────────────────
  // Stores the quoting table data + LOCKS the rates at bid creation time
  await knex.schema.createTable('bid_quote_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('bid_id').notNullable().references('id').inTable('bids').onDelete('CASCADE');
    t.string('classification', 100).notNullable(); // e.g., 'Foreman-98'
    t.integer('personnel').notNullable().defaultTo(1);
    t.decimal('st_hours', 8, 2).notNullable().defaultTo(0); // Per person
    t.decimal('ot_hours', 8, 2).notNullable().defaultTo(0);
    t.decimal('dt_hours', 8, 2).notNullable().defaultTo(0);
    t.decimal('total_st_hours', 10, 2); // personnel × st_hours
    t.decimal('total_ot_hours', 10, 2);
    t.decimal('total_dt_hours', 10, 2);
    // Rates LOCKED at bid creation (snapshot from rate_sheet)
    t.decimal('st_rate', 10, 2).notNullable();
    t.decimal('ot_rate', 10, 2).notNullable();
    t.decimal('dt_rate', 10, 2).notNullable();
    t.decimal('line_total_cost', 14, 2); // (total_st × st_rate) + (total_ot × ot_rate) + (total_dt × dt_rate)
    t.timestamps(true, true);
    t.index('bid_id');
  });

  // ══════════════════════════════════════════════════════════
  // PROJECT TABLES
  // ══════════════════════════════════════════════════════════

  // ── PROJECTS ──────────────────────────────────────────────
  await knex.schema.createTable('projects', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.integer('year').notNullable();
    t.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.uuid('location_id').references('id').inTable('locations').onDelete('SET NULL');
    t.uuid('pm_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('bid_id').unique().references('id').inTable('bids').onDelete('SET NULL');
    // Status & type
    t.specificType('status', 'project_status').notNullable().defaultTo('active');
    t.specificType('contract_type', 'contract_type'); // 'contract' or 't_and_m' — set from notification
    // Financial fields
    t.decimal('contract_value', 14, 2); // From bid amount, updated when contract uploaded
    t.decimal('contract_man_hours', 10, 2); // From quoting system (sum of all ST+OT+DT)
    t.string('payment_terms', 50); // e.g., 'Net 30', 'Net 60'
    // Location-derived
    t.string('local_union', 50); // From bid → location
    t.decimal('miles_from_hq', 8, 2); // From bid
    t.string('address', 500);
    t.text('description');
    // Storage
    t.string('folder_path', 500);
    // Dates
    t.date('start_date');
    t.date('end_date');
    t.timestamps(true, true);
    t.index('pm_id');
    t.index('customer_id');
    t.index('location_id');
    t.index('year');
    t.index('status');
  });

  // ── PROJECT NUMBERS ───────────────────────────────────────
  await knex.schema.createTable('project_numbers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('number', 100).notNullable();
    t.string('label', 100); // e.g., 'Internal #', 'Customer PO #', 'Contract #'
    t.timestamps(true, true);
    t.index('project_id');
    t.unique(['project_id', 'number']);
  });

  // ── PROJECT ASSIGNMENTS ───────────────────────────────────
  await knex.schema.createTable('project_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role_on_project', 100);
    t.timestamps(true, true);
    t.unique(['project_id', 'user_id']);
  });

  // ══════════════════════════════════════════════════════════
  // FINANCIAL TABLES
  // ══════════════════════════════════════════════════════════

  // ── INVOICES (Revenue) ────────────────────────────────────
  await knex.schema.createTable('invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('invoice_number', 100);
    t.string('customer', 255); // Who is being billed (from OCR)
    t.decimal('amount', 14, 2); // Total revenue
    t.date('invoice_date');
    // Payment tracking
    t.date('payment_due_date'); // invoice_date + payment_terms
    t.date('payment_received_date');
    t.decimal('payment_received_amount', 14, 2); // Null = full payment assumed
    t.specificType('status', 'invoice_status').notNullable().defaultTo('pending_review');
    // Source
    t.string('file_path', 500);
    t.uuid('confirmed_by').references('id').inTable('users').onDelete('SET NULL');
    t.text('notes');
    t.timestamps(true, true);
    t.index('project_id');
    t.index('status');
    t.index('payment_due_date');
  });

  // ── INVOICE LINE ITEMS ────────────────────────────────────
  await knex.schema.createTable('invoice_line_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.string('description', 500);
    t.decimal('quantity', 12, 2);
    t.decimal('unit_price', 12, 2);
    t.decimal('total', 14, 2);
    t.integer('sort_order').defaultTo(0);
    t.timestamps(true, true);
    t.index('invoice_id');
  });

  // ── PURCHASE ORDERS (Cost) ────────────────────────────────
  await knex.schema.createTable('purchase_orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('po_number', 100);
    t.string('vendor', 255);
    t.decimal('total', 14, 2); // Total cost
    t.date('order_date');
    t.date('delivery_date');
    t.specificType('status', 'po_status').notNullable().defaultTo('draft');
    t.string('file_path', 500);
    t.uuid('confirmed_by').references('id').inTable('users').onDelete('SET NULL');
    t.text('notes');
    t.timestamps(true, true);
    t.index('project_id');
    t.index('status');
  });

  // ── PO LINE ITEMS ─────────────────────────────────────────
  await knex.schema.createTable('po_line_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('po_id').notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
    t.string('description', 500);
    t.decimal('quantity', 12, 2);
    t.decimal('unit_price', 12, 2);
    t.decimal('total', 14, 2);
    t.integer('sort_order').defaultTo(0);
    t.timestamps(true, true);
    t.index('po_id');
  });

  // ── CONTRACTS ─────────────────────────────────────────────
  await knex.schema.createTable('contracts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('contract_number', 100);
    t.string('parties', 500);
    t.decimal('value', 14, 2);
    t.date('start_date');
    t.date('end_date');
    t.decimal('retention_pct', 5, 2);
    t.string('payment_terms', 50);
    t.string('file_path', 500);
    t.uuid('confirmed_by').references('id').inTable('users').onDelete('SET NULL');
    t.jsonb('key_terms');
    t.text('notes');
    t.timestamps(true, true);
    t.index('project_id');
  });

  // ══════════════════════════════════════════════════════════
  // LABOR TABLES
  // ══════════════════════════════════════════════════════════

  // ── TIMESHEETS ────────────────────────────────────────────
  await knex.schema.createTable('timesheets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    // Worker info (from OCR extraction)
    t.string('worker_name', 255);
    t.string('classification', 100); // From timesheet file (e.g., 'Foreman')
    t.string('local_union', 50); // FROM PROJECT record, NOT from file
    // Week period
    t.date('work_date').notNullable(); // Week-ending date (e.g., Friday)
    t.date('week_ending'); // Same as work_date — explicit week-ending reference
    t.integer('days_worked').defaultTo(5); // Number of days in this week entry
    // Hours (total for the week, not per day)
    t.decimal('st_hours', 8, 2).notNullable().defaultTo(0);
    t.decimal('ot_hours', 8, 2).notNullable().defaultTo(0);
    t.decimal('dt_hours', 8, 2).notNullable().defaultTo(0);
    t.decimal('miles_driven', 8, 2).defaultTo(0); // Total miles for the week
    // Daily breakdown (optional — for document export)
    // Format: [{day:"Mon",hours:8,ot:2,miles:25},{day:"Tue",hours:8,ot:0,miles:25},...]
    t.jsonb('daily_details');
    // Per diem
    t.decimal('per_diem_rate', 8, 2).defaultTo(0); // Daily per diem rate
    t.decimal('per_diem_total', 10, 2).defaultTo(0); // per_diem_rate × days_worked
    // Rates (looked up from bid_quote_lines — locked at bid creation)
    t.decimal('billing_rate_st', 10, 2);
    t.decimal('billing_rate_ot', 10, 2);
    t.decimal('billing_rate_dt', 10, 2);
    // Calculated fields
    t.decimal('potential_revenue', 14, 2); // (st×rate_st) + (ot×rate_ot) + (dt×rate_dt)
    t.decimal('mileage_cost', 10, 2); // miles × global $/mile
    // Source & approval
    t.string('source', 20).notNullable().defaultTo('inbox'); // 'inbox', 'web', 'mobile'
    t.boolean('approved').defaultTo(false);
    t.uuid('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.string('file_path', 500);
    t.text('description');
    t.timestamps(true, true);
    t.index('project_id');
    t.index('work_date');
    t.index('worker_name');
  });

  // ══════════════════════════════════════════════════════════
  // INVENTORY TABLES (consumable materials)
  // ══════════════════════════════════════════════════════════

  // ── INVENTORY ─────────────────────────────────────────────
  await knex.schema.createTable('inventory', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('item_name', 255).notNullable();
    t.string('category', 100);
    t.string('sku', 100).unique();
    t.decimal('quantity', 12, 2).notNullable().defaultTo(0);
    t.string('unit', 50);
    t.decimal('min_stock', 12, 2).defaultTo(0);
    t.string('location', 255);
    t.decimal('unit_cost', 10, 2);
    t.text('notes');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('category');
  });

  // ── INVENTORY ALLOCATIONS ─────────────────────────────────
  await knex.schema.createTable('inventory_allocations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('inventory_id').notNullable().references('id').inTable('inventory').onDelete('CASCADE');
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('allocated_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.decimal('quantity', 12, 2).notNullable();
    t.text('notes');
    t.timestamps(true, true);
    t.index('project_id');
    t.index('inventory_id');
  });

  // ══════════════════════════════════════════════════════════
  // EQUIPMENT TABLES (serialized reusable assets)
  // ══════════════════════════════════════════════════════════

  // ── EQUIPMENT ─────────────────────────────────────────────
  await knex.schema.createTable('equipment', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('barcode_id', 100).notNullable().unique();
    t.string('equipment_name', 255).notNullable();
    t.string('manufacturer', 255);
    t.string('equipment_type', 100); // Category for grouping/search
    t.decimal('equipment_cost', 10, 2).defaultTo(0); // Daily rate (defaults $0)
    t.date('certification_date'); // Expiration date
    t.integer('cert_expiry_alert_days').defaultTo(30); // Configurable per item/type
    t.specificType('status', 'equipment_status').notNullable().defaultTo('available');
    t.uuid('current_project_id').references('id').inTable('projects').onDelete('SET NULL');
    t.string('current_location', 255).defaultTo('shop'); // 'shop' or project reference
    t.text('notes');
    t.timestamps(true, true);
    t.index('barcode_id');
    t.index('status');
    t.index('equipment_type');
    t.index('current_project_id');
  });

  // ── EQUIPMENT REQUESTS ────────────────────────────────────
  await knex.schema.createTable('equipment_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('requested_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.string('personnel_name', 255); // Who is receiving the equipment
    t.specificType('status', 'equipment_request_status').notNullable().defaultTo('open');
    t.string('source', 20).notNullable().defaultTo('typed'); // 'photo_ocr' or 'typed'
    t.string('source_file_path', 500); // If photo upload
    t.timestamps(true, true);
    t.index('project_id');
    t.index('status');
  });

  // ── EQUIPMENT REQUEST LINES ───────────────────────────────
  await knex.schema.createTable('equipment_request_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('request_id').notNullable().references('id').inTable('equipment_requests').onDelete('CASCADE');
    t.string('item_description', 500).notNullable(); // What PM asked for (e.g., 'generator')
    t.integer('quantity').notNullable().defaultTo(1);
    t.uuid('assigned_equipment_id').references('id').inTable('equipment').onDelete('SET NULL'); // Filled when shop staff scans
    t.uuid('assigned_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('assigned_at');
    t.timestamps(true, true);
    t.index('request_id');
  });

  // ── EQUIPMENT CHECKOUT LOG ────────────────────────────────
  await knex.schema.createTable('equipment_checkout_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('equipment_id').notNullable().references('id').inTable('equipment').onDelete('CASCADE');
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('request_line_id').references('id').inTable('equipment_request_lines').onDelete('SET NULL');
    t.uuid('checked_out_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('checked_out_at').notNullable().defaultTo(knex.fn.now());
    t.uuid('returned_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('returned_at');
    t.text('notes');
    t.timestamps(true, true);
    t.index('equipment_id');
    t.index('project_id');
    t.index('checked_out_at');
  });

  // ── EQUIPMENT DOCUMENTS ───────────────────────────────────
  await knex.schema.createTable('equipment_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('equipment_id').notNullable().references('id').inTable('equipment').onDelete('CASCADE');
    t.string('document_type', 50).notNullable(); // calibration_cert, inspection_report, maintenance_receipt, manual, other
    t.string('file_path', 500).notNullable();
    t.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
    t.date('document_date');
    t.text('notes');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('equipment_id');
  });

  // ══════════════════════════════════════════════════════════
  // SYSTEM TABLES
  // ══════════════════════════════════════════════════════════

  // ── NOTIFICATIONS ─────────────────────────────────────────
  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 100).notNullable(); // e.g., 'extraction_ready', 'payment_overdue', 'bid_archive'
    t.specificType('category', 'notification_category').notNullable().defaultTo('informational');
    t.string('title', 255).notNullable();
    t.text('body');
    t.specificType('channel', 'notification_channel').notNullable().defaultTo('in_app');
    t.specificType('priority', 'notification_priority').notNullable().defaultTo('normal');
    t.boolean('read').notNullable().defaultTo(false);
    t.timestamp('read_at');
    t.boolean('dismissed').notNullable().defaultTo(false); // For "dismiss all informational"
    t.string('action_url', 500);
    t.string('action_type', 50); // What UI to show: 'verify_extraction', 'confirm_payment', 'select_contract_type', etc.
    t.string('reference_type', 50);
    t.uuid('reference_id');
    t.timestamps(true, true);
    t.index('user_id');
    t.index(['user_id', 'read']);
    t.index(['user_id', 'category']);
    t.index('type');
  });

  // ── PENDING EXTRACTIONS ───────────────────────────────────
  await knex.schema.createTable('pending_extractions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE'); // Nullable until project matched
    t.string('file_path', 500).notNullable();
    t.string('file_name', 255).notNullable();
    t.specificType('doc_type', 'doc_type').notNullable();
    t.string('inbox_source', 50); // Which inbox it came from: 'timesheets', 'invoices', 'purchase_orders', 'contract_po'
    t.jsonb('extracted_data');
    t.jsonb('confidence_scores');
    t.specificType('status', 'extraction_status').notNullable().defaultTo('processing');
    t.uuid('confirmed_by').references('id').inTable('users').onDelete('SET NULL');
    t.jsonb('confirmed_data');
    t.timestamp('confirmed_at');
    t.text('error_message');
    // Analytics (from Module 3D)
    t.integer('overall_confidence').defaultTo(0);
    t.boolean('auto_confirmed').defaultTo(false);
    t.string('model_used', 100);
    t.integer('processing_time_ms');
    t.jsonb('validation_errors');
    t.string('vendor_name', 255);
    t.timestamps(true, true);
    t.index('project_id');
    t.index('status');
    t.index('inbox_source');
  });

  // ── FILE ACTIVITY LOG ─────────────────────────────────────
  await knex.schema.createTable('file_activity_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('folder_path', 500).notNullable();
    t.string('file_name', 255).notNullable();
    t.string('action', 50).notNullable();
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('reference_type', 50);
    t.uuid('reference_id');
    t.jsonb('metadata');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('reference_type');
    t.index('reference_id');
    t.index('user_id');
    t.index('created_at');
  });

  // ── VENDOR PROFILES (AI learning) ────────────────────────
  await knex.schema.createTable('vendor_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('vendor_name', 255).notNullable();
    t.specificType('doc_type', 'doc_type').notNullable();
    t.jsonb('profile_data').notNullable().defaultTo('{}');
    t.timestamps(true, true);
    t.unique(['vendor_name', 'doc_type']);
    t.index('vendor_name');
  });

  // ── GLOBAL VARIABLES ──────────────────────────────────────
  await knex.schema.createTable('global_variables', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('key', 100).notNullable().unique();
    t.text('value').notNullable();
    t.string('description', 500);
    t.timestamps(true, true);
  });

  // Seed default global variables
  await knex('global_variables').insert([
    { key: 'bid_inactivity_threshold_days', value: '30', description: 'Days of no bid folder activity before archive prompt' },
    { key: 'bid_snooze_duration_days', value: '21', description: 'Days to snooze the bid archive notification' },
    { key: 'dollar_per_mile', value: '0.67', description: 'Mileage reimbursement rate per mile' },
    { key: 'home_location_address', value: '', description: 'Company HQ address for mileage calculations' },
    { key: 'home_location_lat', value: '', description: 'Company HQ latitude' },
    { key: 'home_location_lng', value: '', description: 'Company HQ longitude' },
    { key: 'tracking_week_start_day', value: 'Monday', description: 'Day of the week that starts the timesheet tracking period' },
    { key: 'storage_base_path', value: '', description: 'Root folder for all files (leave blank to use STORAGE_BASE_PATH env var or ./storage)' },
    { key: 'storage_bids_path', value: '', description: 'Custom path for bid folders (leave blank for {base}/bids/)' },
    { key: 'storage_projects_path', value: '', description: 'Custom path for project folders (leave blank for {base}/projects/)' },
    { key: 'storage_templates_path', value: '', description: 'Custom path for templates (leave blank for {base}/templates/)' },
    { key: 'filewatcher_interval_hours', value: '24', description: 'How often the system checks for overdue invoices, stale bids, etc. (hours)' },
    { key: 'filewatcher_run_at_hour', value: '0', description: 'Hour of day (0-23) to run the first check. 0 = midnight.' },
  ]);

  // ── INBOX ACCESS CONTROL ──────────────────────────────────
  await knex.schema.createTable('inbox_access', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('inbox_type', 50).notNullable(); // 'timesheets', 'invoices', 'purchase_orders'
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.specificType('role', 'user_role'); // Alternative: grant by role instead of user
    t.timestamps(true, true);
    t.index('inbox_type');
    t.index('user_id');
  });

  // ── AUDIT LOG ─────────────────────────────────────────────
  await knex.schema.createTable('audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('table_name', 100).notNullable();
    t.uuid('record_id').notNullable();
    t.string('field_changed', 100);
    t.text('old_value');
    t.text('new_value');
    t.string('change_type', 20).notNullable(); // 'create', 'update', 'delete', 'confirm', 'reject'
    t.uuid('changed_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    t.index('table_name');
    t.index('record_id');
    t.index('changed_by');
    t.index('changed_at');
  });

  // ── ROLE CONFIGURATIONS ────────────────────────────────────
  await knex.schema.createTable('role_configurations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('role_name', 50).notNullable().unique();
    t.string('display_name', 100).notNullable();
    t.jsonb('allowed_tabs').notNullable();
    t.jsonb('permissions').notNullable();
    t.string('bid_visibility', 20).notNullable().defaultTo('own');     // own, all, none, assigned
    t.string('project_visibility', 20).notNullable().defaultTo('own'); // own, all, none, assigned
    t.boolean('is_system').notNullable().defaultTo(false);
    t.text('description');
    t.timestamps(true, true);
  });

  // Seed default role configurations
  await knex('role_configurations').insert([
    {
      role_name: 'admin', display_name: 'Admin', is_system: true,
      bid_visibility: 'all', project_visibility: 'all',
      description: 'Full system access. Manages users, configuration, and verifies timesheets.',
      allowed_tabs: JSON.stringify(['dashboard','bids','projects','financials','inbox','timesheets','notifications','equipment','active-projects','oil-samples','field-notes','exports','admin']),
      permissions: JSON.stringify(['*']),
    },
    {
      role_name: 'project_manager', display_name: 'Project Manager', is_system: true,
      bid_visibility: 'own', project_visibility: 'own',
      description: 'Creates bids, manages projects, verifies invoices and POs.',
      allowed_tabs: JSON.stringify(['dashboard','bids','projects','financials','inbox','timesheets','notifications','equipment','active-projects','oil-samples','field-notes','exports']),
      permissions: JSON.stringify(['bids:*','projects:*','extractions:confirm','equipment:request','files:*']),
    },
    {
      role_name: 'accounting', display_name: 'Accounting', is_system: true,
      bid_visibility: 'all', project_visibility: 'all',
      description: 'Read-only project access. CSV exports. Invoice and timesheet tracking.',
      allowed_tabs: JSON.stringify(['dashboard','projects','financials','inbox','timesheets','notifications','active-projects','field-notes','exports']),
      permissions: JSON.stringify(['projects:read','exports:*','timesheets:read']),
    },
    {
      role_name: 'shop_staff', display_name: 'Shop Staff', is_system: true,
      bid_visibility: 'none', project_visibility: 'none',
      description: 'Equipment management, checkout/return, fulfill requests.',
      allowed_tabs: JSON.stringify(['notifications','equipment']),
      permissions: JSON.stringify(['equipment:*','inventory:*']),
    },
    {
      role_name: 'field_staff', display_name: 'Field Staff', is_system: true,
      bid_visibility: 'none', project_visibility: 'assigned',
      description: 'View assigned projects. Upload timesheets.',
      allowed_tabs: JSON.stringify(['projects','inbox','notifications']),
      permissions: JSON.stringify(['projects:read','files:upload']),
    },
  ]);

  // ── BID ASSIGNMENTS (explicit bid access for 'assigned' visibility) ──
  await knex.schema.createTable('bid_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('bid_id').notNullable().references('id').inTable('bids').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamps(true, true);
    t.unique(['bid_id', 'user_id']);
    t.index('user_id');
  });

  // ── USER DEVICES (push notification tokens) ──────────────
  await knex.schema.createTable('user_devices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('device_token', 500).notNullable();
    t.string('platform', 20); // 'ios', 'android', 'web'
    t.string('device_name', 100);
    t.timestamp('last_used_at');
    t.timestamps(true, true);
    t.index('user_id');
    t.unique(['user_id', 'device_token']);
  });
};

exports.down = async function (knex) {
  // Drop in reverse dependency order
  await knex.schema.dropTableIfExists('user_devices');
  await knex.schema.dropTableIfExists('bid_assignments');
  await knex.schema.dropTableIfExists('role_configurations');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('inbox_access');
  await knex.schema.dropTableIfExists('global_variables');
  await knex.schema.dropTableIfExists('vendor_profiles');
  await knex.schema.dropTableIfExists('file_activity_log');
  await knex.schema.dropTableIfExists('pending_extractions');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('equipment_documents');
  await knex.schema.dropTableIfExists('equipment_checkout_log');
  await knex.schema.dropTableIfExists('equipment_request_lines');
  await knex.schema.dropTableIfExists('equipment_requests');
  await knex.schema.dropTableIfExists('equipment');
  await knex.schema.dropTableIfExists('inventory_allocations');
  await knex.schema.dropTableIfExists('inventory');
  await knex.schema.dropTableIfExists('timesheets');
  await knex.schema.dropTableIfExists('contracts');
  await knex.schema.dropTableIfExists('po_line_items');
  await knex.schema.dropTableIfExists('purchase_orders');
  await knex.schema.dropTableIfExists('invoice_line_items');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('project_assignments');
  await knex.schema.dropTableIfExists('project_numbers');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('bid_quote_lines');
  await knex.schema.dropTableIfExists('bids');
  await knex.schema.dropTableIfExists('bid_templates');
  await knex.schema.dropTableIfExists('rate_sheet');
  await knex.schema.dropTableIfExists('locations');
  await knex.schema.dropTableIfExists('customer_contacts');
  await knex.schema.dropTableIfExists('customers');
  await knex.schema.dropTableIfExists('pm_notification_delegates');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');

  await knex.raw(`
    DROP TYPE IF EXISTS equipment_request_status;
    DROP TYPE IF EXISTS equipment_status;
    DROP TYPE IF EXISTS notification_category;
    DROP TYPE IF EXISTS notification_priority;
    DROP TYPE IF EXISTS notification_channel;
    DROP TYPE IF EXISTS doc_type;
    DROP TYPE IF EXISTS extraction_status;
    DROP TYPE IF EXISTS po_status;
    DROP TYPE IF EXISTS invoice_status;
    DROP TYPE IF EXISTS contract_type;
    DROP TYPE IF EXISTS project_status;
    DROP TYPE IF EXISTS bid_status;
    DROP TYPE IF EXISTS user_role;
  `);
};
