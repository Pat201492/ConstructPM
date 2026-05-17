# Future Refinement — AI Training Data Capture for Improved Extraction Accuracy

> **Status:** Backlog · **Priority:** Medium — pays off after ~6 months of usage data · **Estimated effort:** 1–2 weeks
> **Drafted:** May 2026 · **Trigger:** Pat (in conversation)

---

## The current state

The extraction pipeline already has **vendor learning** (in `services/VendorLearning.js`):

- When a user corrects an extraction (e.g. AI extracted `vendor_name = "Greybar Electric"` but user fixed it to `"Graybar Electric"`), the correction is stored in `vendor_profiles`
- On subsequent extractions from the same vendor, those corrections are injected as prompt hints to Claude/Ollama
- This means the AI gets better at each vendor's quirks over time without any retraining

Pat's question: "would it make sense to capture training data? lets say, it keeps the last x timesheet responses as training data for the AI, so it is more accurate? Or is there a way to keep it as a rolling average?"

## What's already happening (clarification)

The vendor-learning approach is **example-based prompting**, which is actually how modern LLMs are best taught new patterns. The system isn't fine-tuning a model — it's adding context to each request that says "here's how this vendor's documents typically look." This is more flexible than fine-tuning because:

- No retraining cycle needed (corrections are live the moment they're saved)
- Per-vendor specificity (Vendor A's quirks don't pollute Vendor B's extractions)
- Cheap and fast (a few hundred extra tokens per request, no training cost)

The vendor-profile system is currently keyed by vendor name. It captures the corrections themselves and uses them on future extractions from the same vendor.

## What could be improved

There are three layers where richer training data would help:

### Layer 1 — Per-document-type rolling examples

For each `doc_type` (`timesheet`, `invoice`, `purchase_order`), keep a rolling window of the last N successful extractions where the user confirmed without correction. Use them as few-shot examples in subsequent extractions of the same type.

**Example:** for invoice extraction, the prompt would include:
```
Here are 3 recent invoices from this firm that were extracted correctly.
Use these as examples of the typical format and field locations:

Example 1: [paste of OCR text + the extracted JSON]
Example 2: [...]
Example 3: [...]

Now extract the following invoice: [paste of new OCR text]
```

This gives the AI a baseline of "what does a typical invoice look like for this firm" before each request. Especially useful for handwritten timesheets where layouts vary by foreman but each foreman tends to use the same layout consistently.

### Layer 2 — Per-foreman timesheet examples

Same pattern as Layer 1, but scoped per-foreman. If Carlos's timesheets have a particular handwriting quirk (e.g., he writes "OT" as "O.T."), keeping his last 5 successful timesheets as examples would teach the AI to handle his specific style.

This is especially valuable for handwritten field-staff submissions where standard OCR struggles. Instead of "improve OCR" (hard), the system says to the AI "look at how this person's handwriting was previously interpreted" (easy).

### Layer 3 — Correction-pattern aggregation

Beyond per-vendor learning, watch for systemic mistakes. Examples:
- "AI consistently extracts `12.5` as `125`" → add a hint about decimal handling
- "AI consistently misses the customer signature line" → add a hint to look for it
- "AI consistently confuses 7s and 1s in handwritten dates" → add a hint about handwritten digits

These would surface in an admin UI as "patterns we've noticed" with a button to add them as global prompt hints.

## What's the right scope

**My recommendation:** start with **Layer 1 only**. It's the highest-value, lowest-complexity addition. Layer 2 adds personalization that's only worth the cost if Layer 1 isn't enough. Layer 3 is essentially a research/analytics feature.

For Layer 1:
- Add a `successful_extractions` table that keeps the last N (say 5) per `doc_type`
- When a user confirms an extraction without changing anything, store it
- When a new extraction is started, look up the most recent N successful examples of the same doc type and inject as few-shot context

## Implementation sketch (Layer 1)

### Schema

```sql
CREATE TABLE successful_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type doc_type NOT NULL,
  ocr_text TEXT NOT NULL,
  extracted_json JSONB NOT NULL,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  was_modified BOOLEAN NOT NULL  -- true if user changed any field, false if confirmed as-is
);

CREATE INDEX successful_extractions_doctype_idx
  ON successful_extractions (doc_type, confirmed_at DESC);
```

### Capture point

In `Extraction.confirm()` (the route that runs when a user confirms an extraction), check if `confirmed_data === extracted_data`. If true, the AI got it perfect — store the OCR text + extracted JSON in `successful_extractions`.

### Prompt injection

In `ExtractionService.extract()`, before sending to Claude/Ollama, query the latest 3-5 successful extractions of the same doc type and inject them as few-shot examples in the prompt.

### Pruning

Cron task: keep only the last 50 per doc_type. Older ones get deleted. (Or store all and just LIMIT 5 in the query — depends on storage cost.)

## Open design questions

1. **Should the captured examples be anonymized?** The OCR text contains real customer names, dollar amounts, etc. If the firm is OK with the data staying internal (which it would be — never leaves their server), no need. If they want to be paranoid, a redaction pass before storage is a half-day of work.

2. **Should examples be scoped per-firm in case of multi-tenant deployment?** Right now ConstructPM is single-firm-per-deployment, so no. If the platform ever becomes SaaS, yes.

3. **What's the right N?** Few-shot prompting research suggests 3-5 examples gives diminishing returns past 5. I'd start with 3 and tune.

4. **Should successful extractions be stored verbatim or distilled?** Storing OCR + JSON is honest but expensive in tokens. Distilling into "common patterns observed" via a periodic LLM pass would be cheaper but adds complexity. Verbatim is the right starting point.

## What this is NOT

- **Not fine-tuning.** Fine-tuning Claude or Llama is expensive and inflexible. Few-shot prompting accomplishes 80% of the value at 5% of the cost.
- **Not retraining the OCR layer.** Tesseract/Textract have their own training story; this refinement only affects the field-extraction layer downstream.
- **Not replacing vendor learning.** Vendor learning continues, with this new layer adding doc-type-level context on top.

## Effort estimate

- Schema + capture endpoint: 2 days
- Prompt injection + testing: 3 days
- Admin UI to view/manage saved examples: 2 days (optional but useful for debugging)
- Pruning cron: 1 day

Total: 1–2 weeks. Layer 2 (per-foreman) adds another week. Layer 3 (pattern analytics) adds 2-3 weeks.

## Why this is deferred

The vendor learning system already handles the most common improvement opportunities. The marginal accuracy gain from adding Layer 1 is probably 5-10% improvement in first-pass accuracy on common doc types. That's real but not urgent — users can still verify and correct without it.

Reactivate this when:
- Users start complaining that extractions feel "consistently wrong on the same things"
- The vendor-profile table has 50+ vendors and the system is generating useful corrections
- A real audit reveals which extraction errors are happening most frequently

---

*Update when implementation begins.*
