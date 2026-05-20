/**
 * Export File Generator — PR #20.
 *
 * Builds the binary attachments scheduled exports deliver. Three formats:
 *   csv  — delegates to ExportService.toCSV (existing behaviour)
 *   xlsx — exceljs workbook; single sheet OR one sheet per section for
 *          fan-out admin consolidation
 *   pdf  — pdf-lib document; single section OR multi-section with a
 *          per-section heading (page break between sections) for admin
 *          consolidation
 *
 * The "section" shape is the unit fan-out consolidation works on:
 *   { name, headers, rows }
 *
 * Per-user (non-consolidated) outputs pass a single section. Admin
 * consolidation passes one section per user.
 */

const fs = require('fs/promises');
const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ExportService = require('./ExportService');

const ExportFileGenerator = {
  /**
   * CSV — single section only. The CSV format has no concept of
   * multi-section, so the caller must collapse sections itself if it
   * wants a single CSV (we just concatenate rows here, no section
   * headers, since the existing schedule path is single-section).
   */
  toCSV(section) {
    return ExportService.toCSV(section.headers, section.rows);
  },

  /**
   * XLSX — one sheet per section. Sheet name = section.name (truncated +
   * sanitised to Excel's 31-char / no-`:*?/\[]` rule). Header row is
   * bold; columns auto-size to widest cell (capped). Returns a Buffer.
   */
  async toXLSX(sections) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ConstructPM';
    wb.created = new Date();

    const usedNames = new Set();
    for (const section of sections) {
      const sheetName = uniqueSheetName(section.name, usedNames);
      const sheet = wb.addWorksheet(sheetName);

      // Header row
      sheet.addRow(section.headers);
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFE7EEF6' },
      };

      // Data rows
      for (const r of section.rows) sheet.addRow(r);

      // Column widths — sample first 200 rows to size, capped at 60
      const widths = section.headers.map((h, i) => {
        let w = String(h || '').length;
        const sampleN = Math.min(section.rows.length, 200);
        for (let j = 0; j < sampleN; j++) {
          const v = section.rows[j]?.[i];
          if (v == null) continue;
          const len = String(v).length;
          if (len > w) w = len;
        }
        return Math.min(Math.max(w + 2, 8), 60);
      });
      sheet.columns = widths.map(width => ({ width }));

      sheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  },

  /**
   * PDF — one logical "page region" per section with a section-name
   * heading at the top. New section forces a new page so the admin
   * consolidation lays out cleanly. Returns a Buffer.
   *
   * Layout is simple monospace tables; pdf-lib has no native table
   * primitive so we draw text at calculated positions. Long values are
   * truncated to the column width; rows that overflow the page break
   * onto a new page (carrying the column header along).
   */
  async toPDF(sections, opts = {}) {
    const title = opts.title || 'ConstructPM Export';

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    const fontBold = await doc.embedFont(StandardFonts.CourierBold);

    const PAGE_W = 792;   // 11" landscape — fits more columns
    const PAGE_H = 612;   // 8.5"
    const MARGIN = 36;    // 0.5"
    const FONT_SIZE = 8;
    const LINE_H = 11;
    const HEADER_SIZE = 12;

    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      let page = doc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      // Section heading
      if (sections.length > 1 || opts.alwaysShowSectionHeading) {
        page.drawText(section.name || `Section ${s + 1}`, {
          x: MARGIN, y: y - HEADER_SIZE,
          size: HEADER_SIZE, font: fontBold,
          color: rgb(0.12, 0.31, 0.47),
        });
        y -= HEADER_SIZE + 6;
      } else {
        page.drawText(title, {
          x: MARGIN, y: y - HEADER_SIZE,
          size: HEADER_SIZE, font: fontBold,
          color: rgb(0.12, 0.31, 0.47),
        });
        y -= HEADER_SIZE + 6;
      }

      // Column widths — split remaining width evenly, cap to char count
      const avail = PAGE_W - 2 * MARGIN;
      const colCount = Math.max(section.headers.length, 1);
      const colW = Math.floor(avail / colCount);
      const charW = font.widthOfTextAtSize('M', FONT_SIZE);
      const maxChars = Math.max(Math.floor(colW / charW) - 1, 4);

      const drawHeaderRow = () => {
        section.headers.forEach((h, i) => {
          page.drawText(truncate(String(h || ''), maxChars), {
            x: MARGIN + i * colW, y,
            size: FONT_SIZE, font: fontBold,
            color: rgb(0, 0, 0),
          });
        });
        y -= LINE_H;
        // separator line
        page.drawLine({
          start: { x: MARGIN, y: y + 4 },
          end: { x: PAGE_W - MARGIN, y: y + 4 },
          thickness: 0.4, color: rgb(0.7, 0.7, 0.7),
        });
        y -= 2;
      };

      drawHeaderRow();

      for (const row of section.rows) {
        if (y < MARGIN + LINE_H) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
          drawHeaderRow();
        }
        row.forEach((cell, i) => {
          const text = truncate(formatCell(cell), maxChars);
          page.drawText(text, {
            x: MARGIN + i * colW, y,
            size: FONT_SIZE, font,
            color: rgb(0, 0, 0),
          });
        });
        y -= LINE_H;
      }

      // Empty-section hint
      if (section.rows.length === 0) {
        page.drawText('(no rows)', {
          x: MARGIN, y,
          size: FONT_SIZE, font,
          color: rgb(0.5, 0.5, 0.5),
        });
      }
    }

    return Buffer.from(await doc.save());
  },

  /**
   * Write a generated buffer to a temp file, returning the path. Helper
   * so the fan-out runner can stream attachments through nodemailer
   * without holding the file in memory longer than needed.
   */
  async writeTemp(buffer, filename) {
    const path = require('path');
    const os = require('os');
    const crypto = require('crypto');
    const tmpPath = path.join(
      os.tmpdir(),
      `${path.parse(filename).name}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(filename) || ''}`,
    );
    await fs.writeFile(tmpPath, buffer);
    return tmpPath;
  },
};

// ─── helpers ──────────────────────────────────────────────────────────

function uniqueSheetName(raw, used) {
  // Excel sheet name rules: 1-31 chars, can't contain : \ / ? * [ ]
  let name = String(raw || 'Sheet')
    .replace(/[\:\\\/\?\*\[\]]/g, '_')
    .slice(0, 28);
  let candidate = name || 'Sheet';
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = name.slice(0, 28 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function truncate(s, maxChars) {
  if (s.length <= maxChars) return s;
  if (maxChars <= 1) return s.slice(0, 1);
  return s.slice(0, maxChars - 1) + '…';
}

function formatCell(v) {
  if (v == null) return '';
  let s;
  if (v instanceof Date) s = v.toISOString().split('T')[0];
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  // Strip control chars (\n, \r, \t, \v, \f and other ASCII < 32) before
  // PDF rendering. pdf-lib's drawText renders newlines literally which
  // collides with our row-position layout (rest of the row spills to the
  // next line, header gets clipped). Replace with single space so the
  // cell still reads correctly when truncated.
  return s.replace(/[\x00-\x1F\x7F]+/g, ' ');
}

module.exports = ExportFileGenerator;
