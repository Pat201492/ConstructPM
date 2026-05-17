const ExtractionService = require('../../src/services/ExtractionService');

describe('ExtractionService', () => {
  describe('getDocType', () => {
    it('should detect invoice from path', () => {
      expect(ExtractionService.getDocType('/storage/projects/2026/PM/Customer/Project/invoices/inv-001.pdf'))
        .toBe('invoice');
    });

    it('should detect timesheet from path', () => {
      expect(ExtractionService.getDocType('/storage/projects/2026/PM/Customer/Project/timesheets/ts.xlsx'))
        .toBe('timesheet');
    });

    it('should detect purchase_order from path', () => {
      expect(ExtractionService.getDocType('/storage/projects/2026/PM/Customer/Project/purchase_orders/po-88.pdf'))
        .toBe('purchase_order');
    });

    it('should detect contract from contracts/ path', () => {
      expect(ExtractionService.getDocType('/storage/projects/2026/PM/Customer/Project/contracts/contract.pdf'))
        .toBe('contract');
    });

    it('should detect contract from Contract/ path', () => {
      expect(ExtractionService.getDocType('/storage/projects/2026/PM/Customer/Project/Contract/contract.pdf'))
        .toBe('contract');
    });

    it('should return null for non-monitored paths', () => {
      expect(ExtractionService.getDocType('/storage/bids/user1/bid1/estimate.xlsx'))
        .toBeNull();
    });

    it('should handle Windows-style paths', () => {
      expect(ExtractionService.getDocType('C:\\storage\\projects\\2026\\PM\\Customer\\Project\\invoices\\inv.pdf'))
        .toBe('invoice');
    });
  });

  describe('_emptyExtraction', () => {
    it('should return v2 fields for invoice type', () => {
      const result = ExtractionService._emptyExtraction('invoice');
      expect(result.extracted_data).toHaveProperty('project_number');
      expect(result.extracted_data).toHaveProperty('invoice_number');
      expect(result.extracted_data).toHaveProperty('customer');
      expect(result.extracted_data).toHaveProperty('amount');
      expect(result.extracted_data).toHaveProperty('invoice_date');
      expect(result.extracted_data).toHaveProperty('line_items');
      expect(Array.isArray(result.extracted_data.line_items)).toBe(true);
    });

    it('should return v2 fields for purchase_order type', () => {
      const result = ExtractionService._emptyExtraction('purchase_order');
      expect(result.extracted_data).toHaveProperty('project_number');
      expect(result.extracted_data).toHaveProperty('po_number');
      expect(result.extracted_data).toHaveProperty('vendor');
      expect(result.extracted_data).toHaveProperty('total');
      expect(result.extracted_data).toHaveProperty('line_items');
    });

    it('should return v2 fields for contract type', () => {
      const result = ExtractionService._emptyExtraction('contract');
      expect(result.extracted_data).toHaveProperty('contract_number');
      expect(result.extracted_data).toHaveProperty('parties');
      expect(result.extracted_data).toHaveProperty('value');
      expect(result.extracted_data).toHaveProperty('retention_pct');
      expect(result.extracted_data).toHaveProperty('payment_terms');
    });

    it('should return entries array for timesheet type', () => {
      const result = ExtractionService._emptyExtraction('timesheet');
      expect(result.extracted_data).toHaveProperty('entries');
      expect(Array.isArray(result.extracted_data.entries)).toBe(true);
    });

    it('should set all scalar confidence scores to low', () => {
      const result = ExtractionService._emptyExtraction('invoice');
      Object.values(result.confidence_scores).forEach(score => {
        expect(score).toBe('low');
      });
    });

    it('should not include array fields in confidence scores', () => {
      const result = ExtractionService._emptyExtraction('invoice');
      expect(result.confidence_scores).not.toHaveProperty('line_items');
    });

    it('should return empty object for unknown type', () => {
      const result = ExtractionService._emptyExtraction('unknown_type');
      expect(result.extracted_data).toEqual({});
      expect(result.confidence_scores).toEqual({});
    });
  });

  describe('_defaultConfidence', () => {
    it('should return medium for all scalar fields', () => {
      const result = ExtractionService._defaultConfidence('invoice');
      expect(result.project_number).toBe('medium');
      expect(result.invoice_number).toBe('medium');
      expect(result.customer).toBe('medium');
      expect(result.amount).toBe('medium');
    });
  });

  describe('SUBFOLDER_TO_DOCTYPE mapping', () => {
    it('should have all monitored subfolder types', () => {
      const map = ExtractionService.SUBFOLDER_TO_DOCTYPE;
      expect(map.invoices).toBe('invoice');
      expect(map.timesheets).toBe('timesheet');
      expect(map.purchase_orders).toBe('purchase_order');
      expect(map.contracts).toBe('contract');
      expect(map.Contract).toBe('contract');
    });
  });

  describe('LINE_ITEM_ANATOMY guidance', () => {
    // The anatomy block teaches the model the shape of typical PO/quote/
    // invoice line items (column order, label aliases, UoM abbreviations).
    // Should appear in line-item-bearing prompts and NOT in others, since
    // each token costs latency and confuses non-line-item flows.
    const prompts = ExtractionService.EXTRACTION_PROMPTS;

    it('appears in invoice, purchase_order, vendor_quote prompts', () => {
      expect(prompts.invoice).toMatch(/LINE ITEM ANATOMY/);
      expect(prompts.purchase_order).toMatch(/LINE ITEM ANATOMY/);
      expect(prompts.vendor_quote).toMatch(/LINE ITEM ANATOMY/);
    });

    it('does NOT appear in timesheet or contract prompts', () => {
      // Timesheets have worker rows, not line items; contracts have terms.
      expect(prompts.timesheet).not.toMatch(/LINE ITEM ANATOMY/);
      expect(prompts.contract).not.toMatch(/LINE ITEM ANATOMY/);
    });

    it('mentions common UoM abbreviations', () => {
      // Construction-supply UoMs the model needs to recognize.
      const a = prompts.purchase_order;
      ['EA', 'LF', 'BOX'].forEach(uom => expect(a).toContain(uom));
    });

    it('instructs the model not to invent absent fields', () => {
      // Important guardrail — without this, the model fabricates plausible-
      // looking values for missing columns, which is harder to catch on
      // verification than a null.
      expect(prompts.purchase_order).toMatch(/Do NOT invent|set the corresponding field to null|null rather than guessing/i);
    });
  });

  describe('vision routing for image-source vendor quotes', () => {
    // We don't run the full _visionExtractWithPrompt against a live Ollama
    // (unit tests don't have one), but we can verify the method exists and
    // the routing condition is correctly defined. The expensive integration
    // path is exercised manually via the inbox.
    it('exposes _visionExtractWithPrompt as a callable method', () => {
      expect(typeof ExtractionService._visionExtractWithPrompt).toBe('function');
    });

    it('vendor_quote prompt is suitable for vision (no field_map dependency)', () => {
      // The prompt must work standalone — no template-specific placeholders
      // that _buildVisionPrompt would normally fill in.
      const prompt = ExtractionService.EXTRACTION_PROMPTS.vendor_quote;
      expect(prompt).not.toMatch(/\{[A-Z_]+\}/); // no unfilled template tokens
    });
  });

  describe('vendor_quote prompt (cart-aware)', () => {
    // The vendor-quote inbox accepts both formal vendor PDF quotes AND
    // screenshots of website carts (Home Depot, Grainger, etc.). The
    // prompt must signal both cases to the AI so it doesn't penalize
    // confidence for missing format-specific fields like quote_number.
    const prompt = ExtractionService.EXTRACTION_PROMPTS.vendor_quote;

    it('should exist and be a non-empty string', () => {
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should mention website cart / checkout as a possible source format', () => {
      expect(prompt.toLowerCase()).toMatch(/cart|checkout/);
    });

    it('should reference at least one common online vendor by name', () => {
      // Pat's electrical contracting context: Home Depot, Grainger,
      // McMaster-Carr, Amazon Business are the day-to-day cart sources.
      expect(prompt).toMatch(/Home Depot|Grainger|McMaster|Amazon Business/);
    });

    it('should instruct that null fields from format mismatch are EXPECTED', () => {
      // Without this guidance the AI tends to lower its overall confidence
      // when the source is a cart (most "quote-shaped" fields are absent).
      expect(prompt.toLowerCase()).toMatch(/expected|not.*low.confidence|set.*null/);
    });

    it('should retain the formal-quote field set (regression check)', () => {
      // Additive change must not drop the original quote-shaped fields.
      ['quote_number', 'vendor', 'quote_date', 'valid_until', 'line_items',
       'subtotal', 'total', 'payment_terms', 'delivery_lead_time'].forEach(field => {
        expect(prompt).toContain(`"${field}"`);
      });
    });

    it('should still require ONLY valid JSON output', () => {
      // The JSON-only contract is what makes Ollama's output parseable;
      // don't let prompt rewrites drop it.
      expect(prompt).toMatch(/ONLY valid JSON/i);
    });
  });
});
