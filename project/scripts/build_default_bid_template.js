/**
 * Generate templates/defaults/bid_template_default.docx.
 *
 * Run once when the template needs a refresh:
 *   node scripts/build_default_bid_template.js
 *
 * Output is a clean professional quote letter with every {Field Name}
 * placeholder that BidDocumentService.generateWord() supports. Layout
 * is intentionally minimal — PMs typically rebrand on top via Word.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} = require('docx');

const accent = '1F2937';
const muted = '64748B';

// docxtemplater treats {x} as a placeholder. To render a literal `{`
// we use a single TextRun per token so docxtemplater can find them
// intact (Word would normally split runs by formatting).
const mf = (name) => new TextRun({ text: `{${name}}`, color: accent });

const labelRun = (text) => new TextRun({ text, bold: true, color: muted });
const plainRun = (text) => new TextRun({ text });

const labelValueRow = (label, mergeFieldName) => new TableRow({
  children: [
    new TableCell({
      width: { size: 30, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [labelRun(label)] })],
    }),
    new TableCell({
      width: { size: 70, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [mf(mergeFieldName)] })],
    }),
  ],
});

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const heading = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 320, after: 120 },
  children: [new TextRun({ text, bold: true, color: accent, size: 26 })],
});

const blank = () => new Paragraph({ children: [new TextRun('')] });

const doc = new Document({
  creator: 'ConstructPM',
  title: 'Bid Quote',
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22 },
      },
    },
  },
  sections: [{
    properties: {
      page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } },
    },
    children: [
      // ── Header ─────────────────────────────────────────────
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'QUOTE', bold: true, size: 56, color: accent })],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          labelRun('Bid #: '), mf('Bid Number'),
          new TextRun({ text: '\t\t' }),
          labelRun('Date: '), mf('Bid Date'),
        ],
      }),
      blank(),

      // ── To / From block ────────────────────────────────────
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ children: [labelRun('TO')] }),
                  new Paragraph({ children: [mf('Customer Name')] }),
                  new Paragraph({ children: [mf('Customer Contact Name')] }),
                  new Paragraph({ children: [mf('Customer Contact Phone')] }),
                  new Paragraph({ children: [mf('Customer Contact Email')] }),
                ],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ children: [labelRun('PROJECT')] }),
                  new Paragraph({ children: [mf('Location Name')] }),
                  new Paragraph({ children: [mf('Location Address')] }),
                  new Paragraph({ children: [labelRun('Union: '), mf('Local Union')] }),
                ],
              }),
            ],
          }),
        ],
      }),
      blank(),

      // ── Scope ──────────────────────────────────────────────
      heading('Scope of Work'),
      new Paragraph({ children: [mf('Job Scope')] }),

      // ── Pricing ────────────────────────────────────────────
      heading('Pricing'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          labelValueRow('Total Labor', 'Total Labor Cost'),
          labelValueRow('Total Mileage', 'Total Mileage Cost'),
          labelValueRow('Per Diem', 'Total Per Diem'),
          labelValueRow('Subtotal', 'Subtotal'),
          labelValueRow('Markup', 'Markup Amount'),
          new TableRow({
            children: [
              new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: 'BID TOTAL', bold: true, color: accent, size: 26 })] })],
              }),
              new TableCell({
                width: { size: 70, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: '', bold: true, size: 26 }), new TextRun({ text: '{Grand Total}', bold: true, color: accent, size: 26 })] })],
              }),
            ],
          }),
        ],
      }),

      // ── Schedule + assumptions ─────────────────────────────
      heading('Schedule'),
      new Paragraph({ children: [labelRun('Project length (days): '), mf('Project Length Days')] }),
      new Paragraph({ children: [labelRun('Total man-hours: '), mf('Total Man Hours')] }),
      new Paragraph({ children: [labelRun('Markup applied: '), mf('Markup Percent')] }),
      new Paragraph({ children: [labelRun('Per-diem rate: '), mf('Per Diem Rate')] }),

      // ── Sign-off ───────────────────────────────────────────
      heading('Prepared By'),
      new Paragraph({ children: [mf('Project Manager')] }),
      new Paragraph({ children: [mf('PM Email')] }),
      blank(),
      new Paragraph({
        children: [new TextRun({
          text: 'This quote is valid for 30 days. Acceptance constitutes agreement to the scope and pricing above.',
          italics: true, color: muted, size: 18,
        })],
      }),
    ],
  }],
});

(async () => {
  const buffer = await Packer.toBuffer(doc);
  const outPath = path.resolve(__dirname, '..', 'templates', 'defaults', 'bid_template_default.docx');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
})().catch(err => { console.error(err); process.exit(1); });
