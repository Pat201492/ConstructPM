/**
 * CSV Export Service
 * 
 * Generates CSV exports for QuickBooks, Procore, and custom queries.
 * All queries use the v2 schema (line item tables, ST/OT/DT, etc.)
 */

const db = require('../config/database');

const ExportService = {
  // ── CSV UTILITY ───────────────────────────────────────────

  toCSV(headers, rows) {
    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    return [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
  },

  // ── XLSX UTILITY ─────────────────────────────────────────────
  // Minimal-but-decent Excel builder used by the builder/download
  // route and SavedExportRunner. One sheet, bold + frozen header row,
  // column widths sized to content (capped at 60). Numeric / date-looking
  // strings are typed so Excel sorts + formats them correctly; everything
  // else stays a string.
  //
  // sheetName is sanitized to ExcelJS's 31-char limit with the reserved
  // characters stripped — the workbook throws if violated.
  async toXLSX(headers, rows, sheetName) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ConstructPM';
    wb.created = new Date();
    const cleanName = sanitizeSheetName(sheetName);
    const sheet = wb.addWorksheet(cleanName || 'Export');

    sheet.columns = headers.map((label) => ({
      header: String(label ?? ''),
      key: String(label ?? ''),
      width: 12,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of rows) {
      sheet.addRow(headers.map((_h, i) => coerceCell(row[i])));
    }

    // Auto-fit: walk each column, pick the widest cell content (including
    // header), pad by 2, cap at 60. Cheap O(rows*cols) — fine for the
    // hundreds-to-low-thousands rows the export builder produces.
    sheet.columns.forEach((col, idx) => {
      let max = String(headers[idx] ?? '').length;
      for (const row of rows) {
        const v = row[idx];
        const len = v == null ? 0 : String(v).length;
        if (len > max) max = len;
      }
      col.width = Math.min(60, Math.max(8, max + 2));
    });

    return wb.xlsx.writeBuffer();
  },

  // ── PDF UTILITY ──────────────────────────────────────────────
  // Thin wrapper over ExportFileGenerator.toPDF so the builder /
  // SavedExportRunner pipeline can call `toPDF(headers, rows, source)`
  // with the same shape they call toXLSX / toCSV. The underlying renderer
  // is the same one the fan-out runner uses for per-user-role multi-
  // section reports — one PDF code path in the codebase.
  async toPDF(headers, rows, sourceName) {
    const ExportFileGenerator = require('./ExportFileGenerator');
    return ExportFileGenerator.toPDF(
      [{ name: sourceName || 'Export', headers, rows }],
      { title: sourceName || 'ConstructPM Export' },
    );
  },

  _fmtDate(v) { if (!v) return ''; const d = new Date(v); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; },
  _fmtAmt(v) { return v != null ? parseFloat(v).toFixed(2) : '0.00'; },
  _fmtHrs(v) { return v != null ? parseFloat(v).toFixed(2) : '0.00'; },

  // ── QUICKBOOKS FORMATS ────────────────────────────────────

  async quickbooksInvoices(filters = {}) {
    const query = db('invoices')
      .select('invoices.*', 'projects.name as project_name')
      .join('projects', 'invoices.project_id', 'projects.id')
      .whereNot('invoices.status', 'cancelled')
      .orderBy('invoices.invoice_date', 'desc');

    if (filters.project_id) query.where('invoices.project_id', filters.project_id);
    if (filters.start_date) query.where('invoices.invoice_date', '>=', filters.start_date);
    if (filters.end_date) query.where('invoices.invoice_date', '<=', filters.end_date);

    const rows = await query;
    const headers = ['Customer', 'Date', 'Due Date', 'Ref No', 'Amount', 'Status', 'Project', 'Memo'];
    const data = rows.map(r => [
      r.customer || '', this._fmtDate(r.invoice_date), this._fmtDate(r.payment_due_date),
      r.invoice_number || '', this._fmtAmt(r.amount), r.status, r.project_name, r.notes || '',
    ]);
    return this.toCSV(headers, data);
  },

  async quickbooksTimesheets(filters = {}) {
    const query = db('timesheets')
      .select('timesheets.*', 'projects.name as project_name')
      .join('projects', 'timesheets.project_id', 'projects.id')
      .orderBy('timesheets.work_date', 'desc');

    if (filters.project_id) query.where('timesheets.project_id', filters.project_id);
    if (filters.start_date) query.where('timesheets.work_date', '>=', filters.start_date);
    if (filters.end_date) query.where('timesheets.work_date', '<=', filters.end_date);

    const rows = await query;
    const headers = ['Worker', 'Classification', 'Week Ending', 'Days', 'ST Hours', 'OT Hours', 'DT Hours', 'Miles', 'Mileage Cost', 'Per Diem', 'Project', 'Rate ST', 'Rate OT', 'Rate DT', 'Revenue'];
    const data = rows.map(r => [
      r.worker_name || '', r.classification || '', this._fmtDate(r.week_ending || r.work_date),
      r.days_worked || 5,
      this._fmtHrs(r.st_hours), this._fmtHrs(r.ot_hours), this._fmtHrs(r.dt_hours),
      this._fmtAmt(r.miles_driven), this._fmtAmt(r.mileage_cost), this._fmtAmt(r.per_diem_total),
      r.project_name,
      this._fmtAmt(r.billing_rate_st), this._fmtAmt(r.billing_rate_ot), this._fmtAmt(r.billing_rate_dt),
      this._fmtAmt(r.potential_revenue),
    ]);
    return this.toCSV(headers, data);
  },

  async quickbooksPurchaseOrders(filters = {}) {
    const query = db('purchase_orders')
      .select('purchase_orders.*', 'projects.name as project_name')
      .join('projects', 'purchase_orders.project_id', 'projects.id')
      .whereNot('purchase_orders.status', 'cancelled')
      .orderBy('purchase_orders.order_date', 'desc');

    if (filters.project_id) query.where('purchase_orders.project_id', filters.project_id);
    if (filters.start_date) query.where('purchase_orders.order_date', '>=', filters.start_date);
    if (filters.end_date) query.where('purchase_orders.order_date', '<=', filters.end_date);

    const pos = await query;

    // Batch-fetch all PO line items in one query (avoids N+1)
    const poIds = pos.map(p => p.id);
    const allPoLines = poIds.length > 0
      ? await db('po_line_items').whereIn('po_id', poIds).orderBy('sort_order')
      : [];
    const linesByPo = {};
    for (const l of allPoLines) { if (!linesByPo[l.po_id]) linesByPo[l.po_id] = []; linesByPo[l.po_id].push(l); }

    const headers = ['Vendor', 'PO Number', 'Date', 'Item', 'Qty', 'Unit Price', 'Line Total', 'PO Total', 'Project'];
    const data = [];
    for (const po of pos) {
      const lines = linesByPo[po.id] || [];
      if (lines.length > 0) {
        for (const line of lines) {
          data.push([
            po.vendor || '', po.po_number || '', this._fmtDate(po.order_date),
            line.description || '', line.quantity || '', this._fmtAmt(line.unit_price),
            this._fmtAmt(line.total), this._fmtAmt(po.total), po.project_name,
          ]);
        }
      } else {
        data.push([
          po.vendor || '', po.po_number || '', this._fmtDate(po.order_date),
          '', '', '', '', this._fmtAmt(po.total), po.project_name,
        ]);
      }
    }
    return this.toCSV(headers, data);
  },

  // ── PROCORE FORMATS ───────────────────────────────────────

  async procoreBudget(filters = {}) {
    const query = db('projects')
      .select('projects.*', 'customers.name as customer_name')
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .where('projects.status', 'active');

    const projects = await query;

    // Batch-fetch revenue, PO cost, and timesheet costs per project (avoids N+1)
    const pIds = projects.map(p => p.id);
    const revRows = pIds.length > 0
      ? await db('invoices').whereIn('project_id', pIds).whereNot('status', 'cancelled')
          .select('project_id', db.raw('COALESCE(SUM(amount),0) as total')).groupBy('project_id')
      : [];
    const costRows = pIds.length > 0
      ? await db('purchase_orders').whereIn('project_id', pIds).whereNot('status', 'cancelled')
          .select('project_id', db.raw('COALESCE(SUM(total),0) as total')).groupBy('project_id')
      : [];
    const tsRows = pIds.length > 0
      ? await db('timesheets').whereIn('project_id', pIds)
          .select('project_id',
            db.raw('COALESCE(SUM(mileage_cost),0) as mileage'),
            db.raw('COALESCE(SUM(per_diem_total),0) as per_diem'))
          .groupBy('project_id')
      : [];
    const revMap = {}; for (const r of revRows) revMap[r.project_id] = parseFloat(r.total);
    const costMap = {}; for (const r of costRows) costMap[r.project_id] = parseFloat(r.total);
    const tsMap = {}; for (const r of tsRows) tsMap[r.project_id] = { mileage: parseFloat(r.mileage), per_diem: parseFloat(r.per_diem) };

    const headers = ['Project', 'Customer', 'Contract Value', 'Revenue', 'PO Cost', 'Mileage', 'Per Diem', 'Total Cost', 'Margin', 'Margin %'];
    const data = [];
    for (const p of projects) {
      const revenue = revMap[p.id] || 0;
      const poCost = costMap[p.id] || 0;
      const mileage = tsMap[p.id]?.mileage || 0;
      const perDiem = tsMap[p.id]?.per_diem || 0;
      const totalCost = poCost + mileage + perDiem;
      const margin = revenue - totalCost;
      data.push([
        p.name, p.customer_name || '', this._fmtAmt(p.contract_value),
        this._fmtAmt(revenue), this._fmtAmt(poCost), this._fmtAmt(mileage), this._fmtAmt(perDiem),
        this._fmtAmt(totalCost), this._fmtAmt(margin),
        revenue > 0 ? ((margin / revenue) * 100).toFixed(1) + '%' : '0%',
      ]);
    }
    return this.toCSV(headers, data);
  },

  async procoreInvoices(filters = {}) {
    return this.quickbooksInvoices(filters); // Same data, same format
  },

  async procoreTimecards(filters = {}) {
    return this.quickbooksTimesheets(filters); // Same data
  },

  /**
   * Payroll-focused timesheet export — formatted for sending to a payroll
   * processor or accountant. Two views available via `format`:
   *   - 'detailed' (default): one row per timesheet entry
   *   - 'by_worker': aggregated, one row per worker for the period
   *
   * Returned as CSV. For XLSX, see payrollTimesheetsXlsx below.
   */
  async payrollTimesheetsCSV(filters = {}) {
    const { rows, byWorker } = await this._payrollData(filters);

    if (filters.format === 'by_worker') {
      const headers = ['Worker', 'Classification', 'ST Hours', 'OT Hours', 'DT Hours', 'Total Hours', 'Projects'];
      const data = byWorker.map(w => [
        w.worker_name, w.classification,
        this._fmtNum(w.st_hours), this._fmtNum(w.ot_hours), this._fmtNum(w.dt_hours),
        this._fmtNum(w.st_hours + w.ot_hours + w.dt_hours),
        w.project_count,
      ]);
      return this.toCSV(headers, data);
    }

    const headers = ['Worker', 'Classification', 'Project', 'Project #', 'Week Ending', 'ST', 'OT', 'DT', 'Miles', 'Per Diem'];
    const data = rows.map(r => [
      r.worker_name, r.classification, r.project_name, r.project_number || '',
      r.work_date, this._fmtNum(r.st_hours), this._fmtNum(r.ot_hours), this._fmtNum(r.dt_hours),
      this._fmtNum(r.miles_driven), this._fmtNum(r.per_diem_total),
    ]);
    return this.toCSV(headers, data);
  },

  /**
   * Same data as payrollTimesheetsCSV, but as a properly-formatted XLSX file
   * with totals, by-worker grouping, and a header row. Returns a Buffer.
   */
  async payrollTimesheetsXlsx(filters = {}) {
    const ExcelJS = require('exceljs');
    const { rows, byWorker } = await this._payrollData(filters);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ConstructPM';
    wb.created = new Date();

    // Sheet 1: Detailed entries
    const sheet = wb.addWorksheet('Timesheet Detail');
    sheet.columns = [
      { header: 'Worker', key: 'worker', width: 22 },
      { header: 'Classification', key: 'class', width: 16 },
      { header: 'Project', key: 'project', width: 28 },
      { header: 'Project #', key: 'projnum', width: 14 },
      { header: 'Week Ending', key: 'date', width: 14 },
      { header: 'ST', key: 'st', width: 8 },
      { header: 'OT', key: 'ot', width: 8 },
      { header: 'DT', key: 'dt', width: 8 },
      { header: 'Miles', key: 'miles', width: 8 },
      { header: 'Per Diem', key: 'pd', width: 10 },
    ];
    // Header styling
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 22;

    rows.forEach(r => {
      sheet.addRow({
        worker: r.worker_name,
        class: r.classification,
        project: r.project_name,
        projnum: r.project_number || '',
        date: r.work_date,
        st: parseFloat(r.st_hours) || 0,
        ot: parseFloat(r.ot_hours) || 0,
        dt: parseFloat(r.dt_hours) || 0,
        miles: parseFloat(r.miles_driven) || 0,
        pd: parseFloat(r.per_diem_total) || 0,
      });
    });

    // Totals row
    if (rows.length > 0) {
      const totalRow = rows.length + 2;
      sheet.getCell(`A${totalRow}`).value = 'TOTAL';
      sheet.getCell(`A${totalRow}`).font = { bold: true };
      ['F', 'G', 'H', 'I', 'J'].forEach((col, i) => {
        const cellCol = ['F', 'G', 'H', 'I', 'J'][i];
        sheet.getCell(`${cellCol}${totalRow}`).value = { formula: `SUM(${cellCol}2:${cellCol}${rows.length + 1})` };
        sheet.getCell(`${cellCol}${totalRow}`).font = { bold: true };
      });
      sheet.getCell(`J${totalRow}`).numFmt = '"$"#,##0.00';
    }

    // Sheet 2: By Worker summary (always included, useful for payroll)
    const wsSummary = wb.addWorksheet('By Worker');
    wsSummary.columns = [
      { header: 'Worker', key: 'worker', width: 22 },
      { header: 'Classification', key: 'class', width: 16 },
      { header: 'ST Hours', key: 'st', width: 10 },
      { header: 'OT Hours', key: 'ot', width: 10 },
      { header: 'DT Hours', key: 'dt', width: 10 },
      { header: 'Total Hours', key: 'total', width: 12 },
      { header: 'Projects', key: 'projects', width: 10 },
    ];
    wsSummary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsSummary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    wsSummary.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    wsSummary.getRow(1).height = 22;

    byWorker.forEach(w => {
      wsSummary.addRow({
        worker: w.worker_name,
        class: w.classification,
        st: parseFloat(w.st_hours) || 0,
        ot: parseFloat(w.ot_hours) || 0,
        dt: parseFloat(w.dt_hours) || 0,
        total: (parseFloat(w.st_hours) || 0) + (parseFloat(w.ot_hours) || 0) + (parseFloat(w.dt_hours) || 0),
        projects: w.project_count,
      });
    });

    return wb.xlsx.writeBuffer();
  },

  /**
   * Internal: build the rows + by-worker aggregation given filters.
   * Filters: { project_id, pm_id, start_date, end_date }
   */
  async _payrollData(filters = {}) {
    const query = db('timesheets')
      .select(
        'timesheets.*',
        'projects.name as project_name',
        'projects.pm_id as project_pm_id',
      )
      .join('projects', 'timesheets.project_id', 'projects.id')
      .orderBy('timesheets.work_date', 'desc')
      .orderBy('timesheets.worker_name');

    if (filters.project_id) query.where('timesheets.project_id', filters.project_id);
    if (filters.pm_id) query.where('projects.pm_id', filters.pm_id);
    if (filters.start_date) query.where('timesheets.work_date', '>=', filters.start_date);
    if (filters.end_date) query.where('timesheets.work_date', '<=', filters.end_date);

    const rows = await query;

    // Attach primary project numbers
    if (rows.length > 0) {
      const projectIds = [...new Set(rows.map(r => r.project_id))];
      const numRows = await db('project_numbers')
        .whereIn('project_id', projectIds)
        .where('label', 'Primary')
        .select('project_id', 'number');
      const map = {};
      for (const n of numRows) map[n.project_id] = n.number;
      for (const r of rows) r.project_number = map[r.project_id] || null;
    }

    // Aggregate by worker for the summary tab/CSV
    const byWorkerMap = {};
    for (const r of rows) {
      const key = `${r.worker_name}|${r.classification}`;
      if (!byWorkerMap[key]) {
        byWorkerMap[key] = {
          worker_name: r.worker_name,
          classification: r.classification,
          st_hours: 0, ot_hours: 0, dt_hours: 0,
          projects: new Set(),
        };
      }
      const w = byWorkerMap[key];
      w.st_hours += parseFloat(r.st_hours) || 0;
      w.ot_hours += parseFloat(r.ot_hours) || 0;
      w.dt_hours += parseFloat(r.dt_hours) || 0;
      w.projects.add(r.project_id);
    }
    const byWorker = Object.values(byWorkerMap)
      .map(w => ({ ...w, project_count: w.projects.size }))
      .sort((a, b) => a.worker_name.localeCompare(b.worker_name));

    return { rows, byWorker };
  },

  _fmtNum(v) {
    if (v == null) return '';
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    return n % 1 === 0 ? n.toString() : n.toFixed(2);
  },

  // ── EQUIPMENT EXPORT ──────────────────────────────────────

  async equipmentExport(filters = {}) {
    const query = db('equipment')
      .select('equipment.*', 'projects.name as current_project_name')
      .leftJoin('projects', 'equipment.current_project_id', 'projects.id')
      .orderBy('equipment.equipment_name');

    if (filters.status) query.where('equipment.status', filters.status);
    if (filters.equipment_type) query.where('equipment.equipment_type', filters.equipment_type);

    const items = await query;
    const headers = ['Barcode', 'Name', 'Manufacturer', 'Type', 'Status', 'Location/Project', 'Cert Date'];
    const data = items.map(e => [
      e.barcode_id, e.equipment_name, e.manufacturer || '', e.equipment_type || '',
      e.status,
      e.current_project_name || e.current_location || 'shop',
      e.certification_date || '',
    ]);
    return this.toCSV(headers, data);
  },

};

// Coerce a value into the type Excel renders best. Numeric strings stay
// numeric; ISO-date / yyyy-mm-dd strings become Date so Excel sorts +
// formats them. Everything else passes through unchanged.
function coerceCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    // Trimmed numeric — non-empty, valid Number(), no leading zeros that
    // would imply an ID (project numbers, barcodes). The leading-zero
    // guard prevents turning "001234" into the number 1234.
    if (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) {
      const n = Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n)) return n;
    }
    // ISO date (yyyy-mm-dd) or ISO datetime — Excel handles either when
    // typed as Date. Avoid Date() parse for ambiguous strings to dodge
    // the "Trenton, NJ" → Invalid Date branch quietly returning NaN.
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return v;
}

// ExcelJS rejects \ / ? * [ ] : and caps sheet names at 31 chars.
function sanitizeSheetName(name) {
  if (!name) return '';
  return String(name).replace(/[\\\/?*\[\]:]/g, '_').slice(0, 31);
}

module.exports = ExportService;
