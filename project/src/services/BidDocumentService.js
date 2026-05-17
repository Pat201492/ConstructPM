/**
 * Bid Document Service
 * 
 * Generates two files per bid:
 *   1. Excel: Markup → Quote Table → Rate Reference → Mileage → Grand Summary
 *   2. Word: PM template .docx with {Field Name} merge fields replaced
 * 
 * Both files are placed in the bid folder.
 */

const ExcelJS = require('exceljs');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fs = require('fs').promises;
const path = require('path');

const BidDocumentService = {
  /**
   * Generate the bid Excel file with all quoting data.
   * Returns the file path where the Excel was saved.
   */
  async generateExcel(bid, quoteLines, globalVars, outputPath) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Construction PM Platform';
    const sheet = workbook.addWorksheet('Bid Quote');

    const dollarFmt = '$#,##0.00';
    const pctFmt = '0.00%';
    let row = 1;

    // ── HEADER ──────────────────────────────────────────────
    sheet.mergeCells(`A${row}:L${row}`);
    sheet.getCell(`A${row}`).value = `Bid ${bid.bid_number} — ${bid.project_scope}`;
    sheet.getCell(`A${row}`).font = { bold: true, size: 14 };
    row += 2;

    // ── MARKUP ──────────────────────────────────────────────
    sheet.getCell(`A${row}`).value = 'Markup %';
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.getCell(`B${row}`).value = (bid.markup_pct || 0) / 100;
    sheet.getCell(`B${row}`).numFmt = pctFmt;
    row += 2;

    // ── SECTION 1: QUOTE TABLE ──────────────────────────────
    sheet.getCell(`A${row}`).value = 'QUOTE TABLE';
    sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;

    const headers = ['Classification', 'Personnel', 'ST Hrs', 'OT Hrs', 'DT Hrs',
      'Total ST Hrs', 'Total OT Hrs', 'Total DT Hrs', 'ST Rate', 'OT Rate', 'DT Rate', 'Total Cost'];
    headers.forEach((h, i) => {
      const col = String.fromCharCode(65 + i);
      sheet.getCell(`${col}${row}`).value = h;
      sheet.getCell(`${col}${row}`).font = { bold: true };
      sheet.getCell(`${col}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    });
    row++;

    let grandLaborCost = 0;
    let totalPersonnel = 0;

    for (const line of quoteLines) {
      sheet.getCell(`A${row}`).value = line.classification;
      sheet.getCell(`B${row}`).value = line.personnel;
      sheet.getCell(`C${row}`).value = parseFloat(line.st_hours);
      sheet.getCell(`D${row}`).value = parseFloat(line.ot_hours);
      sheet.getCell(`E${row}`).value = parseFloat(line.dt_hours);
      sheet.getCell(`F${row}`).value = parseFloat(line.total_st_hours);
      sheet.getCell(`G${row}`).value = parseFloat(line.total_ot_hours);
      sheet.getCell(`H${row}`).value = parseFloat(line.total_dt_hours);
      sheet.getCell(`I${row}`).value = parseFloat(line.st_rate);
      sheet.getCell(`I${row}`).numFmt = dollarFmt;
      sheet.getCell(`J${row}`).value = parseFloat(line.ot_rate);
      sheet.getCell(`J${row}`).numFmt = dollarFmt;
      sheet.getCell(`K${row}`).value = parseFloat(line.dt_rate);
      sheet.getCell(`K${row}`).numFmt = dollarFmt;
      sheet.getCell(`L${row}`).value = parseFloat(line.line_total_cost);
      sheet.getCell(`L${row}`).numFmt = dollarFmt;
      grandLaborCost += parseFloat(line.line_total_cost);
      totalPersonnel += line.personnel;
      row++;
    }

    // Summary line
    sheet.getCell(`K${row}`).value = 'TOTAL';
    sheet.getCell(`K${row}`).font = { bold: true };
    sheet.getCell(`L${row}`).value = grandLaborCost;
    sheet.getCell(`L${row}`).numFmt = dollarFmt;
    sheet.getCell(`L${row}`).font = { bold: true };
    row += 2;

    // ── SECTION 2: RATE REFERENCE TABLE ─────────────────────
    sheet.getCell(`A${row}`).value = 'RATE REFERENCE';
    sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;

    ['Classification', 'ST Rate', 'OT Rate', 'DT Rate'].forEach((h, i) => {
      const col = String.fromCharCode(65 + i);
      sheet.getCell(`${col}${row}`).value = h;
      sheet.getCell(`${col}${row}`).font = { bold: true };
      sheet.getCell(`${col}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    });
    row++;

    for (const line of quoteLines) {
      sheet.getCell(`A${row}`).value = line.classification;
      sheet.getCell(`B${row}`).value = parseFloat(line.st_rate);
      sheet.getCell(`B${row}`).numFmt = dollarFmt;
      sheet.getCell(`C${row}`).value = parseFloat(line.ot_rate);
      sheet.getCell(`C${row}`).numFmt = dollarFmt;
      sheet.getCell(`D${row}`).value = parseFloat(line.dt_rate);
      sheet.getCell(`D${row}`).numFmt = dollarFmt;
      row++;
    }
    row++;

    // ── SECTION 3: MILEAGE ──────────────────────────────────
    const dollarPerMile = globalVars.dollar_per_mile || 0.67;
    const milesOneWay = parseFloat(bid.miles_from_hq) || 0;
    const roundTrip = milesOneWay * 2;
    const projectDays = bid.project_length_days || 0;
    const dailyMiles = roundTrip * totalPersonnel;
    const totalMiles = dailyMiles * projectDays;
    const totalMileageCost = totalMiles * dollarPerMile;

    sheet.getCell(`A${row}`).value = 'MILEAGE CALCULATION';
    sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;

    const mileageData = [
      ['Miles from HQ (one-way)', milesOneWay, 'mi'],
      ['Round Trip', roundTrip, 'mi'],
      ['Total Personnel', totalPersonnel, ''],
      ['Project Length', projectDays, 'days'],
      ['Daily Miles (round trip × personnel)', dailyMiles, 'mi'],
      ['Total Project Miles', totalMiles, 'mi'],
      ['Rate per Mile', dollarPerMile, '$/mi'],
      ['Total Mileage Cost', totalMileageCost, '$'],
    ];

    for (const [label, value, unit] of mileageData) {
      sheet.getCell(`A${row}`).value = label;
      sheet.getCell(`B${row}`).value = value;
      if (unit === '$') sheet.getCell(`B${row}`).numFmt = dollarFmt;
      sheet.getCell(`C${row}`).value = unit;
      row++;
    }
    row++;

    // ── PER DIEM ─────────────────────────────────────────────
    const perDiemRate = parseFloat(bid.per_diem_rate) || 0;
    const totalPerDiem = perDiemRate * totalPersonnel * projectDays;

    if (perDiemRate > 0) {
      sheet.getCell(`A${row}`).value = 'PER DIEM';
      sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;

      const perDiemData = [
        ['Per Diem Rate', perDiemRate, '$/day/worker'],
        ['Total Personnel', totalPersonnel, ''],
        ['Project Length', projectDays, 'days'],
        ['Total Per Diem', totalPerDiem, '$'],
      ];

      for (const [label, value, unit] of perDiemData) {
        sheet.getCell(`A${row}`).value = label;
        sheet.getCell(`B${row}`).value = value;
        if (unit === '$') sheet.getCell(`B${row}`).numFmt = dollarFmt;
        sheet.getCell(`C${row}`).value = unit;
        row++;
      }
      row++;
    }

    // ── GRAND SUMMARY ───────────────────────────────────────
    sheet.getCell(`A${row}`).value = 'GRAND SUMMARY';
    sheet.getCell(`A${row}`).font = { bold: true, size: 12 };
    row++;

    const markupPct = (bid.markup_pct || 0) / 100;
    const subtotal = grandLaborCost + totalMileageCost;
    const markupAmount = subtotal * markupPct;
    const grandTotal = subtotal + markupAmount + totalPerDiem;

    const summaryData = [
      ['Total Labor Cost', grandLaborCost],
      ['Total Mileage Cost', totalMileageCost],
      ['Subtotal (Labor + Mileage)', subtotal],
      [`Markup (${bid.markup_pct || 0}%)`, markupAmount],
    ];
    if (perDiemRate > 0) summaryData.push(['Per Diem (pass-through)', totalPerDiem]);
    summaryData.push(['Bid Amount', grandTotal]);

    for (const [label, value] of summaryData) {
      sheet.getCell(`A${row}`).value = label;
      sheet.getCell(`A${row}`).font = { bold: label === 'Bid Amount' };
      sheet.getCell(`B${row}`).value = value;
      sheet.getCell(`B${row}`).numFmt = dollarFmt;
      sheet.getCell(`B${row}`).font = { bold: label === 'Bid Amount' };
      row++;
    }

    // Auto-width columns
    sheet.columns.forEach(col => { col.width = 16; });
    sheet.getColumn('A').width = 35;

    await workbook.xlsx.writeFile(outputPath);
    return {
      path: outputPath,
      totals: {
        total_labor_cost: grandLaborCost,
        total_mileage_cost: totalMileageCost,
        subtotal,
        markup_amount: markupAmount,
        grand_total: grandTotal,
        total_personnel: totalPersonnel,
      },
    };
  },

  /**
   * Generate the bid Word document from PM's template.
   * Replaces all {Field Name} placeholders with actual bid data.
   * Returns the file path where the Word doc was saved.
   */
  async generateWord(bid, quoteLines, templatePath, outputPath) {
    let templateBuffer;
    try {
      templateBuffer = await fs.readFile(templatePath);
    } catch (err) {
      console.error(`[BidDocService] Template not found: ${templatePath}`);
      return null;
    }

    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{', end: '}' },
      paragraphLoop: true,
      linebreaks: true,
    });

    // Build merge field data — any field in the bid system is available
    const totalManHours = quoteLines.reduce((sum, l) =>
      sum + parseFloat(l.total_st_hours || 0) + parseFloat(l.total_ot_hours || 0) + parseFloat(l.total_dt_hours || 0), 0);

    const perDiemRate = parseFloat(bid.per_diem_rate) || 0;
    const totalPerDiem = parseFloat(bid.total_per_diem) || 0;
    const subtotal = parseFloat(bid.subtotal) || 0;
    const markupAmount = subtotal * ((bid.markup_pct || 0) / 100);
    const bidAmount = subtotal + markupAmount + totalPerDiem;

    const data = {
      // Bid fields
      'Bid Number': bid.bid_number || '',
      'Bid Date': bid.bid_date || new Date().toISOString().split('T')[0],
      'Job Scope': bid.project_scope || '',
      'Bid Amount': this._formatDollar(bidAmount),
      'Total Labor Cost': this._formatDollar(bid.total_labor_cost),
      'Total Mileage Cost': this._formatDollar(bid.total_mileage_cost),
      'Per Diem Rate': perDiemRate > 0 ? this._formatDollar(perDiemRate) + '/day' : 'None',
      'Total Per Diem': this._formatDollar(totalPerDiem),
      'Markup Percent': `${bid.markup_pct || 0}%`,
      'Markup Amount': this._formatDollar(markupAmount),
      'Subtotal': this._formatDollar(subtotal),
      'Grand Total': this._formatDollar(bidAmount),
      'Project Length Days': bid.project_length_days || '',
      'Total Man Hours': totalManHours,
      // Customer fields
      'Customer Name': bid.customer_name || '',
      'Customer Address': bid.customer_address || '',
      // Contact fields
      'Customer Contact Name': bid.contact_name || '',
      'Customer Contact Phone': bid.contact_phone || '',
      'Customer Contact Email': bid.contact_email || '',
      'Customer Contact Company': bid.contact_company || '',
      // Location fields
      'Location Name': bid.location_name || '',
      'Location Address': bid.location_address || '',
      'Local Union': bid.local_union || '',
      'Miles from HQ': bid.miles_from_hq || '',
      // PM fields
      'Project Manager': bid.estimator_name || '',
      'PM Email': bid.estimator_email || '',
    };

    try {
      doc.render(data);
    } catch (err) {
      console.error('[BidDocService] Template render error:', err.message);
      // Try to render what we can — missing fields become empty
      doc.render(data);
    }

    const buffer = doc.getZip().generate({ type: 'nodebuffer' });
    await fs.writeFile(outputPath, buffer);
    return outputPath;
  },

  _formatDollar(value) {
    if (!value) return '$0.00';
    return '$' + parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  /**
   * Generate invoice Word document from template + invoice data.
   * Uses the same {Field Name} merge pattern as bid templates.
   */
  async generateInvoiceDoc(invoiceData, templatePath, outputPath) {
    let templateBuffer;
    try {
      templateBuffer = await fs.readFile(templatePath);
    } catch (err) {
      console.error(`[BidDocService] Invoice template not found: ${templatePath}`);
      return null;
    }

    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: '{', end: '}' },
      paragraphLoop: true,
      linebreaks: true,
    });

    // Build merge data from invoice preview data
    const d = invoiceData;
    const lineItemsText = d.line_items.map((li, i) =>
      `${i + 1}. ${li.description} — ${this._formatDollar(li.total)}`
    ).join('\n');

    const data = {
      // Invoice fields
      'Invoice Number': d.invoice_number || '',
      'Invoice Date': d.invoice_date || '',
      'Period Start': d.period_start || '',
      'Period End': d.period_end || '',
      'Invoice Total': this._formatDollar(d.invoice_total),
      'Labor Subtotal': this._formatDollar(d.labor_subtotal),
      'Markup Percent': `${d.markup_pct || 0}%`,
      'Markup Amount': this._formatDollar(d.markup_amount),
      'Mileage Total': this._formatDollar(d.mileage_total),
      'Timesheet Count': String(d.timesheet_count || 0),
      'Payment Terms': d.payment_terms || '',
      'Line Items': lineItemsText,
      // Project fields
      'Project Name': d.project?.name || '',
      'Project Number': d.invoice_number?.split('-').slice(0, -1).join('-') || '',
      'Project Address': d.project?.address || '',
      'Local Union': d.project?.local_union || '',
      'Contract Value': this._formatDollar(d.project?.contract_value),
      'Contract Type': d.project?.contract_type || '',
      // Customer fields
      'Customer Name': d.customer?.name || '',
      'Billing Street': d.customer?.billing_street || '',
      'Billing Town': d.customer?.billing_town || '',
      'Billing State': d.customer?.billing_state || '',
      'Billing Zip': d.customer?.billing_zip || '',
      'Billing Address': [d.customer?.billing_street, d.customer?.billing_town, d.customer?.billing_state, d.customer?.billing_zip].filter(Boolean).join(', '),
      // Date
      'Today': new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    };

    try {
      doc.render(data);
    } catch (err) {
      console.error('[BidDocService] Invoice template render error:', err.message);
    }

    const buffer = doc.getZip().generate({ type: 'nodebuffer' });
    await fs.writeFile(outputPath, buffer);
    return outputPath;
  },
  /**
   * Generate timesheet Word document — grid format, up to 8 workers per page.
   * Groups by week ending. Shows daily hours, miles, per diem per worker.
   */
  async generateTimesheetDoc(data, templatePath, outputPath) {
    if (templatePath) {
      return this._generateTimesheetFromTemplate(data, templatePath, outputPath);
    }
    return this._generateTimesheetDefault(data, outputPath);
  },

  /**
   * Generate timesheet Excel workbook — primary format, since most contractor
   * timesheets are Excel-based and accounting teams prefer to receive editable
   * spreadsheets they can paste into payroll systems.
   *
   * Workbook structure:
   *   Sheet 1: "Summary" — overview of all workers, all weeks, totals
   *   Sheet 2..N: "<Worker> <Week>" — one detail sheet per worker per week,
   *     formatted like a weekly timesheet form (header, day-by-day grid,
   *     rates, totals, signature area)
   *
   * The Summary sheet uses formulas pointing to detail sheets so edits in
   * the detail sheets automatically update the summary if the accountant
   * tweaks values.
   */
  async generateTimesheetXlsx(data, outputPath) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ConstructPM';
    wb.created = new Date();
    wb.properties.date1904 = false;

    const { workers, project, customer, pm, project_number, period_start, period_end } = data;

    // ── Brand styling tokens ────────────────────────────────────
    const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };  // navy
    const SUBHEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; // light blue
    const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4A6' } };    // pale gold
    const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    const BORDER = { style: 'thin', color: { argb: 'FF999999' } };
    const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

    function styleHeaderRow(row) {
      row.eachCell((c) => {
        c.fill = HEADER_FILL;
        c.font = HEADER_FONT;
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = ALL_BORDERS;
      });
      row.height = 22;
    }

    // ═══════════════════════════════════════════════════════════
    // SHEET 1 — Summary
    // ═══════════════════════════════════════════════════════════
    const summary = wb.addWorksheet('Summary', {
      properties: { defaultColWidth: 14 },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // Project info block
    summary.mergeCells('A1:K1');
    summary.getCell('A1').value = `${project?.name || 'Project'} — Timesheet Summary`;
    summary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1F4E79' } };
    summary.getCell('A1').alignment = { horizontal: 'center' };
    summary.getRow(1).height = 28;

    summary.getCell('A3').value = 'Project Number:';
    summary.getCell('A3').font = { bold: true };
    summary.getCell('B3').value = project_number || '';
    summary.getCell('B3').font = { name: 'Consolas', size: 12, bold: true, color: { argb: 'FF1F4E79' } };

    summary.getCell('A4').value = 'Customer:';
    summary.getCell('A4').font = { bold: true };
    summary.getCell('B4').value = customer?.name || '';

    summary.getCell('A5').value = 'PM:';
    summary.getCell('A5').font = { bold: true };
    summary.getCell('B5').value = pm || '';

    summary.getCell('F3').value = 'Period:';
    summary.getCell('F3').font = { bold: true };
    summary.getCell('G3').value = `${period_start} to ${period_end}`;

    summary.getCell('F4').value = 'Total Workers:';
    summary.getCell('F4').font = { bold: true };
    summary.getCell('G4').value = new Set(workers.map(w => w.worker_name)).size;

    summary.getCell('F5').value = 'Local Union:';
    summary.getCell('F5').font = { bold: true };
    summary.getCell('G5').value = project?.local_union || '';

    // Header row at row 7
    const summaryHeaders = ['Worker', 'Classification', 'Week Ending', 'Days', 'ST Hrs', 'OT Hrs', 'DT Hrs', 'Miles', 'Per Diem', 'Labor', 'Total'];
    summary.getRow(7).values = summaryHeaders;
    styleHeaderRow(summary.getRow(7));

    // Column widths
    summary.getColumn(1).width = 24;
    summary.getColumn(2).width = 16;
    summary.getColumn(3).width = 14;
    summary.getColumn(4).width = 8;
    summary.getColumn(5).width = 9;
    summary.getColumn(6).width = 9;
    summary.getColumn(7).width = 9;
    summary.getColumn(8).width = 9;
    summary.getColumn(9).width = 11;
    summary.getColumn(10).width = 12;
    summary.getColumn(11).width = 12;

    // One row per worker/week. Use formulas pointing to detail sheets so
    // any edits an accountant makes there will flow through to summary.
    let summaryRowIdx = 8;
    const detailSheetTitles = []; // for the totals formulas

    for (const w of workers) {
      const sheetTitle = this._safeSheetTitle(`${w.worker_name} ${w.week_ending}`);
      detailSheetTitles.push(sheetTitle);

      const r = summary.getRow(summaryRowIdx);
      r.getCell(1).value = w.worker_name;
      r.getCell(2).value = w.classification;
      r.getCell(3).value = w.week_ending;
      r.getCell(4).value = w.days_worked || 5;
      // Hours pulled from the detail sheet (so live edits propagate)
      r.getCell(5).value = { formula: `'${sheetTitle}'!H12` };
      r.getCell(6).value = { formula: `'${sheetTitle}'!H13` };
      r.getCell(7).value = { formula: `'${sheetTitle}'!H14` };
      r.getCell(8).value = parseFloat(w.miles_driven) || 0;
      r.getCell(9).value = parseFloat(w.per_diem_total) || 0;
      r.getCell(10).value = { formula: `'${sheetTitle}'!E20` };
      r.getCell(11).value = { formula: `J${summaryRowIdx}+I${summaryRowIdx}+(H${summaryRowIdx}*0.67)` };

      r.getCell(9).numFmt = '"$"#,##0.00';
      r.getCell(10).numFmt = '"$"#,##0.00';
      r.getCell(11).numFmt = '"$"#,##0.00';
      r.eachCell((c) => { c.border = ALL_BORDERS; });

      summaryRowIdx++;
    }

    // Grand total row
    const totalRowIdx = summaryRowIdx + 1;
    const tr = summary.getRow(totalRowIdx);
    tr.getCell(1).value = 'TOTAL';
    tr.getCell(1).font = { bold: true };
    tr.getCell(4).value = { formula: `SUM(D8:D${summaryRowIdx - 1})` };
    tr.getCell(5).value = { formula: `SUM(E8:E${summaryRowIdx - 1})` };
    tr.getCell(6).value = { formula: `SUM(F8:F${summaryRowIdx - 1})` };
    tr.getCell(7).value = { formula: `SUM(G8:G${summaryRowIdx - 1})` };
    tr.getCell(8).value = { formula: `SUM(H8:H${summaryRowIdx - 1})` };
    tr.getCell(9).value = { formula: `SUM(I8:I${summaryRowIdx - 1})` };
    tr.getCell(10).value = { formula: `SUM(J8:J${summaryRowIdx - 1})` };
    tr.getCell(11).value = { formula: `SUM(K8:K${summaryRowIdx - 1})` };
    tr.eachCell((c) => {
      c.fill = TOTAL_FILL;
      c.font = { bold: true };
      c.border = ALL_BORDERS;
    });
    tr.getCell(9).numFmt = '"$"#,##0.00';
    tr.getCell(10).numFmt = '"$"#,##0.00';
    tr.getCell(11).numFmt = '"$"#,##0.00';

    // Freeze the header rows
    summary.views = [{ state: 'frozen', xSplit: 0, ySplit: 7 }];

    // ═══════════════════════════════════════════════════════════
    // SHEETS 2..N — One detail sheet per worker/week
    // ═══════════════════════════════════════════════════════════
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const sheetTitle = detailSheetTitles[i];
      const sheet = wb.addWorksheet(sheetTitle, {
        pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
      });

      // Column widths — date column wider, day columns narrow
      sheet.getColumn(1).width = 14; // Label
      sheet.getColumn(2).width = 8;  // Mon
      sheet.getColumn(3).width = 8;  // Tue
      sheet.getColumn(4).width = 8;  // Wed
      sheet.getColumn(5).width = 8;  // Thu
      sheet.getColumn(6).width = 8;  // Fri
      sheet.getColumn(7).width = 8;  // Sat
      sheet.getColumn(8).width = 12; // Total

      // ── Title ──────────────────────────────────────
      sheet.mergeCells('A1:H1');
      sheet.getCell('A1').value = 'WEEKLY TIMESHEET';
      sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF1F4E79' } };
      sheet.getCell('A1').alignment = { horizontal: 'center' };
      sheet.getRow(1).height = 30;

      // ── Project / worker info block ───────────────
      sheet.getCell('A3').value = 'Project:';      sheet.getCell('A3').font = { bold: true };
      sheet.mergeCells('B3:E3');
      sheet.getCell('B3').value = project?.name || '';

      sheet.getCell('F3').value = 'Project #:';    sheet.getCell('F3').font = { bold: true };
      sheet.mergeCells('G3:H3');
      sheet.getCell('G3').value = project_number || '';
      sheet.getCell('G3').font = { name: 'Consolas', bold: true, color: { argb: 'FF1F4E79' } };

      sheet.getCell('A4').value = 'Customer:';     sheet.getCell('A4').font = { bold: true };
      sheet.mergeCells('B4:E4');
      sheet.getCell('B4').value = customer?.name || '';

      sheet.getCell('F4').value = 'Local:';        sheet.getCell('F4').font = { bold: true };
      sheet.mergeCells('G4:H4');
      sheet.getCell('G4').value = project?.local_union || '';

      sheet.getCell('A5').value = 'Worker:';       sheet.getCell('A5').font = { bold: true };
      sheet.mergeCells('B5:E5');
      sheet.getCell('B5').value = w.worker_name;
      sheet.getCell('B5').font = { bold: true };

      sheet.getCell('F5').value = 'Class:';        sheet.getCell('F5').font = { bold: true };
      sheet.mergeCells('G5:H5');
      sheet.getCell('G5').value = w.classification || '';

      sheet.getCell('A6').value = 'Week Ending:';  sheet.getCell('A6').font = { bold: true };
      sheet.mergeCells('B6:E6');
      sheet.getCell('B6').value = w.week_ending;

      sheet.getCell('F6').value = 'PM:';           sheet.getCell('F6').font = { bold: true };
      sheet.mergeCells('G6:H6');
      sheet.getCell('G6').value = pm || '';

      // Border around info block
      ['A3:H3','A4:H4','A5:H5','A6:H6'].forEach(rng => {
        sheet.getCell(rng.split(':')[0]).border = { top: BORDER, bottom: BORDER };
      });

      // ── Daily grid header ─────────────────────────
      // Pull daily details from JSONB if available; otherwise spread total
      // hours evenly across days_worked.
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayValues = this._buildDailyValues(w);

      sheet.getRow(9).values = ['', ...days, 'Total'];
      styleHeaderRow(sheet.getRow(9));

      // ST / OT / DT / Miles rows (rows 10-13)
      // NOTE: we leave Saturday column writable in case crew works weekends
      const stRow = 10, otRow = 11, dtRow = 12, milesRow = 13;
      const labelStyle = { font: { bold: true }, fill: SUBHEADER_FILL, alignment: { horizontal: 'right', vertical: 'middle' } };

      sheet.getCell(`A${stRow}`).value = 'ST Hours';
      sheet.getCell(`A${otRow}`).value = 'OT Hours';
      sheet.getCell(`A${dtRow}`).value = 'DT Hours';
      sheet.getCell(`A${milesRow}`).value = 'Miles';

      [stRow, otRow, dtRow, milesRow].forEach(r => {
        const cell = sheet.getCell(`A${r}`);
        cell.font = labelStyle.font; cell.fill = labelStyle.fill; cell.alignment = labelStyle.alignment;
        cell.border = ALL_BORDERS;
      });

      // Fill in day values + per-row total formula
      for (let d = 0; d < 6; d++) {
        const col = String.fromCharCode(66 + d); // B..G
        sheet.getCell(`${col}${stRow}`).value = dayValues.st[d] || 0;
        sheet.getCell(`${col}${otRow}`).value = dayValues.ot[d] || 0;
        sheet.getCell(`${col}${dtRow}`).value = dayValues.dt[d] || 0;
        sheet.getCell(`${col}${milesRow}`).value = dayValues.miles[d] || 0;

        // Borders for each day cell
        [stRow, otRow, dtRow, milesRow].forEach(r => {
          const c = sheet.getCell(`${col}${r}`);
          c.border = ALL_BORDERS;
          c.alignment = { horizontal: 'center' };
          if (r === milesRow) c.numFmt = '0';
          else c.numFmt = '0.0';
        });
      }

      // Row totals (column H) — formula-based
      sheet.getCell(`H${stRow}`).value = { formula: `SUM(B${stRow}:G${stRow})` };
      sheet.getCell(`H${otRow}`).value = { formula: `SUM(B${otRow}:G${otRow})` };
      sheet.getCell(`H${dtRow}`).value = { formula: `SUM(B${dtRow}:G${dtRow})` };
      sheet.getCell(`H${milesRow}`).value = { formula: `SUM(B${milesRow}:G${milesRow})` };

      [stRow, otRow, dtRow, milesRow].forEach(r => {
        const cell = sheet.getCell(`H${r}`);
        cell.font = { bold: true };
        cell.fill = SUBHEADER_FILL;
        cell.border = ALL_BORDERS;
        cell.alignment = { horizontal: 'center' };
        if (r === milesRow) cell.numFmt = '0';
        else cell.numFmt = '0.0';
      });

      // ── Rates + line totals ───────────────────────
      // Rows 16-18: ST/OT/DT rate, hours, total
      sheet.mergeCells('A15:E15');
      sheet.getCell('A15').value = 'RATE & PAY CALCULATION';
      sheet.getCell('A15').font = { bold: true, color: { argb: 'FF1F4E79' } };

      sheet.getRow(16).values = ['', 'Rate', 'Hours', 'Subtotal', '', ''];
      styleHeaderRow(sheet.getRow(16));

      const rateLabels = [['ST', w.st_rate, stRow], ['OT', w.ot_rate, otRow], ['DT', w.dt_rate, dtRow]];
      for (let j = 0; j < rateLabels.length; j++) {
        const [label, rate, srcRow] = rateLabels[j];
        const r = 17 + j;
        sheet.getCell(`A${r}`).value = label;
        sheet.getCell(`A${r}`).font = { bold: true };
        sheet.getCell(`A${r}`).fill = SUBHEADER_FILL;
        sheet.getCell(`B${r}`).value = parseFloat(rate) || 0;
        sheet.getCell(`B${r}`).numFmt = '"$"#,##0.00';
        sheet.getCell(`C${r}`).value = { formula: `H${srcRow}` };
        sheet.getCell(`C${r}`).numFmt = '0.0';
        sheet.getCell(`D${r}`).value = { formula: `B${r}*C${r}` };
        sheet.getCell(`D${r}`).numFmt = '"$"#,##0.00';
        ['A','B','C','D'].forEach(col => {
          const c = sheet.getCell(`${col}${r}`);
          c.border = ALL_BORDERS;
          if (col !== 'A') c.alignment = { horizontal: 'center' };
        });
      }

      // Labor subtotal row 20
      sheet.getCell('A20').value = 'LABOR SUBTOTAL';
      sheet.getCell('A20').font = { bold: true };
      sheet.mergeCells('B20:C20');
      sheet.getCell('E20').value = { formula: 'SUM(D17:D19)' };
      sheet.getCell('E20').numFmt = '"$"#,##0.00';
      sheet.getCell('E20').font = { bold: true };
      ['A','B','E'].forEach(col => { sheet.getCell(`${col}20`).fill = TOTAL_FILL; sheet.getCell(`${col}20`).border = ALL_BORDERS; });

      // ── Mileage / per diem block ──────────────────
      sheet.getCell('A22').value = 'Mileage Cost';
      sheet.getCell('A22').font = { bold: true };
      sheet.getCell('B22').value = { formula: `H${milesRow}*0.67` };
      sheet.getCell('B22').numFmt = '"$"#,##0.00';
      sheet.getCell('C22').value = { formula: `"= " & H${milesRow} & " mi × $0.67"` };
      sheet.getCell('C22').font = { italic: true, color: { argb: 'FF666666' } };

      sheet.getCell('A23').value = 'Per Diem';
      sheet.getCell('A23').font = { bold: true };
      sheet.getCell('B23').value = parseFloat(w.per_diem_total) || 0;
      sheet.getCell('B23').numFmt = '"$"#,##0.00';
      if (w.per_diem_rate > 0 && w.days_worked) {
        sheet.getCell('C23').value = `= $${w.per_diem_rate}/day × ${w.days_worked} days`;
        sheet.getCell('C23').font = { italic: true, color: { argb: 'FF666666' } };
      }

      // ── Grand total ───────────────────────────────
      sheet.getCell('A25').value = 'WORKER TOTAL';
      sheet.getCell('A25').font = { bold: true, size: 13 };
      sheet.getCell('B25').value = { formula: 'E20+B22+B23' };
      sheet.getCell('B25').numFmt = '"$"#,##0.00';
      sheet.getCell('B25').font = { bold: true, size: 13, color: { argb: 'FF1F4E79' } };
      ['A','B'].forEach(col => { sheet.getCell(`${col}25`).fill = TOTAL_FILL; sheet.getCell(`${col}25`).border = ALL_BORDERS; });

      // ── Signatures area ───────────────────────────
      sheet.getCell('A28').value = 'Worker Signature:';
      sheet.getCell('A28').font = { bold: true };
      sheet.mergeCells('B28:D28');
      sheet.getCell('B28').border = { bottom: BORDER };

      sheet.getCell('F28').value = 'Date:';
      sheet.getCell('F28').font = { bold: true };
      sheet.mergeCells('G28:H28');
      sheet.getCell('G28').border = { bottom: BORDER };

      sheet.getCell('A30').value = 'Foreman/PM Signature:';
      sheet.getCell('A30').font = { bold: true };
      sheet.mergeCells('B30:D30');
      sheet.getCell('B30').border = { bottom: BORDER };

      sheet.getCell('F30').value = 'Date:';
      sheet.getCell('F30').font = { bold: true };
      sheet.mergeCells('G30:H30');
      sheet.getCell('G30').border = { bottom: BORDER };

      // Print setup
      sheet.pageSetup.margins = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    }

    await wb.xlsx.writeFile(outputPath);
    return outputPath;
  },

  /**
   * Build per-day values for ST/OT/DT/Miles. Uses daily_details JSONB if
   * present (created when foreman submitted line-item entries); otherwise
   * spreads weekly totals across the days that were actually worked.
   */
  _buildDailyValues(worker) {
    const result = { st: [0,0,0,0,0,0], ot: [0,0,0,0,0,0], dt: [0,0,0,0,0,0], miles: [0,0,0,0,0,0] };
    const dayKeys = ['mon','tue','wed','thu','fri','sat'];

    if (worker.daily_details && typeof worker.daily_details === 'object') {
      const dd = typeof worker.daily_details === 'string'
        ? JSON.parse(worker.daily_details)
        : worker.daily_details;
      for (let i = 0; i < 6; i++) {
        const dayData = dd[dayKeys[i]] || {};
        result.st[i] = parseFloat(dayData.st_hours || dayData.st || 0);
        result.ot[i] = parseFloat(dayData.ot_hours || dayData.ot || 0);
        result.dt[i] = parseFloat(dayData.dt_hours || dayData.dt || 0);
        result.miles[i] = parseFloat(dayData.miles || 0);
      }
      return result;
    }

    // Fallback: spread weekly totals across days_worked (default 5: M-F)
    const daysWorked = Math.min(parseInt(worker.days_worked) || 5, 6);
    if (daysWorked === 0) return result;
    const stPerDay = (parseFloat(worker.st_hours) || 0) / daysWorked;
    const otPerDay = (parseFloat(worker.ot_hours) || 0) / daysWorked;
    const dtPerDay = (parseFloat(worker.dt_hours) || 0) / daysWorked;
    const milesPerDay = (parseFloat(worker.miles_driven) || 0) / daysWorked;
    for (let i = 0; i < daysWorked; i++) {
      result.st[i] = stPerDay;
      result.ot[i] = otPerDay;
      result.dt[i] = dtPerDay;
      result.miles[i] = milesPerDay;
    }
    return result;
  },

  /**
   * Excel sheet titles have hard limits: 31 chars, no /\?*[]:
   * Truncate and sanitize the worker+date combo.
   */
  _safeSheetTitle(raw) {
    return String(raw)
      .replace(/[\/\\?*\[\]:]/g, '-')
      .substring(0, 31)
      .trim();
  },

  async _generateTimesheetFromTemplate(data, templatePath, outputPath) {
    let templateBuffer;
    try { templateBuffer = await fs.readFile(templatePath); }
    catch { return null; }

    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, { delimiters: { start: '{', end: '}' }, paragraphLoop: true, linebreaks: true });

    // Build flat merge data with workers array for loop
    const mergeData = {
      'Project Name': data.project?.name || '',
      'Project Number': data.project_number || '',
      'Customer Name': data.customer?.name || '',
      'PM Name': data.pm || '',
      'Period Start': data.period_start || '',
      'Period End': data.period_end || '',
      'Local Union': data.project?.local_union || '',
      'Today': new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      workers: data.workers.map(w => this._buildTimesheetMergeData(w, data)),
    };
    try { doc.render(mergeData); } catch (err) { console.error('[BidDocService] Timesheet template error:', err.message); }

    const buffer = doc.getZip().generate({ type: 'nodebuffer' });
    await fs.writeFile(outputPath, buffer);
    return outputPath;
  },

  async _generateTimesheetDefault(data, outputPath) {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
      PageNumber, PageBreak } = require('docx');

    const { workers, project, customer, pm, period_start, period_end, project_number } = data;
    const WORKERS_PER_PAGE = 8;
    const days = ['Mon','Tue','Wed','Thu','Fri'];

    const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const margins = { top: 30, bottom: 30, left: 40, right: 40 };

    function cell(text, w, opts = {}) {
      return new TableCell({
        borders, width: { size: w, type: WidthType.DXA }, margins,
        shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
        columnSpan: opts.span || 1,
        children: [new Paragraph({
          alignment: opts.align || AlignmentType.CENTER,
          children: [new TextRun({ text: String(text), bold: !!opts.bold, size: opts.size || 15, font: 'Arial', color: opts.color || '333333' })],
        })],
      });
    }

    // Group workers by week_ending
    const byWeek = {};
    workers.forEach(w => {
      const we = w.week_ending || w.work_date || 'Unknown';
      if (!byWeek[we]) byWeek[we] = [];
      byWeek[we].push(w);
    });

    const allChildren = [];
    const weekKeys = Object.keys(byWeek).sort();

    // Column widths:
    // Worker(1500) Class(900) [Mon ST(550) Mon OT(550)] × 5 days = 5500  WeekST(600) WeekOT(600) WeekDT(600) Miles(700) PerDiem(700)
    const W = 13600; // landscape content area
    const cWorker = 1500, cClass = 900, cDay = 550, cTot = 600, cMiles = 700, cPD = 700;
    const allWidths = [cWorker, cClass,
      cDay,cDay, cDay,cDay, cDay,cDay, cDay,cDay, cDay,cDay, // 5 days × 2
      cTot, cTot, cTot, cMiles, cPD];

    const hdrShade = '1F4E79';
    const hdrColor = 'FFFFFF';

    for (let wi = 0; wi < weekKeys.length; wi++) {
      const weekEnd = weekKeys[wi];
      const weekWorkers = byWeek[weekEnd];

      for (let chunk = 0; chunk < weekWorkers.length; chunk += WORKERS_PER_PAGE) {
        const pageWorkers = weekWorkers.slice(chunk, chunk + WORKERS_PER_PAGE);

        if (allChildren.length > 0) {
          allChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }

        // Title
        allChildren.push(new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: 'WEEKLY TIMESHEET', bold: true, size: 24, color: '1F4E79', font: 'Arial' }),
        ] }));

        // Info bar
        const infoW = W;
        allChildren.push(new Table({
          width: { size: infoW, type: WidthType.DXA }, columnWidths: [3400, 3400, 3400, 3400],
          rows: [new TableRow({ children: [
            cell(`Project: ${project?.name || ''}`, 3400, { align: AlignmentType.LEFT, bold: true, shade: 'F0F4F8', size: 14 }),
            cell(`Week Ending: ${weekEnd}`, 3400, { bold: true, shade: 'F0F4F8', size: 14 }),
            cell(`PM: ${pm || ''}`, 3400, { shade: 'F0F4F8', size: 14 }),
            cell(`Local: ${project?.local_union || ''}`, 3400, { shade: 'F0F4F8', size: 14 }),
          ] })],
        }));
        allChildren.push(new Table({
          width: { size: infoW, type: WidthType.DXA }, columnWidths: [3400, 3400, 3400, 3400],
          rows: [new TableRow({ children: [
            cell(`Project #: ${project_number || ''}`, 3400, { align: AlignmentType.LEFT, size: 14 }),
            cell(`Customer: ${customer?.name || ''}`, 3400, { size: 14 }),
            cell(`Period: ${period_start || ''} — ${period_end || ''}`, 3400, { size: 14 }),
            cell(`Workers: ${pageWorkers.length}${chunk > 0 ? ' (cont.)' : ''}`, 3400, { size: 14 }),
          ] })],
        }));

        allChildren.push(new Paragraph({ spacing: { before: 80 }, children: [] }));

        // ── Header row 1: day group labels spanning 2 cols each ──
        const headerRow1 = new TableRow({ children: [
          cell('', cWorker, { shade: hdrShade }),
          cell('', cClass, { shade: hdrShade }),
          ...days.map(d => cell(d, cDay * 2, { bold: true, shade: hdrShade, color: hdrColor, size: 14, span: 2 })),
          cell('Week', cTot, { bold: true, shade: hdrShade, color: hdrColor, size: 13, span: 1 }),
          cell('', cTot, { shade: hdrShade, span: 1 }),
          cell('', cTot, { shade: hdrShade, span: 1 }),
          cell('', cMiles, { shade: hdrShade }),
          cell('', cPD, { shade: hdrShade }),
        ] });

        // ── Header row 2: ST/OT per day + weekly totals ──
        const headerRow2 = new TableRow({ children: [
          cell('Worker', cWorker, { bold: true, shade: '2C5F8A', color: hdrColor, size: 13, align: AlignmentType.LEFT }),
          cell('Class', cClass, { bold: true, shade: '2C5F8A', color: hdrColor, size: 13 }),
          ...days.flatMap(() => [
            cell('ST', cDay, { bold: true, shade: '2C5F8A', color: hdrColor, size: 12 }),
            cell('OT', cDay, { bold: true, shade: '2C5F8A', color: 'FFD966', size: 12 }),
          ]),
          cell('ST', cTot, { bold: true, shade: '2C5F8A', color: hdrColor, size: 13 }),
          cell('OT', cTot, { bold: true, shade: '2C5F8A', color: 'FFD966', size: 13 }),
          cell('DT', cTot, { bold: true, shade: '2C5F8A', color: 'FF8888', size: 13 }),
          cell('Miles', cMiles, { bold: true, shade: '2C5F8A', color: hdrColor, size: 13 }),
          cell('Per Diem', cPD, { bold: true, shade: '2C5F8A', color: hdrColor, size: 13 }),
        ] });

        // ── Worker rows ──
        const workerRows = pageWorkers.map((w, idx) => {
          const shade = idx % 2 === 1 ? 'F5F5F5' : undefined;
          const daily = typeof w.daily_details === 'string' ? JSON.parse(w.daily_details) : (w.daily_details || []);

          const dayCells = days.flatMap(d => {
            const entry = daily.find(e => e.day === d);
            const st = entry ? (entry.hours || 0) : '';
            const ot = entry ? (entry.ot || 0) : '';
            return [
              cell(st || '', cDay, { shade, size: 14 }),
              cell(ot || '', cDay, { shade: ot ? 'FFF8E1' : shade, size: 14, color: ot ? 'B8860B' : '333333' }),
            ];
          });

          const pdTotal = parseFloat(w.per_diem_total || 0);

          return new TableRow({ children: [
            cell(w.worker_name || '', cWorker, { align: AlignmentType.LEFT, shade, size: 14 }),
            cell((w.classification || '').replace('Apprentice ', 'AP ').substring(0, 12), cClass, { shade, size: 13 }),
            ...dayCells,
            cell(parseFloat(w.st_hours || 0).toFixed(0), cTot, { shade, bold: true, size: 14 }),
            cell(parseFloat(w.ot_hours || 0).toFixed(0), cTot, { shade, size: 14, color: parseFloat(w.ot_hours||0) > 0 ? 'B8860B' : '999999' }),
            cell(parseFloat(w.dt_hours || 0).toFixed(0), cTot, { shade, size: 14, color: parseFloat(w.dt_hours||0) > 0 ? 'CC0000' : '999999' }),
            cell(Math.round(parseFloat(w.miles_driven || 0)).toString(), cMiles, { shade, size: 14 }),
            cell(pdTotal > 0 ? '$' + pdTotal.toFixed(0) : '—', cPD, { shade, size: 14 }),
          ] });
        });

        // ── Totals row ──
        const totals = pageWorkers.reduce((a, w) => {
          a.st += parseFloat(w.st_hours || 0);
          a.ot += parseFloat(w.ot_hours || 0);
          a.dt += parseFloat(w.dt_hours || 0);
          a.miles += parseFloat(w.miles_driven || 0);
          a.pd += parseFloat(w.per_diem_total || 0);
          return a;
        }, { st: 0, ot: 0, dt: 0, miles: 0, pd: 0 });

        const totalCells = days.flatMap(() => [
          cell('', cDay, { shade: 'D5E8F0' }),
          cell('', cDay, { shade: 'D5E8F0' }),
        ]);

        const totalRow = new TableRow({ children: [
          cell('TOTALS', cWorker, { bold: true, shade: 'D5E8F0', color: '1F4E79', size: 14, align: AlignmentType.LEFT }),
          cell('', cClass, { shade: 'D5E8F0' }),
          ...totalCells,
          cell(totals.st.toFixed(0), cTot, { shade: 'D5E8F0', bold: true, color: '1F4E79', size: 14 }),
          cell(totals.ot.toFixed(0), cTot, { shade: 'D5E8F0', bold: true, color: 'B8860B', size: 14 }),
          cell(totals.dt.toFixed(0), cTot, { shade: 'D5E8F0', bold: true, color: 'CC0000', size: 14 }),
          cell(Math.round(totals.miles).toString(), cMiles, { shade: 'D5E8F0', bold: true, size: 14 }),
          cell(totals.pd > 0 ? '$' + totals.pd.toFixed(0) : '—', cPD, { shade: 'D5E8F0', bold: true, size: 14 }),
        ] });

        allChildren.push(new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: allWidths,
          rows: [headerRow1, headerRow2, ...workerRows, totalRow],
        }));
      }
    }

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 15 } } } },
      sections: [{
        properties: {
          page: { size: { width: 15840, height: 12240 }, margin: { top: 600, right: 600, bottom: 600, left: 600 } },
        },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
          new TextRun({ text: `${project?.name || ''} — ${period_start || ''} to ${period_end || ''}`, size: 13, color: '888888' }),
        ] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: 'Page ', size: 13, color: '888888' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 13, color: '888888' }),
        ] })] }) },
        children: allChildren,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
    return outputPath;
  },

  /**
   * Build merge data for one worker (used by template rendering).
   */
  _buildTimesheetMergeData(worker, data) {
    const w = worker;
    const laborTotal = (w.st_hours||0)*(w.st_rate||0) + (w.ot_hours||0)*(w.ot_rate||0) + (w.dt_hours||0)*(w.dt_rate||0);
    const totalHours = (parseFloat(w.st_hours)||0) + (parseFloat(w.ot_hours)||0) + (parseFloat(w.dt_hours)||0);

    return {
      // Worker fields
      'Worker Name': w.worker_name || '',
      'Classification': w.classification || '',
      'Local Union': w.local_union || '',
      'Week Ending': w.week_ending || w.work_date || '',
      'Days Worked': String(w.days_worked || 5),
      // Hours
      'ST Hours': parseFloat(w.st_hours || 0).toFixed(1),
      'OT Hours': parseFloat(w.ot_hours || 0).toFixed(1),
      'DT Hours': parseFloat(w.dt_hours || 0).toFixed(1),
      'Total Hours': totalHours.toFixed(1),
      // Rates
      'ST Rate': this._formatDollar(w.st_rate),
      'OT Rate': this._formatDollar(w.ot_rate),
      'DT Rate': this._formatDollar(w.dt_rate),
      // Calculated
      'ST Total': this._formatDollar((w.st_hours||0) * (w.st_rate||0)),
      'OT Total': this._formatDollar((w.ot_hours||0) * (w.ot_rate||0)),
      'DT Total': this._formatDollar((w.dt_hours||0) * (w.dt_rate||0)),
      'Labor Total': this._formatDollar(laborTotal),
      'Miles Driven': parseFloat(w.miles_driven || 0).toFixed(0),
      'Mileage Cost': this._formatDollar(w.mileage_cost),
      'Worker Total': this._formatDollar(laborTotal + parseFloat(w.mileage_cost || 0)),
      // Project fields
      'Project Name': data.project?.name || '',
      'Project Number': data.project_number || '',
      'Project Address': data.project?.address || '',
      'Customer Name': data.customer?.name || '',
      'PM Name': data.pm || '',
      'Period Start': data.period_start || '',
      'Period End': data.period_end || '',
      'Today': new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    };
  },
};

module.exports = BidDocumentService;
