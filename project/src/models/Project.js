/**
 * Project Model (v2)
 * 
 * Financial queries: revenue from invoices, cost from POs + equipment + mileage,
 * margin calculation, WCI (invoice to payment days).
 * Close-out: auto-notification when revenue >= contract_value.
 */

const db = require('../config/database');

const Project = {
  async findAll({ year, pm_id, customer_id, status, search, bid_ids, limit = 50, offset = 0 } = {}) {
    // Subquery: SPNs (Supplement Project Numbers — non-Primary labels in
    // project_numbers). Aggregated as a comma-separated string per project
    // so we can surface them in one column on the list. Empty string when
    // a project has no SPNs (most projects). Per docs/TERMINOLOGY.md a
    // project has zero or more SPNs; the Primary lives elsewhere.
    const spnsSub = db('project_numbers')
      .select('project_id', db.raw("string_agg(number, ', ' ORDER BY label) as spns"))
      .where('label', '!=', 'Primary')
      .groupBy('project_id')
      .as('spn_agg');

    // Primary project number — needed by anywhere the SPA wants to show
    // a project as "M26-1308.1" instead of the long descriptive name.
    // Pat's rule: equipment-ticket pickers, scheduler tags, etc. should
    // always lean on the primary number first.
    const primarySub = db('project_numbers')
      .select('project_id', 'number as primary_number')
      .where('label', 'Primary')
      .as('primary_pn');

    // Aggregated counts/dates per project — single roundtrip via subqueries.
    // These power the "advanced" hidden-by-default columns on the projects
    // list (Last Invoice Date, Open POs, Equipment Out, Margin %).
    const lastInvSub = db('invoices')
      .select('project_id', db.raw('MAX(invoice_date) as last_invoice_date'))
      .whereNotIn('status', ['cancelled'])
      .groupBy('project_id')
      .as('last_inv');

    const openPosSub = db('purchase_orders')
      .select('project_id', db.raw('COUNT(*) as open_pos_count'))
      .whereNotIn('status', ['cancelled', 'received'])
      .groupBy('project_id')
      .as('open_pos');

    const equipOutSub = db('equipment')
      .select('current_project_id as project_id', db.raw('COUNT(*) as equipment_out_count'))
      .where('status', 'checked_out')
      .whereNotNull('current_project_id')
      .groupBy('current_project_id')
      .as('equip_out');

    // Revenue + cost rollup for margin %. Cancelled excluded for both sides.
    const revSub = db('invoices')
      .select('project_id', db.raw('SUM(amount) as revenue'))
      .whereNotIn('status', ['cancelled'])
      .groupBy('project_id')
      .as('rev');

    const poCostSub = db('purchase_orders')
      .select('project_id', db.raw('SUM(total) as po_cost'))
      .whereNotIn('status', ['cancelled'])
      .groupBy('project_id')
      .as('po_cost');

    const query = db('projects')
      .select(
        'projects.*',
        'customers.name as customer_name',
        'locations.name as location_name',
        'locations.display_address as location_address',
        'bids.bid_number as won_from_bid_number',
        'spn_agg.spns as spns',
        'primary_pn.primary_number',
        'last_inv.last_invoice_date',
        'open_pos.open_pos_count',
        'equip_out.equipment_out_count',
        'rev.revenue',
        'po_cost.po_cost',
        db.raw("users.first_name || ' ' || users.last_name as pm_name")
      )
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .leftJoin('locations', 'projects.location_id', 'locations.id')
      .leftJoin('users', 'projects.pm_id', 'users.id')
      .leftJoin('bids', 'projects.bid_id', 'bids.id')
      .leftJoin(spnsSub, 'projects.id', 'spn_agg.project_id')
      .leftJoin(primarySub, 'projects.id', 'primary_pn.project_id')
      .leftJoin(lastInvSub, 'projects.id', 'last_inv.project_id')
      .leftJoin(openPosSub, 'projects.id', 'open_pos.project_id')
      .leftJoin(equipOutSub, 'projects.id', 'equip_out.project_id')
      .leftJoin(revSub, 'projects.id', 'rev.project_id')
      .leftJoin(poCostSub, 'projects.id', 'po_cost.project_id')
      .orderBy('projects.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (year) query.where('projects.year', year);
    if (pm_id) query.where('projects.pm_id', pm_id);
    if (customer_id) query.where('projects.customer_id', customer_id);
    if (status) query.where('projects.status', status);
    if (Array.isArray(bid_ids)) {
      if (bid_ids.length === 0) return { projects: [], total: 0 };
      query.whereIn('projects.bid_id', bid_ids);
    }
    if (search) query.where(function () {
      this.where('projects.name', 'ilike', `%${search}%`)
        .orWhere('customers.name', 'ilike', `%${search}%`);
    });

    const projects = await query;
    const [{ count }] = await db('projects').count('* as count');
    return { projects, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('projects')
      .select('projects.*', 'customers.name as customer_name',
        db.raw("users.first_name || ' ' || users.last_name as pm_name"))
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .leftJoin('users', 'projects.pm_id', 'users.id')
      .where('projects.id', id)
      .first();
  },

  async getFinancials(id) {
    const project = await this.findById(id);
    if (!project) return null;

    // Revenue = sum of confirmed invoice amounts
    const [invoiceStats] = await db('invoices')
      .where({ project_id: id })
      .whereNot('status', 'cancelled')
      .select(
        db.raw('COALESCE(SUM(amount), 0) as total_revenue'),
        db.raw('COUNT(*) as invoice_count'),
        db.raw("COUNT(*) FILTER (WHERE status = 'paid' OR status = 'partial_paid') as paid_count"),
      );

    // Cost = sum of confirmed PO totals
    const [poStats] = await db('purchase_orders')
      .where({ project_id: id })
      .whereNot('status', 'cancelled')
      .select(
        db.raw('COALESCE(SUM(total), 0) as total_po_cost'),
        db.raw('COUNT(*) as po_count'),
      );

    // Labor hours from timesheets
    const [laborStats] = await db('timesheets')
      .where({ project_id: id })
      .select(
        db.raw('COALESCE(SUM(st_hours), 0) as total_st_hours'),
        db.raw('COALESCE(SUM(ot_hours), 0) as total_ot_hours'),
        db.raw('COALESCE(SUM(dt_hours), 0) as total_dt_hours'),
        db.raw('COALESCE(SUM(potential_revenue), 0) as total_labor_revenue'),
        db.raw('COALESCE(SUM(mileage_cost), 0) as total_mileage_cost'),
        db.raw('COALESCE(SUM(per_diem_total), 0) as total_per_diem'),
        db.raw('COUNT(*) as timesheet_count'),
      );

    // Equipment cost = sum(days checked out × daily rate) for this project
    const [equipCost] = await db('equipment_checkout_log')
      .join('equipment', 'equipment_checkout_log.equipment_id', 'equipment.id')
      .where('equipment_checkout_log.project_id', id)
      .select(
        db.raw(`COALESCE(SUM(
          equipment.equipment_cost * 
          GREATEST(1, EXTRACT(DAY FROM (COALESCE(equipment_checkout_log.returned_at, NOW()) - equipment_checkout_log.checked_out_at)))
        ), 0) as total_equipment_cost`),
      );

    // Payment overdue count
    const [overdueStats] = await db('invoices')
      .where({ project_id: id })
      .whereNotIn('status', ['paid', 'cancelled'])
      .whereNotNull('payment_due_date')
      .where('payment_due_date', '<', new Date().toISOString().split('T')[0])
      .select(db.raw('COUNT(*) as overdue_count'));

    // Calculate totals
    const totalRevenue = parseFloat(invoiceStats.total_revenue);
    const totalPerDiem = parseFloat(laborStats.total_per_diem);
    const totalCost = parseFloat(poStats.total_po_cost) + parseFloat(equipCost.total_equipment_cost) + parseFloat(laborStats.total_mileage_cost) + totalPerDiem;
    const contractValue = parseFloat(project.contract_value) || 0;
    const marginDollars = totalRevenue - totalCost;
    const marginPercent = totalRevenue > 0 ? (marginDollars / totalRevenue) * 100 : 0;

    // WCI = average days from invoice date to payment received
    const wciResult = await db('invoices')
      .where({ project_id: id, status: 'paid' })
      .whereNotNull('payment_received_date')
      .whereNotNull('invoice_date')
      .select(db.raw("AVG(payment_received_date - invoice_date) as avg_days"));
    const wci = wciResult[0]?.avg_days ? Math.round(parseFloat(wciResult[0].avg_days)) : null;

    return {
      contract_value: contractValue,
      total_revenue: totalRevenue,
      total_cost: totalCost,
      total_po_cost: parseFloat(poStats.total_po_cost),
      total_equipment_cost: parseFloat(equipCost.total_equipment_cost),
      total_mileage_cost: parseFloat(laborStats.total_mileage_cost),
      total_per_diem: totalPerDiem,
      total_labor_revenue: parseFloat(laborStats.total_labor_revenue),
      margin_dollars: marginDollars,
      margin_percent: Math.round(marginPercent * 100) / 100,
      wci,
      total_st_hours: parseFloat(laborStats.total_st_hours),
      total_ot_hours: parseFloat(laborStats.total_ot_hours),
      total_dt_hours: parseFloat(laborStats.total_dt_hours),
      invoice_count: parseInt(invoiceStats.invoice_count),
      paid_invoice_count: parseInt(invoiceStats.paid_count),
      po_count: parseInt(poStats.po_count),
      timesheet_count: parseInt(laborStats.timesheet_count),
      overdue_invoice_count: parseInt(overdueStats.overdue_count),
      revenue_vs_contract: contractValue > 0 ? Math.round((totalRevenue / contractValue) * 100) : 0,
    };
  },

  async getAssignments(projectId) {
    return db('project_assignments')
      .select('project_assignments.*',
        db.raw("users.first_name || ' ' || users.last_name as user_name"),
        'users.email', 'users.role')
      .join('users', 'project_assignments.user_id', 'users.id')
      .where('project_assignments.project_id', projectId);
  },

  async addAssignment(projectId, userId, roleOnProject) {
    const [assignment] = await db('project_assignments')
      .insert({ project_id: projectId, user_id: userId, role_on_project: roleOnProject })
      .returning('*');
    return assignment;
  },

  async removeAssignment(projectId, userId) {
    return db('project_assignments')
      .where({ project_id: projectId, user_id: userId })
      .delete();
  },

  async isAssigned(projectId, userId) {
    const row = await db('project_assignments')
      .where({ project_id: projectId, user_id: userId }).first();
    return !!row;
  },

  async create(data) {
    const [project] = await db('projects').insert(data).returning('*');
    return project;
  },

  async update(id, data) {
    const [project] = await db('projects')
      .where({ id })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return project;
  },
};

module.exports = Project;
