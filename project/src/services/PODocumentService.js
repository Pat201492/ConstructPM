const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;

/**
 * Purchase Order Excel generator.
 *
 * Produces an Excel file with formulas, NOT static values. The customer
 * specifically wanted Excel so that:
 *   - Line item totals are =qty*unit_price (recalculate as edits happen)
 *   - Subtotal is =SUM(line totals)
 *   - Tax row is editable (default $0); Total = Subtotal + Tax + Shipping
 *   - Shipping is editable
 *
 * This means the PO can be opened, adjusted (e.g., vendor confirms a different
 * shipping cost), and the bottom-line total stays correct.
 *
 * Layout:
 *   Row 1:    Title — "PURCHASE ORDER"
 *   Row 2:    PO Number, Date issued
 *   Rows 4-7: From / To address blocks (your firm, vendor)
 *   Rows 8-9: Project info, expected delivery, payment terms
 *   Row 11:   Header row (Description, Qty, Unit, Unit Price, Total)
 *   Rows 12+: Line items
 *   Footer:   Subtotal, Tax (editable), Shipping (editable), Grand Total
 *   Row N+1:  Notes / terms
 */

const PODocumentService = {
  /**
   * Generate the PO Excel.
   * @param {object} po              — purchase_orders row
   * @param {array}  lineItems       — array of { description, quantity, unit, unit_price }
   * @param {object} vendor          — vendor record (or null if free-text)
   * @param {object} project         — projects row
   * @param {object} company         — { name, street, town, state, zip, phone, email } from globals
   * @param {string} outputPath      — absolute path on disk
   */
  async generate({ po, lineItems, vendor, project, company, outputPath }) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ConstructPM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Purchase Order', {
      properties: { tabColor: { argb: 'FFC55A11' } },
      pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    });

    // Column widths
    sheet.columns = [
      { width: 38 }, // A — Description
      { width: 10 }, // B — Qty
      { width: 10 }, // C — Unit
      { width: 14 }, // D — Unit Price
      { width: 14 }, // E — Total
    ];

    // ── TITLE ROW ─────────────────────────────────────────
    sheet.mergeCells('A1:E1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'PURCHASE ORDER';
    titleCell.font = { name: 'Arial', size: 22, bold: true, color: { argb: 'FF1F4E79' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    // ── PO META ──────────────────────────────────────────
    sheet.getCell('A2').value = 'PO Number:';
    sheet.getCell('A2').font = { bold: true };
    sheet.getCell('B2').value = po.po_number || '';

    sheet.getCell('D2').value = 'Date Issued:';
    sheet.getCell('D2').font = { bold: true };
    sheet.getCell('E2').value = po.order_date ? new Date(po.order_date) : new Date();
    sheet.getCell('E2').numFmt = 'mm/dd/yyyy';

    // ── FROM / TO BLOCK ──────────────────────────────────
    sheet.getCell('A4').value = 'FROM:';
    sheet.getCell('A4').font = { bold: true, color: { argb: 'FF595959' } };
    sheet.getCell('A5').value = company?.name || 'Your Company';
    sheet.getCell('A6').value = company?.street || '';
    sheet.getCell('A7').value = `${company?.town || ''}${company?.state ? ', ' + company.state : ''} ${company?.zip || ''}`.trim();

    sheet.getCell('D4').value = 'TO:';
    sheet.getCell('D4').font = { bold: true, color: { argb: 'FF595959' } };
    if (vendor) {
      sheet.getCell('D5').value = vendor.name || '';
      sheet.getCell('D6').value = vendor.street || '';
      sheet.getCell('D7').value = `${vendor.town || ''}${vendor.state ? ', ' + vendor.state : ''} ${vendor.zip || ''}`.trim();
    } else {
      sheet.getCell('D5').value = po.vendor || '';
    }

    // ── PROJECT / DELIVERY INFO ──────────────────────────
    sheet.getCell('A9').value = 'Project:';
    sheet.getCell('A9').font = { bold: true };
    sheet.getCell('B9').value = project?.name || '';

    sheet.getCell('D9').value = 'Expected Delivery:';
    sheet.getCell('D9').font = { bold: true };
    sheet.getCell('E9').value = po.delivery_date ? new Date(po.delivery_date) : '';
    sheet.getCell('E9').numFmt = 'mm/dd/yyyy';

    // ── HEADER ROW ───────────────────────────────────────
    const headerRow = 11;
    const headers = ['Description', 'Qty', 'Unit', 'Unit Price', 'Total'];
    headers.forEach((h, i) => {
      const cell = sheet.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle' };
      cell.border = { top: thin(), bottom: thin(), left: thin(), right: thin() };
    });

    // ── LINE ITEMS ───────────────────────────────────────
    const firstLineRow = headerRow + 1;
    let row = firstLineRow;
    for (const item of lineItems) {
      sheet.getCell(`A${row}`).value = item.description || '';
      sheet.getCell(`B${row}`).value = parseFloat(item.quantity) || 0;
      sheet.getCell(`B${row}`).numFmt = '0.##';
      sheet.getCell(`B${row}`).alignment = { horizontal: 'center' };
      sheet.getCell(`C${row}`).value = item.unit || 'ea';
      sheet.getCell(`C${row}`).alignment = { horizontal: 'center' };
      sheet.getCell(`D${row}`).value = parseFloat(item.unit_price) || 0;
      sheet.getCell(`D${row}`).numFmt = '"$"#,##0.00';
      // FORMULA — total is qty * unit_price, recalculates when edited
      sheet.getCell(`E${row}`).value = { formula: `B${row}*D${row}` };
      sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';

      // Borders on all cells in row
      ['A', 'B', 'C', 'D', 'E'].forEach(col => {
        sheet.getCell(`${col}${row}`).border = {
          top: thin(), bottom: thin(), left: thin(), right: thin()
        };
      });
      row++;
    }

    // Pad with 5 empty rows (so user can add more line items in Excel later
    // and the totals formula still picks them up)
    const padRows = 5;
    for (let i = 0; i < padRows; i++) {
      sheet.getCell(`E${row}`).value = { formula: `IF(AND(B${row}<>"",D${row}<>""),B${row}*D${row},"")` };
      sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';
      ['A', 'B', 'C', 'D', 'E'].forEach(col => {
        sheet.getCell(`${col}${row}`).border = {
          top: thin(), bottom: thin(), left: thin(), right: thin()
        };
      });
      row++;
    }
    const lastLineRow = row - 1;

    // ── TOTALS BLOCK ─────────────────────────────────────
    row += 1; // blank row

    // Subtotal
    sheet.getCell(`D${row}`).value = 'Subtotal:';
    sheet.getCell(`D${row}`).font = { bold: true };
    sheet.getCell(`D${row}`).alignment = { horizontal: 'right' };
    sheet.getCell(`E${row}`).value = { formula: `SUM(E${firstLineRow}:E${lastLineRow})` };
    sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';
    const subtotalRow = row;
    row++;

    // Tax (editable, defaults to po.tax_amount)
    sheet.getCell(`D${row}`).value = 'Tax:';
    sheet.getCell(`D${row}`).font = { bold: true };
    sheet.getCell(`D${row}`).alignment = { horizontal: 'right' };
    sheet.getCell(`E${row}`).value = parseFloat(po.tax_amount) || 0;
    sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';
    sheet.getCell(`E${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; // light yellow = editable
    const taxRow = row;
    row++;

    // Shipping (editable)
    sheet.getCell(`D${row}`).value = 'Shipping:';
    sheet.getCell(`D${row}`).font = { bold: true };
    sheet.getCell(`D${row}`).alignment = { horizontal: 'right' };
    sheet.getCell(`E${row}`).value = parseFloat(po.shipping_amount) || 0;
    sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';
    sheet.getCell(`E${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const shippingRow = row;
    row++;

    // Grand Total
    sheet.getCell(`D${row}`).value = 'TOTAL:';
    sheet.getCell(`D${row}`).font = { bold: true, size: 12 };
    sheet.getCell(`D${row}`).alignment = { horizontal: 'right' };
    sheet.getCell(`E${row}`).value = { formula: `E${subtotalRow}+E${taxRow}+E${shippingRow}` };
    sheet.getCell(`E${row}`).numFmt = '"$"#,##0.00';
    sheet.getCell(`E${row}`).font = { bold: true, size: 12 };
    sheet.getCell(`E${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    sheet.getCell(`E${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`D${row}`).border = { top: thick() };
    sheet.getCell(`E${row}`).border = { top: thick(), bottom: thick(), left: thin(), right: thin() };
    row += 2;

    // ── NOTES ────────────────────────────────────────────
    if (po.notes) {
      sheet.getCell(`A${row}`).value = 'Notes:';
      sheet.getCell(`A${row}`).font = { bold: true };
      row++;
      sheet.mergeCells(`A${row}:E${row + 2}`);
      sheet.getCell(`A${row}`).value = po.notes;
      sheet.getCell(`A${row}`).alignment = { wrapText: true, vertical: 'top' };
      sheet.getCell(`A${row}`).border = { top: thin(), bottom: thin(), left: thin(), right: thin() };
    }

    // Make sure output dir exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
  },
};

function thin() { return { style: 'thin', color: { argb: 'FFBFBFBF' } }; }
function thick() { return { style: 'medium', color: { argb: 'FF1F4E79' } }; }

module.exports = PODocumentService;
