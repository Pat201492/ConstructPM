# CLAUDE.md

Conventions and onboarding entry point for ConstructPM. Read this first, then
[`PROJECT_REFERENCE.md`](PROJECT_REFERENCE.md) for the full architecture,
metrics, schema, and file inventory.

## Repository boundary — root vs `project/`

- The **repository root is a handoff wrapper.** It holds only documentation:
  `README.md`, `PROJECT_REFERENCE.md` (authoritative reference), this file,
  `HANDOFF_PACKAGE.md`, `MOBILE_APP_REFERENCE.md`, `TESTING.md`, `DEPLOY.md`,
  and similar topic docs.
- **The application lives entirely in [`project/`](project/).** All code,
  migrations, seeds, tests, Docker config, and the web + mobile apps are there.
  Run every build/test/migrate command from inside `project/`.

## Layout of `project/`

```
project/
├── src/
│   ├── app.js          # Express app + all route mounts
│   ├── server.js       # HTTP + Socket.IO startup
│   ├── config/         # database (Knex), roles (RBAC), aiConfig, aiPresets
│   ├── middleware/      # authenticate (JWT), authorize (RBAC), errorHandler
│   ├── models/         # one class per table; data access lives here
│   ├── routes/         # one file per resource, mounted in app.js
│   └── services/       # business logic, AI pipeline, exports, email, storage/
├── migrations/         # Knex migrations, run in filename order
├── seeds/              # 001_admin_user.js, 002_test_data.js
├── public/             # index.html (web SPA), display.html (kiosk), mobile/ (PWA)
├── mobile/             # React Native / Expo app
├── templates/defaults/ # default .docx bid/invoice/timesheet templates
├── tests/              # unit/ and integration/ (Jest)
└── docs/               # TERMINOLOGY.md, diagrams/, FUTURE_REFINEMENTS/
```

## Conventions

- **Frontend is vanilla JS with no build step.** The web app is a single large
  file, `project/public/index.html` (~600 KB), plus `display.html` for the
  kiosk board and `public/mobile/` for the PWA. Do not introduce a bundler,
  framework, or transpile step — edit the HTML/JS directly.
- **Backend is Node.js 20 + Express 5**, plain CommonJS (`require`/
  `module.exports`). There is no TypeScript and no typecheck step.
- **Database is PostgreSQL 16 via Knex.** Schema changes are always a new
  migration in `project/migrations/` named `YYYYMMDD_NNN_description.js`; they
  run in filename order. Never edit an already-shipped migration — add a new
  one. Postgres caveat: a new enum value added with `ALTER TYPE ... ADD VALUE`
  cannot be used in the same transaction, so split "add value" and "use value"
  into separate migrations (see `HANDOFF_PACKAGE.md` §8).
- **Models** (`src/models/`) own data access; **routes** (`src/routes/`, one
  file per resource) stay thin and are mounted in `src/app.js`; cross-cutting
  logic lives in **services** (`src/services/`), with the storage abstraction in
  `src/services/storage/`.
- **Auth is JWT** (short access + long refresh); route access is gated by the
  `authorize()` middleware against the permission matrix in
  `src/config/roles.js`.
- **AI extraction pipeline**: Tesseract OCR (→ AWS Textract fallback) then
  Ollama `llama3:8b` (→ Claude API fallback), configured via `AI_PRESET` /
  `src/config/aiConfig.js`.

## Tests

Jest, run from `project/`:

```bash
npm run test:unit          # unit suites — no database required
npm run test:integration   # integration suites — need a Postgres test DB
npm test                   # everything (jest --runInBand)
```

`npm run test:setup-db` provisions the integration test database. Unit tests are
the default gate; keep them green. There is no lint or typecheck script.

## Terminology

Use the glossary in `project/docs/TERMINOLOGY.md`. The core hierarchy is
**Firm → Customer → Location**; a bid joins one customer with one location, and a
won bid becomes a project.
