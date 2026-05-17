const fs = require('fs').promises;
const path = require('path');
const AIConfig = require('../config/aiConfig');

// NOTE: db is NOT imported at top level — intentional.
// ExtractionService is loaded in tests without a database connection.
// Only extractWithTemplate() and processVisionDocument() need db, so they require it inline.

/**
 * AI Extraction Service
 * 
 * Two-stage pipeline, local-first:
 *   Stage 1 OCR: Tesseract (local, free) → Textract fallback (cloud, paid)
 *   Stage 2 AI:  Ollama (local, free)    → Claude fallback (cloud, paid)
 * 
 * Prompts updated for v2 schema:
 *   - Timesheets: ST/OT/DT hours, worker_name, classification, project_number, miles
 *   - Invoices: project_number, line items as separate records
 *   - POs: project_number, line items as separate records
 *   - Contracts: payment_terms
 */

// ── EXTRACTION PROMPTS (v2 schema) ──────────────────────────

// Shared structural guidance about how line items typically appear on
// vendor docs in the construction supply chain. Injected into prompts
// for doc types whose extraction depends on parsing line items
// (vendor_quote, purchase_order, invoice). This is descriptive — not
// few-shot examples — because the structure is consistent enough across
// vendors that vocabulary + shape-hints are more robust than memorized
// example documents.
//
// Maintenance note: if extraction quality on a specific column class
// (e.g. UoM abbreviations) starts looking weak, expand the relevant
// bullet here rather than stuffing extra hints into individual prompts.
// Keeping the guidance shared means improvements propagate to every
// line-item-bearing doc type at once.
const LINE_ITEM_ANATOMY = `
LINE ITEM ANATOMY — typical structure on vendor docs (POs, quotes, invoices). Not every doc has every column; column order and labels vary by vendor.

Each line item row generally contains some subset of these fields, in roughly this left-to-right order:
- Description: free-text, often includes manufacturer + product name + variant (e.g. "Square D QO120 1-Pole 20A Breaker"). Frequently the longest column on the row.
- Part / item number: short alphanumeric code (e.g. "QO120", "10-100MN", "55432-A1"). Common labels: "SKU", "Item #", "MFR #", "Cat #", "P/N", "Stock #", "Model #". Sometimes appears before description, sometimes after.
- Quantity: integer or decimal. Often paired with a unit-of-measure (UoM) abbreviation. Common UoM values: EA (each), LF (linear feet), FT, IN, YD, BOX, CTN (carton), PR (pair), RL (roll), BG (bag), M (thousand), C (hundred), CS (case), PK (pack), SET, KIT.
- Unit price: currency per single unit (e.g. "$12.34", "12.34"). May or may not include $ sign.
- Extended / total price: quantity × unit price. May be labeled "Total", "Ext", "Extended", "Amount", "Line Total", "Subtotal".

When column headers are missing, ambiguous, or in a non-English language, infer fields from value shape:
- Long descriptive text with words → description
- Short alphanumeric code with no spaces → part number
- Integer or decimal, optionally followed by a 1-3 letter unit code → quantity + UoM
- Number formatted as currency ($X.XX, X.XX, or with thousands separators) → price field
- The rightmost numeric column on a row is usually the line total

Do NOT invent fields you cannot see. If a column is genuinely absent, set the corresponding field to null rather than guessing — verification is cheaper than wrong data.
`;

const EXTRACTION_PROMPTS = {
  invoice: `You are a construction document processor. Extract fields from this invoice.
${LINE_ITEM_ANATOMY}
Return ONLY valid JSON in this exact format:
{
  "extracted": {
    "project_number": string or null,
    "invoice_number": string or null,
    "invoice_date": "YYYY-MM-DD" or null,
    "customer": string or null,
    "amount": number or null,
    "line_items": [{"description": string, "quantity": number, "unit_price": number, "total": number}],
    "notes": string or null
  },
  "confidence": {
    "project_number": "high"|"medium"|"low",
    "invoice_number": "high"|"medium"|"low",
    "invoice_date": "high"|"medium"|"low",
    "customer": "high"|"medium"|"low",
    "amount": "high"|"medium"|"low"
  }
}`,

  timesheet: `You are a construction document processor. Extract ALL workers and their hours from this timesheet.
One timesheet may contain multiple workers and multiple projects. Extract each worker entry separately.
Return ONLY valid JSON in this exact format:
{
  "extracted": {
    "entries": [
      {
        "project_number": string or null,
        "worker_name": string or null,
        "classification": string or null,
        "work_date": "YYYY-MM-DD" or null,
        "st_hours": number or 0,
        "ot_hours": number or 0,
        "dt_hours": number or 0,
        "miles_driven": number or 0
      }
    ]
  },
  "confidence": {
    "project_number": "high"|"medium"|"low",
    "worker_name": "high"|"medium"|"low",
    "classification": "high"|"medium"|"low",
    "hours": "high"|"medium"|"low",
    "miles_driven": "high"|"medium"|"low"
  }
}`,

  purchase_order: `You are a construction document processor. Extract fields from this purchase order.
${LINE_ITEM_ANATOMY}
Return ONLY valid JSON in this exact format:
{
  "extracted": {
    "project_number": string or null,
    "po_number": string or null,
    "vendor": string or null,
    "order_date": "YYYY-MM-DD" or null,
    "delivery_date": "YYYY-MM-DD" or null,
    "line_items": [{"description": string, "quantity": number, "unit_price": number, "total": number}],
    "total": number or null,
    "notes": string or null
  },
  "confidence": {
    "project_number": "high"|"medium"|"low",
    "po_number": "high"|"medium"|"low",
    "vendor": "high"|"medium"|"low",
    "order_date": "high"|"medium"|"low",
    "total": "high"|"medium"|"low"
  }
}`,

  contract: `You are a construction document processor. Extract fields from this contract.
Return ONLY valid JSON in this exact format:
{
  "extracted": {
    "contract_number": string or null,
    "parties": string or null,
    "start_date": "YYYY-MM-DD" or null,
    "end_date": "YYYY-MM-DD" or null,
    "value": number or null,
    "retention_pct": number or null,
    "payment_terms": string or null,
    "key_terms": [string],
    "notes": string or null
  },
  "confidence": {
    "contract_number": "high"|"medium"|"low",
    "parties": "high"|"medium"|"low",
    "start_date": "high"|"medium"|"low",
    "end_date": "high"|"medium"|"low",
    "value": "high"|"medium"|"low",
    "payment_terms": "high"|"medium"|"low"
  }
}`,

  // Vendor quote — what a vendor sends the firm BEFORE the firm cuts a PO.
  // Quotes look superficially like POs but lack the firm's PO number, project
  // assignment, and delivery instructions. The firm employee uses the quote
  // data to populate an internal PO that gets sent back to the vendor.
  // Field set is similar to PO but project_number is intentionally absent
  // (quotes don't carry project info).
  //
  // The source document may also be a SCREENSHOT of a vendor's website
  // cart/checkout page (Home Depot, Grainger, McMaster-Carr, Amazon Business,
  // etc.) — the firm employee captures the cart and uses it to draft a PO.
  // Cart screenshots typically lack a quote_number, quote_date, valid_until,
  // payment_terms, and delivery_lead_time; these should be set to null when
  // not present without lowering confidence (the format-driven absence is
  // expected, not a quality signal).
  vendor_quote: `You are a construction document processor. Extract fields from this VENDOR QUOTE \u2014 a price quote sent FROM a vendor TO a contracting firm. The firm will use this data to draft an internal purchase order back to the vendor.

The document may be a formal vendor quote PDF OR a screenshot of a vendor\u2019s website cart/checkout page (Home Depot, Grainger, McMaster-Carr, Amazon Business, Lowe\u2019s, etc.).

CART SCREENSHOTS commonly differ from formal quotes:
\u2022 No quote_number \u2014 set to null
\u2022 No quote_date or valid_until \u2014 set to null
\u2022 No payment_terms or delivery_lead_time \u2014 set to null
\u2022 vendor_address / vendor_phone / vendor_email \u2014 null unless visible in page header/footer
\u2022 Vendor name typically comes from the page logo or header (e.g. "Home Depot", "Grainger") rather than a "From:" label
\u2022 Total may be missing pre-checkout (only subtotal visible). If only subtotal is present and total is not, set total = subtotal.

Setting fields to null because the source format doesn\u2019t include them is EXPECTED, not a low-confidence signal. Reserve "low" confidence for cases where you saw a value but couldn\u2019t read it cleanly. Prioritize accurate line items (description, quantity, unit_price, total) and the running total in both formats.
${LINE_ITEM_ANATOMY}
Return ONLY valid JSON in this exact format:
{
  "extracted": {
    "quote_number": string or null,
    "vendor": string or null,
    "vendor_address": string or null,
    "vendor_phone": string or null,
    "vendor_email": string or null,
    "quote_date": "YYYY-MM-DD" or null,
    "valid_until": "YYYY-MM-DD" or null,
    "line_items": [{"description": string, "quantity": number, "unit_price": number, "total": number}],
    "subtotal": number or null,
    "tax": number or null,
    "shipping": number or null,
    "total": number or null,
    "payment_terms": string or null,
    "delivery_lead_time": string or null,
    "notes": string or null
  },
  "confidence": {
    "quote_number": "high"|"medium"|"low",
    "vendor": "high"|"medium"|"low",
    "quote_date": "high"|"medium"|"low",
    "total": "high"|"medium"|"low",
    "line_items": "high"|"medium"|"low"
  }
}`,
};

// Map inbox/subfolder names to doc types
const SUBFOLDER_TO_DOCTYPE = {
  invoices: 'invoice',
  timesheets: 'timesheet',
  purchase_orders: 'purchase_order',
  vendor_quotes: 'vendor_quote',
  contracts: 'contract',
  Contract: 'contract',
};

const ExtractionService = {
  getDocType(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    for (const [folder, type] of Object.entries(SUBFOLDER_TO_DOCTYPE)) {
      if (normalized.includes(`/${folder}/`) || normalized.includes(`/${folder}`)) return type;
    }
    return null;
  },

  async getProjectIdFromPath(filePath, db) {
    const normalized = filePath.replace(/\\/g, '/');
    const project = await db('projects')
      .whereRaw('? LIKE folder_path || \'%\'', [normalized])
      .first();
    return project ? project.id : null;
  },

  /**
   * Match a project number string to an existing project in the database.
   * Used by centralized inbox flow to identify which project a document belongs to.
   */
  async matchProjectNumber(projectNumber, db) {
    if (!projectNumber) return null;
    const trimmed = projectNumber.trim();

    // Check project_numbers table first (multiple numbers per project)
    const pn = await db('project_numbers')
      .where('number', trimmed)
      .first();
    if (pn) return pn.project_id;

    // Check bid_number on associated bids
    const bid = await db('bids')
      .where('bid_number', trimmed)
      .whereNotNull('id')
      .first();
    if (bid) {
      const project = await db('projects').where('bid_id', bid.id).first();
      if (project) return project.id;
    }

    // Fuzzy: check if it's in the project name
    const project = await db('projects')
      .where('name', 'ilike', `%${trimmed}%`)
      .first();
    return project ? project.id : null;
  },

  // ══════════════════════════════════════════════════════════
  // STAGE 1: TEXT EXTRACTION (OCR)
  // ══════════════════════════════════════════════════════════

  async extractText(filePath) {
    let localPath = filePath;
    let tempFile = null;

    // If S3 key, download to temp
    if (!path.isAbsolute(filePath) && !filePath.startsWith('.') && !filePath.startsWith('/')) {
      try {
        const StorageService = require('./StorageService');
        const buffer = await StorageService.getFile(filePath);
        const os = require('os');
        tempFile = path.join(os.tmpdir(), `extraction_${Date.now()}_${path.basename(filePath)}`);
        await fs.writeFile(tempFile, buffer);
        localPath = tempFile;
      } catch (err) {
        return { text: `[S3 download failed: ${err.message}]`, method: 's3_error' };
      }
    }

    try {
      const ext = path.extname(localPath || filePath).toLowerCase();

      // Direct read for text files
      if (['.txt', '.csv', '.tsv', '.json', '.xml'].includes(ext)) {
        const content = await fs.readFile(localPath, 'utf-8');
        return { text: content, method: 'direct_read' };
      }

      // Try Tesseract first (local, free)
      if (['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp'].includes(ext)) {
        const tesseractResult = await this._tesseractExtract(localPath);
        if (tesseractResult.text && tesseractResult.text.length > 20) {
          return tesseractResult;
        }

        // Tesseract returned too little text — try Textract if available
        if (process.env.AWS_TEXTRACT_REGION) {
          console.log('[OCR] Tesseract returned insufficient text, escalating to Textract');
          return this._textractExtract(localPath);
        }

        // Return whatever Tesseract got (user will see low-confidence results)
        return tesseractResult;
      }

      // Textract fallback for unsupported extensions
      if (process.env.AWS_TEXTRACT_REGION) {
        return this._textractExtract(localPath);
      }

      // Last resort: try reading as text
      try {
        const content = await fs.readFile(localPath, 'utf-8');
        if (content.length > 0 && !content.includes('\x00')) {
          return { text: content, method: 'fallback_text' };
        }
      } catch { /* not a text file */ }

      return {
        text: `[Binary file: ${path.basename(filePath)}. Install Tesseract or configure AWS_TEXTRACT_REGION for OCR.]`,
        method: 'fallback_notice',
      };
    } finally {
      if (tempFile) await fs.unlink(tempFile).catch(() => {});
    }
  },

  async _tesseractExtract(filePath) {
    try {
      // Use tesseract.js (pure JS, no system dependency)
      const Tesseract = require('tesseract.js');
      const startTime = Date.now();

      const { data } = await Tesseract.recognize(filePath, 'eng', {
        logger: () => {}, // Suppress progress logs
      });

      return {
        text: data.text,
        method: 'tesseract',
        ocrConfidence: Math.round(data.confidence),
        processing_time_ms: Date.now() - startTime,
      };
    } catch (err) {
      console.error('[Tesseract] Error:', err.message);

      // Try system tesseract binary as backup
      try {
        const { execSync } = require('child_process');
        const text = execSync(`tesseract "${filePath}" stdout 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 60000,
        });
        return { text, method: 'tesseract_binary' };
      } catch {
        return { text: `[Tesseract failed: ${err.message}]`, method: 'tesseract_error' };
      }
    }
  },

  async _textractExtract(filePath) {
    try {
      const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
      const client = new TextractClient({ region: process.env.AWS_TEXTRACT_REGION });
      const fileBuffer = await fs.readFile(filePath);
      const response = await client.send(
        new DetectDocumentTextCommand({ Document: { Bytes: fileBuffer } })
      );
      const text = response.Blocks
        .filter(b => b.BlockType === 'LINE')
        .map(b => b.Text)
        .join('\n');
      return { text, method: 'textract', blocks: response.Blocks.length };
    } catch (err) {
      console.error('[Textract] Error:', err.message);
      return { text: `[Textract failed: ${err.message}]`, method: 'textract_error' };
    }
  },

  // ══════════════════════════════════════════════════════════
  // STAGE 2: AI FIELD EXTRACTION
  // ══════════════════════════════════════════════════════════

  async extractFields(rawText, docType, vendorHints = null) {
    const prompt = EXTRACTION_PROMPTS[docType];
    if (!prompt) throw new Error(`Unknown document type: ${docType}`);

    const backend = AIConfig.backend;

    // Try Ollama first (or exclusively if forced)
    if (backend === 'ollama' || backend === 'auto') {
      const result = await this._ollamaExtract(rawText, prompt, docType, vendorHints);

      if (result.method !== 'ollama_error') {
        // Check if we should escalate to Claude for low confidence
        if (backend === 'auto' && AIConfig.claude.available && result.overall_confidence < AIConfig.ollama.escalationThreshold) {
          console.log(`[AI] Ollama confidence ${result.overall_confidence}% below threshold, escalating to Claude`);
          return this._claudeExtract(rawText, prompt, docType, vendorHints);
        }
        return result;
      }

      // Ollama failed — fall through to Claude if available
      if (AIConfig.claude.available) {
        console.log('[AI] Ollama unavailable, falling back to Claude API');
        return this._claudeExtract(rawText, prompt, docType, vendorHints);
      }

      // No fallback available — return the error result
      return result;
    }

    // Claude forced or Ollama not configured
    if (backend === 'claude' && AIConfig.claude.available) {
      return this._claudeExtract(rawText, prompt, docType, vendorHints);
    }

    console.log('[ExtractionService] No AI backend available (set OLLAMA_HOST or ANTHROPIC_API_KEY)');
    return this._emptyExtraction(docType);
  },

  async _ollamaExtract(rawText, prompt, docType, vendorHints = null) {
    const config = AIConfig.getModelConfig(docType);

    let fullPrompt = prompt;
    if (vendorHints) {
      fullPrompt += `\n\n--- VENDOR-SPECIFIC HINTS ---\n${vendorHints}`;
    }

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AIConfig.ollama.timeout);

      const response = await fetch(`${config.ollama.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.ollama.model,
          messages: [{
            role: 'user',
            content: `${fullPrompt}\n\n--- DOCUMENT TEXT ---\n${rawText.substring(0, 12000)}`,
          }],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1, // Low temp for structured extraction
            num_predict: 2048,
          },
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.message?.content || '';
      const cleaned = text.replace(/```json\s*|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const extracted_data = parsed.extracted || parsed;
      const confidence_scores = parsed.confidence || this._defaultConfidence(docType);

      const validation = AIConfig.validation.validate(docType, extracted_data);
      const overallConfidence = AIConfig.confidence.calculateOverall(confidence_scores);

      return {
        extracted_data,
        confidence_scores,
        method: 'ollama',
        model: config.ollama.model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: overallConfidence,
        validation,
        vendor_hints_used: !!vendorHints,
      };
    } catch (err) {
      console.error('[Ollama] Extraction error:', err.message);
      return {
        ...this._emptyExtraction(docType),
        error: err.message,
        method: 'ollama_error',
        model: config.ollama.model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: 0,
      };
    }
  },

  async _claudeExtract(rawText, prompt, docType, vendorHints = null) {
    const config = AIConfig.getModelConfig(docType);

    let fullPrompt = prompt;
    if (vendorHints) {
      fullPrompt += `\n\n--- VENDOR-SPECIFIC HINTS ---\n${vendorHints}`;
    }

    const startTime = Date.now();

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.claude.model,
          max_tokens: config.claude.maxTokens,
          messages: [{
            role: 'user',
            content: `${fullPrompt}\n\n--- DOCUMENT TEXT ---\n${rawText.substring(0, 15000)}`,
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude API ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const cleaned = text.replace(/```json\s*|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const extracted_data = parsed.extracted || parsed;
      const confidence_scores = parsed.confidence || this._defaultConfidence(docType);

      const validation = AIConfig.validation.validate(docType, extracted_data);
      const overallConfidence = AIConfig.confidence.calculateOverall(confidence_scores);

      return {
        extracted_data,
        confidence_scores,
        method: 'claude',
        model: config.claude.model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: overallConfidence,
        validation,
        vendor_hints_used: !!vendorHints,
      };
    } catch (err) {
      console.error('[Claude] Extraction error:', err.message);
      return {
        ...this._emptyExtraction(docType),
        error: err.message,
        method: 'claude_error',
        model: config.claude.model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: 0,
      };
    }
  },

  // ── FALLBACKS ─────────────────────────────────────────────

  _emptyExtraction(docType) {
    const schemas = {
      invoice: { project_number: null, invoice_number: null, invoice_date: null, customer: null, amount: null, line_items: [], notes: null },
      timesheet: { entries: [] },
      purchase_order: { project_number: null, po_number: null, vendor: null, order_date: null, delivery_date: null, line_items: [], total: null, notes: null },
      vendor_quote: { quote_number: null, vendor: null, vendor_address: null, vendor_phone: null, vendor_email: null, quote_date: null, valid_until: null, line_items: [], subtotal: null, tax: null, shipping: null, total: null, payment_terms: null, delivery_lead_time: null, notes: null },
      contract: { contract_number: null, parties: null, start_date: null, end_date: null, value: null, retention_pct: null, payment_terms: null, key_terms: [], notes: null },
    };

    const extracted_data = schemas[docType] || {};
    const confidence_scores = {};
    for (const key of Object.keys(extracted_data)) {
      if (!Array.isArray(extracted_data[key])) confidence_scores[key] = 'low';
    }
    return { extracted_data, confidence_scores, method: 'empty_fallback' };
  },

  _defaultConfidence(docType) {
    const result = {};
    const e = this._emptyExtraction(docType).extracted_data;
    for (const key of Object.keys(e)) {
      if (!Array.isArray(e[key])) result[key] = 'medium';
    }
    return result;
  },

  // ══════════════════════════════════════════════════════════
  // FULL PIPELINE
  // ══════════════════════════════════════════════════════════

  async processDocument(filePath, docType) {
    console.log(`[Extraction] Processing ${docType}: ${path.basename(filePath)} (AI: ${AIConfig.backend}, OCR: ${AIConfig.ocrBackend})`);

    // ── VISION FAST PATH ──────────────────────────────────────
    // For doc types that benefit from reading the image directly
    // (currently: vendor_quote — cart screenshots have layout/structure
    // that OCR loses), skip OCR entirely and send the image to a vision
    // model with the standard text extraction prompt.
    //
    // Why: Tesseract on a Home Depot / Grainger cart screenshot returns
    // text but loses the column structure of line items. The downstream
    // text-only LLM can't reconstruct what cell aligned with what, so it
    // returns 0% confidence garbage. Vision-LM reads the image as it
    // visually appears — the spatial information stays intact.
    //
    // Conditions for using this path:
    //   1. Source file is an image (.png/.jpg/.jpeg/.tiff/.webp/.gif/.bmp)
    //   2. doc_type is one we've vision-prompted (today: vendor_quote)
    //   3. A vision model name is configured (OLLAMA_VISION_MODEL)
    //
    // PDFs always go through the OCR+text path. Other doc types (invoice,
    // PO, timesheet) typically arrive as PDFs from accounting tools and
    // OCR works well; we don't reroute them.
    const isImage = /\.(png|jpe?g|tiff?|webp|gif|bmp)$/i.test(filePath);
    const visionDocTypes = new Set(['vendor_quote']);
    const useVision = isImage && visionDocTypes.has(docType) && !!AIConfig.ollamaVisionModel;

    if (useVision) {
      console.log(`[Extraction] Routing image-source ${docType} through vision (model: ${AIConfig.ollamaVisionModel})`);
      const prompt = EXTRACTION_PROMPTS[docType];
      const result = await this._visionExtractWithPrompt(filePath, prompt, docType);

      // If vision call errored (model not pulled, timeout, etc.), fall
      // through to OCR+text path so the upload still produces something
      // for the user to verify rather than failing entirely.
      if (result.method !== 'llava_error' && result.method !== 'vision_prompt_error') {
        console.log(`[Extraction] Vision: ${result.method} (model: ${result.model || 'n/a'}, confidence: ${result.overall_confidence || 0}%)`);
        return {
          raw_text_length: 0,
          text_method: 'vision_direct',
          ocr_confidence: null,
          extraction_method: result.method,
          extracted_data: result.extracted_data,
          confidence_scores: result.confidence_scores,
          error: result.error || null,
          model_used: result.model || null,
          processing_time_ms: result.processing_time_ms || null,
          overall_confidence: result.overall_confidence || 0,
          validation: null,
          vendor_name: null,
          vendor_hints_used: false,
        };
      }
      console.log(`[Extraction] Vision failed (${result.error || 'unknown'}), falling back to OCR+text path`);
      // fall through to OCR path below
    }

    // ── STANDARD PATH: OCR → text LLM ─────────────────────────
    // Stage 1: Extract raw text
    const { text, method: textMethod, ocrConfidence } = await this.extractText(filePath);
    console.log(`[Extraction] OCR: ${textMethod} (${text.length} chars${ocrConfidence ? `, ${ocrConfidence}% conf` : ''})`);

    // Stage 1.5: Vendor learning hints
    let vendorHints = null;
    let detectedVendor = null;
    try {
      const VendorLearning = require('./VendorLearning');
      const match = await VendorLearning.findMatchingVendor(text, docType);
      if (match) {
        vendorHints = match.hints;
        detectedVendor = match.name;
      }
    } catch { /* vendor learning optional */ }

    // Stage 2: AI field extraction
    const result = await this.extractFields(text, docType, vendorHints);
    console.log(`[Extraction] AI: ${result.method} (model: ${result.model || 'n/a'}, confidence: ${result.overall_confidence || 0}%)`);

    return {
      raw_text_length: text.length,
      text_method: textMethod,
      ocr_confidence: ocrConfidence || null,
      extraction_method: result.method,
      extracted_data: result.extracted_data,
      confidence_scores: result.confidence_scores,
      error: result.error || null,
      model_used: result.model || null,
      processing_time_ms: result.processing_time_ms || null,
      overall_confidence: result.overall_confidence || 0,
      validation: result.validation || null,
      vendor_name: detectedVendor,
      vendor_hints_used: result.vendor_hints_used || false,
    };
  },

  SUBFOLDER_TO_DOCTYPE,
  EXTRACTION_PROMPTS,

  // ══════════════════════════════════════════════════════════
  // VISION EXTRACTION PIPELINE (Phase B)
  // Used for form-template-backed documents (oil samples, etc.)
  // Sends image directly to vision model — no OCR stage needed.
  // ══════════════════════════════════════════════════════════

  /**
   * Build the vision prompt from a field_map.
   * Tells the vision model exactly what fields to extract and their types.
   */
  _buildVisionPrompt(fieldMap) {
    const fieldDescriptions = fieldMap.map((f, i) =>
      `${i + 1}. "${f.field_name}" (type: ${f.data_type || 'text'})`
    ).join('\n');

    return `You are a construction document processor with vision capabilities.
You are looking at a photograph of a filled-out form. Extract the following fields from the form.

FIELDS TO EXTRACT:
${fieldDescriptions}

For each field:
- If the type is "text", extract the handwritten or printed text value.
- If the type is "number", extract the numeric value.
- If the type is "date", extract and format as YYYY-MM-DD.
- If the type is "checkbox", return true if checked/marked, false if empty.
- If the type is "filled_circle", return true if filled in, false if empty.

Return ONLY valid JSON in this exact format:
{
  "extracted": {
    ${fieldMap.map(f => `"${f.field_name}": <value based on data_type>`).join(',\n    ')}
  },
  "confidence": {
    ${fieldMap.map(f => `"${f.field_name}": <number 0.0 to 1.0>`).join(',\n    ')}
  }
}

Be precise. If a field is illegible or missing, set the value to null and confidence to 0.`;
  },

  /**
   * Vision extraction using a free-form text prompt (no field_map).
   *
   * Why this exists alongside _llavaVisionExtract:
   *   _llavaVisionExtract is for template-driven docs (oil-sample forms)
   *   where there's a fixed field_map with bbox coordinates. Vendor quotes
   *   and cart screenshots are free-form — they have line items, totals,
   *   and vendor info but no fixed template. So we send the standard
   *   text-extraction prompt directly to the vision model and it decides
   *   what fields to extract.
   *
   * Returns the same shape as _llavaVisionExtract / _ollamaExtract so the
   * caller doesn't have to special-case the result.
   */
  async _visionExtractWithPrompt(imagePath, prompt, docType) {
    const startTime = Date.now();
    const model = AIConfig.ollamaVisionModel;

    try {
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AIConfig.extractionTimeoutMs || 180000);

      const response = await fetch(`${AIConfig.ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: prompt + '\n\nRead the attached image and extract the requested fields. Return ONLY valid JSON in the format specified above.',
            images: [base64Image],
          }],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1,
            num_predict: 4096,
          },
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama vision ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.message?.content || '';
      const cleaned = text.replace(/```json\s*|```/g, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        // Vision models occasionally return text with the JSON embedded —
        // try a more forgiving extraction before giving up.
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) {
          parsed = JSON.parse(m[0]);
        } else {
          throw new Error(`Vision returned non-JSON: ${cleaned.substring(0, 200)}`);
        }
      }

      const extracted_data = parsed.extracted || parsed;
      const confidence_scores = parsed.confidence || this._defaultConfidence(docType);

      // Vision models typically return string confidence labels (high/medium/low)
      // matching the prompt's instructions. Convert to numeric for the overall
      // score, treating high=1.0, medium=0.6, low=0.3, unknown=0.5.
      const labelToNum = { high: 1.0, medium: 0.6, low: 0.3 };
      const numericScores = Object.values(confidence_scores)
        .map(v => typeof v === 'number' ? v : (labelToNum[String(v).toLowerCase()] ?? 0.5));
      const overall = numericScores.length > 0
        ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
        : 0;

      console.log(`[Vision/Prompt] Extracted ${Object.keys(extracted_data).length} fields in ${Date.now() - startTime}ms (confidence: ${(overall * 100).toFixed(0)}%)`);

      return {
        extracted_data,
        confidence_scores,
        method: 'vision_prompt',
        model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: overall,
      };
    } catch (err) {
      console.error('[Vision/Prompt] Error:', err.message);
      return {
        extracted_data: {},
        confidence_scores: {},
        error: err.message,
        method: 'vision_prompt_error',
        model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: 0,
      };
    }
  },

  /**
   * Extract fields from an image using Llava on Ollama.
   * Llava is a vision-language model that can read images directly.
   */
  async _llavaVisionExtract(imagePath, fieldMap) {
    const startTime = Date.now();
    const model = AIConfig.ollamaVisionModel;

    try {
      // Read image as base64
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const prompt = this._buildVisionPrompt(fieldMap);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AIConfig.extractionTimeoutMs || 120000);

      const response = await fetch(`${AIConfig.ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: prompt,
            images: [base64Image],
          }],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1,
            num_predict: 4096,
          },
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama Llava ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.message?.content || '';
      const cleaned = text.replace(/```json\s*|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const extracted_data = parsed.extracted || parsed;
      const confidence_scores = parsed.confidence || {};

      // Calculate overall confidence
      const confValues = Object.values(confidence_scores).filter(v => typeof v === 'number');
      const overall = confValues.length > 0 ? confValues.reduce((a, b) => a + b, 0) / confValues.length : 0;

      console.log(`[Vision/Llava] Extracted ${Object.keys(extracted_data).length} fields in ${Date.now() - startTime}ms (confidence: ${(overall * 100).toFixed(0)}%)`);

      return {
        extracted_data,
        confidence_scores,
        method: 'llava',
        model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: overall,
      };
    } catch (err) {
      console.error('[Vision/Llava] Error:', err.message);
      return {
        extracted_data: {},
        confidence_scores: {},
        error: err.message,
        method: 'llava_error',
        model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: 0,
      };
    }
  },

  /**
   * Extract fields from an image using Claude Vision API.
   * Fallback when Llava is unavailable or confidence is too low.
   */
  async _claudeVisionExtract(imagePath, fieldMap) {
    const startTime = Date.now();
    const model = AIConfig.claudeVisionModel;

    if (!AIConfig.anthropicApiKey) {
      return {
        extracted_data: {}, confidence_scores: {},
        error: 'ANTHROPIC_API_KEY not set', method: 'claude_vision_error',
        model, processing_time_ms: 0, overall_confidence: 0,
      };
    }

    try {
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const ext = path.extname(imagePath).toLowerCase();
      const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const prompt = this._buildVisionPrompt(fieldMap);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': AIConfig.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude Vision ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const cleaned = text.replace(/```json\s*|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const extracted_data = parsed.extracted || parsed;
      const confidence_scores = parsed.confidence || {};

      const confValues = Object.values(confidence_scores).filter(v => typeof v === 'number');
      const overall = confValues.length > 0 ? confValues.reduce((a, b) => a + b, 0) / confValues.length : 0;

      console.log(`[Vision/Claude] Extracted ${Object.keys(extracted_data).length} fields in ${Date.now() - startTime}ms (confidence: ${(overall * 100).toFixed(0)}%)`);

      return {
        extracted_data,
        confidence_scores,
        method: 'claude_vision',
        model,
        processing_time_ms: Date.now() - startTime,
        overall_confidence: overall,
      };
    } catch (err) {
      console.error('[Vision/Claude] Error:', err.message);
      return {
        extracted_data: {}, confidence_scores: {},
        error: err.message, method: 'claude_vision_error',
        model, processing_time_ms: Date.now() - startTime, overall_confidence: 0,
      };
    }
  },

  /**
   * Extract fields from an image using the configured vision backend.
   * Auto-fallback: Llava → Claude Vision (mirrors the text pipeline pattern).
   */
  async extractWithVision(imagePath, fieldMap) {
    const visionBackend = AIConfig.visionBackend;

    // Try Llava first (or exclusively if forced)
    if (visionBackend === 'ollama' || visionBackend === 'auto') {
      const result = await this._llavaVisionExtract(imagePath, fieldMap);

      if (result.method !== 'llava_error') {
        // Check if confidence is too low → escalate to Claude
        if (visionBackend === 'auto' && AIConfig.anthropicApiKey && result.overall_confidence < AIConfig.confidenceThreshold) {
          console.log(`[Vision] Llava confidence ${(result.overall_confidence * 100).toFixed(0)}% below threshold, escalating to Claude Vision`);
          return this._claudeVisionExtract(imagePath, fieldMap);
        }
        return result;
      }

      // Llava failed — fall through to Claude
      if (AIConfig.anthropicApiKey) {
        console.log('[Vision] Llava unavailable, falling back to Claude Vision');
        return this._claudeVisionExtract(imagePath, fieldMap);
      }

      return result;
    }

    // Claude forced
    if (visionBackend === 'claude' && AIConfig.anthropicApiKey) {
      return this._claudeVisionExtract(imagePath, fieldMap);
    }

    console.log('[Vision] No vision backend available');
    return { extracted_data: {}, confidence_scores: {}, method: 'no_vision_backend', overall_confidence: 0 };
  },

  /**
   * Extract fields from an image using a stored form template.
   * Loads the template's field_map from the database, then calls extractWithVision.
   */
  async extractWithTemplate(imagePath, templateId) {
    const db = require('../config/database');
    const template = await db('form_templates').where({ id: templateId, active: true }).first();
    if (!template) throw new Error('Active form template not found: ' + templateId);

    const fieldMap = typeof template.field_map === 'string'
      ? JSON.parse(template.field_map)
      : template.field_map;

    if (!fieldMap || !Array.isArray(fieldMap) || fieldMap.length === 0) {
      throw new Error('Template has no field map configured');
    }

    console.log(`[Vision] Using template "${template.name}" (${fieldMap.length} fields) for extraction`);
    const result = await this.extractWithVision(imagePath, fieldMap);

    return {
      ...result,
      template_id: template.id,
      template_name: template.name,
      form_type: template.form_type,
      field_count: fieldMap.length,
    };
  },

  /**
   * Full vision pipeline: image → template lookup → vision extract → result.
   * Used by oil sample upload route.
   */
  async processVisionDocument(filePath, formType = 'oil_sample') {
    const db = require('../config/database');

    console.log(`[Vision] Processing ${formType}: ${path.basename(filePath)} (vision: ${AIConfig.visionBackend})`);

    // Find active template for this form type
    const template = await db('form_templates')
      .where({ form_type: formType, active: true })
      .first();

    if (!template) {
      throw new Error(`No active form template for "${formType}". An admin must upload and activate a template in Admin → Form Templates before oil samples can be processed.`);
    }

    return this.extractWithTemplate(filePath, template.id);
  },
};

module.exports = ExtractionService;
