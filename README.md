# ConstructPM — System Diagrams

> Four reference diagrams for onboarding and debugging. Open the `.svg`
> files in any browser, or embed them in docs. Generated 2026-05-17.

These exist for two situations:
1. **Onboarding after time away** — start with `02_architecture.svg`
   to reload the mental model of how the pieces fit.
2. **Debugging a wrong value mid-flow** — use `01_data_pipeline.svg`
   to find which stage to inspect, then the relevant detail diagram.

---

## 01 — Data pipeline (`01_data_pipeline.svg`)

Traces data from bid creation → quote/rate-lock → won/quick-project →
project → scheduler → equipment ticket → archive/PDF.

**The two side boxes are the trouble spots:**
- **Rate sheet** — feeds the quote table via `RateSheet.getByLocal`
  (fuzzy local-union match). If a bid shows $0 rates, inspect here.
- **Financials** — invoices + POs roll up into project revenue/cost
  by SUM over the same tables. If a project total looks wrong, the
  bare-entry invoice/PO records are the first thing to check.

Highest-leverage diagram for "this number is wrong" bugs.

## 02 — Architecture (`02_architecture.svg`)

The layered stack: vanilla JS SPA → Express routes → models/services
→ PostgreSQL. The two amber boxes (feature flags, notifications) are
**cross-cutting** — they touch every layer rather than sitting in the
stack. That's why the tab-bleed and notification bugs were tricky:
they don't live in one place.

Best diagram for reorienting after time off.

## 03 — Bid → schedule sequence (`03_bid_to_schedule_sequence.svg`)

Time-ordered: PM marks won → bids route → DB inserts project +
manpower → generates project number → fires schedule notification →
PM clicks notification → schedule modal opens directly.

The **red band** is the known failure point: when the PM edits their
own project the schedule notification is a self-notification and may
not surface. The notification logic itself is correct — this is why
"I set the date and saw nothing" was not a logic bug.

## 04 — Equipment ticket states (`04_equipment_ticket_states.svg`)

Open → Filled → Picked up → Archived, plus the Reconfirm path.

Two transitions to watch when testing the (newest) equipment code:
- **Filled → Open**: any add/remove edit unpicks the ticket.
- **Reconfirm**: regenerates the PDF *without* archiving — distinct
  from the authoritative Picked up → Archived path which deletes the
  live rows.

---

## Keeping these current

When a flow changes materially, regenerate the affected diagram. The
SVGs are hand-authored (plain SVG, no build step) so they can be
edited directly or re-requested. Handing a future session the
architecture or pipeline diagram is a tight spec to build against and
saves a lot of back-and-forth.
