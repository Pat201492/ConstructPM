# ConstructPM — Quick Reference Card

## In one sentence

Self-hosted construction PM platform for an electrical contracting firm — replaces Procore/eMaint via a custom Node/Postgres/SPA stack with local AI extraction (Ollama + Tesseract) for invoice/timesheet/PO digitization.

## Three-tier hierarchy (terminology)

```
Firm  =  the contractor running this platform (one per deployment)
Customer  =  the firm's clients (Turner, school districts, owners)
Location  =  jobsite address
```

Bid joins Customer + Location. Won bid → Project. PMs own projects.

## Six roles

`admin` · `project_manager` · `estimator` · `accounting` · `shop_staff` · `field_staff` (mobile only) · `scheduler` (placeholder)

## Stack

Node 20 · Express 5 · PostgreSQL 16 · Redis 7 · Knex · JWT · Tesseract.js · Ollama (llama3:8b) · Claude API fallback · ExcelJS · pdf-lib · Vanilla JS SPA · React Native (mobile)

## Run it (Pat's PowerShell)

```powershell
cd "C:\Users\pegan\OneDrive\Desktop\Python\Project_Management_Software\project"
docker compose down -v
cd ..; Remove-Item -Recurse -Force project
tar -xzf "C:\Users\pegan\Downloads\construction_pm_v2_fixed.tar.gz"
cd project; docker compose up --build
```

App at `http://localhost:3000`. Admin: `admin@company.com` / `ChangeMe123!`

## Key files

- `HANDOFF_PACKAGE.md` — full project doc (read this for full context)
- `docs/TERMINOLOGY.md` — glossary (use this when terminology questions arise)
- `docs/FUTURE_REFINEMENTS/` — 5 deferred-feature design docs (refinements 01-05)
- `migrations/` — 68 files, run in filename order at boot. A few share a numeric prefix (e.g. two `20260517_001_*`); Knex keys off the full filename, so each runs once in deterministic lexical order — harmless, do not rename already-applied migrations.
- `public/index.html` — single-file SPA, no build step
- `src/services/PdfStampService.js` — adds platform number stamps to filed PDFs

## Critical gotcha

Postgres: cannot use a new enum value in the same transaction that added it. Migration must split into:
1. Add value with `exports.config = { transaction: false }`
2. Use the value in the next migration (separate file)

See `migrations/20260505_002a_enum_additions.js` for the pattern.

## Latest active topics (where the conversation left off)

1. Vendor quote → PO draft flow (built)
2. Inbox renumbering: platform always assigns canonical number (`INV-<ProjectNumber>-<Seq>`); source-doc number kept in `external_reference`
3. PDF stamping on inbox-uploaded invoices/POs (single-line, semi-transparent, top-right)
4. Deferred: PO/invoice walkthrough (Pat asked, not yet done)

## Build state

34/34 tests passing · 1 skipped (storage backend files don't exist as separate modules — pre-existing tech debt) · Latest tarball deploys cleanly through all 68 migrations
