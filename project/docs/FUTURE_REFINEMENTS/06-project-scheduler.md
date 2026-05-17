# Future Refinement 06 — Project Scheduler

> Captured from Pat's brainstorm during the May 2026 table audit (while
> reviewing the Invoices table). Recorded here so we don't lose the
> design intent — implementation deferred until the table audit is done.
>
> Status: spec only. No code written yet.

---

## Why

Bid-won projects often sit "active" without being worked on right away. Today the system has no notion of *when* a project will actually start or how long it occupies the calendar. Without that, there's no way for the firm to:

- See what's coming up next on the board
- Spot conflicts (two projects starting the same week with overlapping personnel needs)
- Plan worker assignments across days
- Visualize crew capacity

The scheduler closes that gap with two cooperating views: a **calendar view** for projects, and a **scheduler grid** for per-worker assignments.

---

## Schema additions (prerequisite)

Two fields needed on `projects`:

| Column | Type | Source |
|---|---|---|
| `start_date` | date | User-set after bid won; empty until scheduled |
| `total_personnel` | int | Already exists (synced from bid_quote_lines) — surface in UI |

`projects.project_length_days` already exists (carried over from the bid). Combined with `start_date`, the system can compute `end_date = start_date + project_length_days` for the calendar.

A `project_schedule_overrides` table for the per-project working-day rules:

```sql
CREATE TABLE project_schedule_overrides (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  works_saturday BOOLEAN NOT NULL DEFAULT false,
  works_sunday   BOOLEAN NOT NULL DEFAULT false,
  -- Future: more granular (per-week overrides, holidays, half-days)
);
```

Default: M-F. A project's calendar card renders only on its working days. Toggling Sat/Sun extends or shrinks the displayed band accordingly.

A `worker_assignments` table for the scheduler grid:

```sql
CREATE TABLE worker_assignments (
  id UUID PRIMARY KEY,
  worker_id UUID REFERENCES users(id),  -- or a separate workers table
  project_id UUID REFERENCES projects(id),
  work_date DATE NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (worker_id, work_date, project_id)  -- one worker can be on multiple projects same day if needed
);
```

---

## UI: two new sub-tabs

### A. Schedule sub-tab — calendar view

A standard month/week calendar. Each scheduled project appears as a card spanning from `start_date` through `start_date + project_length_days`, skipping non-working days per its overrides.

Click a calendar card → opens an **edit pop-up** for that project's schedule:

- Start date (date picker)
- Length (read-only, sourced from `project_length_days`)
- Working days: ☑ M  ☑ T  ☑ W  ☑ Th  ☑ F  ☐ Sat  ☐ Sun
- Save → updates `project_schedule_overrides`, refreshes calendar

Visual rules:
- Cards color-coded by PM (or project status — TBD with Pat)
- Card label: project number + customer name
- Hover = tooltip with full project details
- Cards stack vertically when multiple projects span the same day

### B. Scheduler sub-tab — worker grid

Two further sub-views:

**By Project** view:
- Rows = projects (filtered to active + scheduled)
- Columns = days (the visible date range, scrollable horizontally)
- Cells = the workers assigned to that project on that day
- Click a cell → dropdown to add/remove workers

**By Worker** view (the primary scheduler workflow):
- Rows = workers
- Columns = days at the top of the table
- Cells = the projects that worker is assigned to on that day

Cell interactions:
- Click a cell → show dropdown of all projects scheduled for that day; pick to assign
- Click a worker name + date cell that's already populated → see all projects that worker is on for that date (the dropdown also lists them)
- **Clipboard support**: Ctrl+C on a selected cell copies its assignments; Ctrl+V pastes
- **Multi-select**: Shift+click extends a selection to span cells (only when extending to the SAME project — can't bulk-assign mixed projects from different rows)
- The bid's `total_personnel` count is **referenceable as a guideline** but not enforced — the scheduler can over- or under-allocate against the bid estimate; warnings only

---

## Notifications & integration

When triggered events happen, the scheduler should send notifications:

- Project's start date arrives → notify PM + assigned workers
- Worker assigned/unassigned → notify the worker
- Project end-date estimate exceeded (still has assignments past `start_date + project_length_days`) → notify PM

These integrate with the existing `NotificationService`.

---

## Permissions

- **Schedule view** (calendar): readable by admin, PM, accounting, scheduler role; editable by admin + scheduler
- **Scheduler view** (worker grid): readable by admin, PM, scheduler; editable by admin + scheduler
- **Workers/field_staff** see their own row in By-Worker view, read-only

A `scheduler` role already exists per `docs/TERMINOLOGY.md` — this feature is what populates it.

---

## Phasing

Suggested implementation order to deliver value incrementally:

1. **Schema + project start_date column on Projects table** (small) — surface the data even before the scheduler UI ships
2. **Calendar view (Schedule sub-tab)** — single-project edit pop-up, default M-F
3. **Working-day overrides** (Sat/Sun toggles)
4. **Scheduler grid By Project** view (read-only)
5. **Scheduler grid By Worker** view (read-only)
6. **Cell editing** (single-cell assignment)
7. **Multi-select + clipboard support**
8. **Notifications integration**

Phases 1 and 2 alone deliver a usable "what's coming up" board, which is most of the value. The grid + clipboard stuff is the second wave.

---

## Open questions for Pat (when this gets prioritized)

- "Workers" — same `users` table as field_staff role? Or a separate non-login workers list?
- Calendar default zoom (week vs month)?
- Color-coding by PM, status, or customer?
- Holidays — system-wide list, or per-project skipped dates?
- What happens when a project's start_date moves later but assignments already exist on those days?
