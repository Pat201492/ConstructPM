# Plan: "Weekend only" scheduler option

Branch: `feat/weekend-only-schedule`
Worktree: `Project_Management_Software_weekend_only/`

## Why

Some projects (tenant-occupied retail spaces, weekend pour windows, etc.) can
only be worked Saturday + Sunday. Today the scheduler defaults to M-F and lets
the user *add* Sat and/or Sun on top. There is no way to say "only weekends" —
M-F is hardcoded as always-working.

A "Weekend only" mode reverses the M-F default: when set, the project schedules
on Sat + Sun and skips Mon-Fri.

## Scope

In scope:
- New `weekend_only` boolean column on `project_schedule_overrides` (default false).
- Backend: GET `/projects/:id/schedule` returns it; PATCH accepts it; `/projects/scheduled-list` selects it.
- Frontend: a third checkbox on the Schedule edit modal — "Weekend only (Sat + Sun, skip Mon-Fri)". When checked, the Sat/Sun checkboxes are visually disabled (they're irrelevant — both days work).
- Frontend: working-day computation in both `renderSchedule` (Schedule tab) and `renderScheduler` (Scheduler grid) honors the flag.

Out of scope:
- Replacing the current Sat/Sun toggles with a radio-button mode picker.
- Per-day arbitrary working-day patterns (e.g. "Tue + Thu only").
- Worker-assignment-side filtering — `worker_assignments` stays independent of working-day rules.

## File-by-file

| File | Change |
|------|--------|
| `project/migrations/20260518_015_project_weekend_only.js` | NEW — adds `weekend_only` boolean column on `project_schedule_overrides` (default false). Idempotent up/down. |
| `project/src/routes/projects.js` | (a) `/scheduled-list` selects `project_schedule_overrides.weekend_only`. (b) GET `/:id/schedule` returns it (default false). (c) PATCH `/:id/schedule` accepts `weekend_only` and upserts it. |
| `project/public/index.html` | (a) `renderSchedule` working-day check at ~5167 honors weekend_only. (b) Same change in `renderScheduler` at ~5543. (c) Edit modal at ~5289: add "Weekend only" checkbox; change handler disables Sat/Sun checkboxes when active. (d) PATCH body includes `weekend_only`. (e) Legend text updated. |

## Logic

```js
const weekendOnly = !!p.weekend_only;
const isWorking = weekendOnly
  ? (dow === 0 || dow === 6)
  : (dow >= 1 && dow <= 5)
    || (dow === 0 && !!p.works_sunday)
    || (dow === 6 && !!p.works_saturday);
```

When `weekend_only` is true, `works_saturday` / `works_sunday` are ignored. The
columns are kept (not zeroed) so toggling weekend-only off restores prior
Sat/Sun preferences without data loss.

## Risks considered

- **`project_length_days` interpretation:** length is in *working* days. A 10-day weekend-only project spans 5 weeks. Loop safety cap (`length * 10 + 7`) is plenty.
- **scheduled-list SQL prefilter:** the SQL multiplies length by 2 as a coarse pre-filter (M-F gives 7/5 ratio, but the multiplier covers it). For weekend-only the ratio is 7/2 = 3.5, so the `× 2` window is too tight. Workaround: bump the multiplier when any project is weekend-only — or, simpler for v1, accept that a weekend-only project starting far enough out could be excluded from the calendar list. Frontend per-cell membership still works for visible projects. Note for follow-up.
- **Three-state UI confusion:** Sat/Sun checkboxes still render when weekend_only is on. We disable them to make the override obvious. If still confusing, follow-up with a radio mode picker.
- **Schema rollback:** the down migration drops the column. Any data in it is lost on rollback, matching existing migration style.

## Verification

1. `docker compose up -d` from `project/`.
2. Open the app, dev login (`admin@company.com` / `ChangeMe123!`).
3. Open Schedule tab calendar, click a project card → edit pop-up.
4. Toggle "Weekend only" → Save → calendar re-renders with cards only on Sat + Sun cells.
5. Untoggle → reverts to M-F (plus any Sat/Sun overrides).
6. `GET /api/projects/:id/schedule` round-trips `weekend_only`.
7. Same visual check on the Scheduler grid tab.
