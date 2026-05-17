/**
 * PdfStampService
 *
 * Adds a semi-transparent identification stamp to the top-right corner of
 * page 1 of a PDF. Used after invoices and POs are uploaded via the inbox
 * to mark the source PDF with the platform's canonical identifier.
 *
 * Why stamp at all:
 *   - The source PDF came from outside the platform (QuickBooks, vendor
 *     portal, scanned paper). Its only identity is whatever was printed
 *     on the original document.
 *   - The platform now has its own canonical number for the record
 *     (INV-M26-1308.1-001 or M26-1308.1-PO-001).
 *   - Stamping the PDF with the platform number means anyone opening
 *     the file from the project folder can immediately match it to
 *     the platform record without cross-referencing.
 *
 * Design choices (per Pat's direction):
 *   - Page 1 only (not every page) — keeps the stamp visible without
 *     cluttering multi-page invoices
 *   - Top-right corner — standard location for filed-document stamps,
 *     least likely to overlap content
 *   - Single line: just the platform number (INV-... or ...-PO-...).
 *     Smaller footprint = less chance of obscuring underlying content.
 *     The platform number alone is enough to match the file to the
 *     platform record; everything else (filed date, original ref, doc
 *     kind) is already in the database record itself.
 *   - Semi-transparent (~18% box fill, ~85% text opacity) — if the
 *     stamp lands over text on the original, the underlying content
 *     remains readable through the stamp
 *   - No unstamped copy retained (per Pat) — only the stamped version
 *     lives in storage
 *
 * What this does NOT do:
 *   - Image-only / raster PDFs: pdf-lib draws on top of them just fine,
 *     but the stamp won't be searchable text in OCR. That's acceptable
 *     for this use case (the stamp is for human readers, not for
 *     re-extraction).
 *   - Encrypted/password-protected PDFs: pdf-lib will throw. We swallow
 *     the error and leave the file unstamped rather than failing the
 *     extraction confirmation. The platform record still has its number;
 *     the source file just lacks the visual stamp.
 *   - Non-PDF files (images, etc.): skipped silently — only PDFs get
 *     stamped.
 */

const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

const PdfStampService = {
  /**
   * Stamp a PDF in place.
   *
   * @param {string} filePath  Absolute path to the PDF file. The file is
   *                           read, modified in memory, and written back
   *                           to the same path.
   * @param {object} stampInfo
   *   @param {string} stampInfo.platformNumber  e.g. "INV-M26-1308.1-001"
   *   @param {string} [stampInfo.docKind]       "INVOICE" / "PURCHASE ORDER" — header
   *   @param {string} [stampInfo.projectName]   Project name for context
   *   @param {string} [stampInfo.externalRef]   Original doc number, if any
   *   @param {string} [stampInfo.filedDate]     ISO date (defaults to today)
   * @returns {Promise<{ stamped: boolean, reason?: string }>}
   *          stamped=true if a stamp was applied; false if skipped (with reason).
   */
  async stampPdf(filePath, stampInfo) {
    // Skip non-PDFs (images, etc.) — they don't go through pdf-lib
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.pdf') {
      return { stamped: false, reason: 'not a PDF' };
    }

    let pdfBytes;
    try {
      pdfBytes = await fs.readFile(filePath);
    } catch (err) {
      return { stamped: false, reason: 'read failed: ' + err.message };
    }

    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
    } catch (err) {
      // Encrypted PDFs and malformed PDFs land here. Don't fail the
      // calling extraction-confirm flow; just leave the file as-is.
      return { stamped: false, reason: 'PDF load failed (encrypted or malformed): ' + err.message };
    }

    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
      return { stamped: false, reason: 'PDF has no pages' };
    }

    // Stamp page 1 only
    const page = pages[0];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // ── Stamp: just the platform number, no box, no decoration ──
    // Top-right corner of page 1, semi-transparent so it stays out
    // of the way if it lands over content. The platform number alone
    // is enough to identify which record this PDF corresponds to;
    // everything else is in the database.
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const text = stampInfo.platformNumber || '';
    const fontSize = 12;
    const textWidth = helvBold.widthOfTextAtSize(text, fontSize);
    const margin = 24; // ~0.33" from page edges
    const textX = pageWidth - textWidth - margin;
    const textY = pageHeight - fontSize - margin;

    page.drawText(text, {
      x: textX,
      y: textY,
      size: fontSize,
      font: helvBold,
      color: rgb(0.12, 0.31, 0.47), // navy
      opacity: 0.55,                 // semi-transparent — readable but not opaque
    });

    // Save and overwrite the original file
    let stampedBytes;
    try {
      stampedBytes = await pdfDoc.save();
    } catch (err) {
      return { stamped: false, reason: 'save failed: ' + err.message };
    }

    try {
      await fs.writeFile(filePath, stampedBytes);
    } catch (err) {
      return { stamped: false, reason: 'write failed: ' + err.message };
    }

    return { stamped: true };
  },
};

module.exports = PdfStampService;
