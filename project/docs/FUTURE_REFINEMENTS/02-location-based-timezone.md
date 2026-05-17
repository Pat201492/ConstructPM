# Future Refinement — Location-Based Timezone for Records

> **Status:** Backlog · **Priority:** Medium — firm IS multi-timezone, but author-from-phone covers the common case · **Estimated effort:** 1–2 days
> **Drafted:** May 2026 · **Trigger:** Pat (in conversation, after author-timezone implementation)

---

## The context

Field notes already capture and display the **author's** timezone. When a foreman writes a note, the IANA timezone of their phone gets stored on the row, and readers see the date/time formatted in that author's clock with an `(author's local time)` label.

**Important update from initial drafting:** This firm is NJ-headquartered but their **jobsites** span the entire US plus the Bahamas — not NJ-only as I had originally assumed when this doc was first written. That changes the priority of this refinement from "low" to "medium." Author-from-phone still works for the common case (foreman is physically at the jobsite, so phone tz === jobsite tz), but breaks in the case where a foreman travels from one timezone to write notes about a project in another. Concrete examples:

- NJ-based foreman flies to a TX jobsite for a week. Their phone is on Central time during the trip → notes correctly show CST.
- NJ-based foreman comes home, then writes a note from home about something that happened at the TX jobsite → note shows EST, but the events happened in CST.
- NJ-based foreman writes a note about a Bahamas jobsite while on the plane back → tz is whatever the phone happened to grab.

The author-from-phone approach is **mostly right, sometimes wrong.** Location-based would be **always right** but requires the data-model investment.

The question raised was: should the timezone be derived from the **project's location** instead?

For a firm where every foreman, every PM, and every jobsite are in the same timezone, this distinction is invisible — the displayed time is identical either way. But it diverges in two scenarios worth documenting before the deferred decision gets re-litigated months from now.

---

## Why location-based is conceptually more correct

**Construction events happen at jobsites, not at people.** A note that says "Inspector arrived at 2 PM" is meaningful only in the jobsite's clock. The author's home timezone, the reader's current timezone, and any other clock are all incidental — what matters is what time it was *at the location where the work happened*.

Concrete examples:
- "Concrete pour started 6 AM" — only sensible in jobsite time
- "Crew dismissed for storm 11 AM to 1 PM" — only sensible in jobsite time
- "Inspector scheduled tomorrow 2 PM" — even though this is a future event, the foreman wrote "2 PM" meaning local-jobsite-2 PM

Location-based timezone display gets all of these right automatically. Author-based display gets them right *only when the author is physically at the jobsite*, which is the common case but not universal.

## The edge case that breaks author-based display

A foreman from NJ flies to a TX jobsite for a one-week assignment. They write notes during the week.

Under the current author-based system:
- The foreman's device timezone (or stored `default_timezone`) is `America/New_York`
- The note saves with `author_timezone = America/New_York`
- A PM reading the note later sees "2 PM EST"
- But the foreman was actually in Texas when they wrote it. The local jobsite time was 1 PM CST.
- "Inspector arrived at 2 PM" is now ambiguous: 2 PM Eastern or 2 PM jobsite?

Under location-based display, the note would show "1 PM CST" — the actual jobsite clock, regardless of where the foreman was hailing from.

## Why we deferred this

Two reasons:

1. **The author-from-phone approach is already shipped and works for the common case.** A foreman writing a note while standing at the jobsite — which is the overwhelmingly common case — already gets the correct jobsite time, because their phone's timezone is the jobsite's timezone in that moment. Location-based display would produce identical output for those notes. The improvement is real but incremental, not transformative.

2. **Schema simplicity.** Adding `locations.timezone` requires a migration, a backfill applying a static state→timezone map to existing locations, a new column in seed data, and a join in the field-notes display query. Pat explicitly said "stop adding columns" mid-conversation. That signal is worth respecting.

Pat is aware of the multi-timezone operations (US-wide + Bahamas) and has consciously chosen "good enough for now" over "always right." This is a reasonable engineering tradeoff given the limited frequency of the failure case (foreman writing notes from outside the jobsite's timezone).

## When to revisit

Reactivate this refinement when **any** of the following becomes true:

- A foreman, PM, or admin reports confusion over a note's timezone — the smoke signal that the failure case has happened in production
- The firm starts asking "when exactly was this written" for legal/audit reasons (insurance claims, OSHA documentation, etc.)
- Multiple notes per week are being written from a different timezone than the project's location (rather than the rare exception)
- The firm formalizes "office documentation" workflows where PMs in NJ write notes about projects in TX/FL/Bahamas from their desk
- The platform is sold to another firm where the multi-timezone gap matters more (e.g. headquartered in one state, operating in another full-time)

## Implementation sketch (for when this is reactivated)

### Data model change

Add one column:

```js
exports.up = async function (knex) {
  await knex.schema.alterTable('locations', (t) => {
    t.string('timezone', 50); // IANA name, e.g. 'America/New_York'
  });
  // Backfill using static state→timezone map (see below)
  const locations = await knex('locations').whereNull('timezone');
  for (const loc of locations) {
    const tz = stateToTimezone(loc.state) || 'America/New_York';
    await knex('locations').where({ id: loc.id }).update({ timezone: tz });
  }
};
```

Keep `field_notes.author_timezone` as-is for backward compatibility — old notes still have meaningful tz data, and new notes will reference location.timezone via the project relationship.

### Static state/territory/country-to-timezone map

99% accuracy with zero recurring cost. About 80 lines of JavaScript:

```js
// src/util/timezone.js
const STATE_TO_TIMEZONE = {
  // Eastern
  'CT':'America/New_York', 'DE':'America/New_York', 'GA':'America/New_York',
  'MA':'America/New_York', 'MD':'America/New_York', 'ME':'America/New_York',
  'NC':'America/New_York', 'NH':'America/New_York', 'NJ':'America/New_York',
  'NY':'America/New_York', 'OH':'America/New_York', 'PA':'America/New_York',
  'RI':'America/New_York', 'SC':'America/New_York', 'VA':'America/New_York',
  'VT':'America/New_York', 'WV':'America/New_York', 'DC':'America/New_York',
  // Central
  'AL':'America/Chicago', 'AR':'America/Chicago', 'IA':'America/Chicago',
  'IL':'America/Chicago', 'LA':'America/Chicago', 'MN':'America/Chicago',
  'MO':'America/Chicago', 'MS':'America/Chicago', 'OK':'America/Chicago',
  'TX':'America/Chicago', 'WI':'America/Chicago',
  // Mountain
  'AZ':'America/Phoenix', // No DST
  'CO':'America/Denver', 'MT':'America/Denver', 'NM':'America/Denver',
  'UT':'America/Denver', 'WY':'America/Denver',
  // Pacific
  'CA':'America/Los_Angeles', 'NV':'America/Los_Angeles',
  'OR':'America/Los_Angeles', 'WA':'America/Los_Angeles',
  // Alaska / Hawaii
  'AK':'America/Anchorage', 'HI':'Pacific/Honolulu',
  // Multi-zone states default to most populous zone
  'FL':'America/New_York',  // Most of FL is Eastern; western panhandle is Central
  'IN':'America/New_York',  // Most of IN is Eastern; a few western counties are Central
  'KS':'America/Chicago',   // Most of KS is Central; a few western counties are Mountain
  'KY':'America/New_York',  // Most of KY is Eastern; a few western counties are Central
  'MI':'America/New_York',  // Most of MI is Eastern; UP western counties are Central
  'NE':'America/Chicago',   // Most of NE is Central; western panhandle is Mountain
  'ND':'America/Chicago',   // Most of ND is Central; some western counties are Mountain
  'SD':'America/Chicago',   // Most of SD is Central; some western counties are Mountain
  'TN':'America/Chicago',   // Most of TN is Central; eastern counties are Eastern
  'ID':'America/Boise',     // Most of ID is Mountain; northern panhandle is Pacific

  // US Territories
  'PR':'America/Puerto_Rico',  // Atlantic, no DST
  'VI':'America/St_Thomas',    // US Virgin Islands — Atlantic, no DST
  'GU':'Pacific/Guam',         // No DST

  // International — Caribbean (firm operates here)
  // Use country code or write 'BS' for Bahamas in the state field
  'BS':'America/Nassau',       // Bahamas — Eastern equivalent, observes DST
  'KY':'America/Cayman',       // CONFLICT with Kentucky — see note below; use country code 'CYM' instead if needed
  'JM':'America/Jamaica',      // No DST
  'DO':'America/Santo_Domingo',
  'CU':'America/Havana',
  'TC':'America/Grand_Turk',   // Turks and Caicos
};

function stateToTimezone(state) {
  if (!state) return null;
  return STATE_TO_TIMEZONE[String(state).toUpperCase().trim()] || null;
}

module.exports = { stateToTimezone, STATE_TO_TIMEZONE };
```

**Important note on the location form:** when this gets implemented, the location form needs to disambiguate "state" from "country code." Because Kentucky and Cayman Islands both use `KY`, the simplest fix is to add a separate `country` field on the location, or normalize to ISO country codes. The static map above uses `BS`, `JM`, etc., for Caribbean nations, but `KY` for Kentucky takes precedence in the table — Cayman Islands locations must be entered with a different code or the location form must support a country-aware lookup.

Edge cases (~3 known) that the static map handles imperfectly:
- **El Paso, TX** — actually Mountain time, but TX defaults to Central
- **Most of Florida panhandle** — actually Central time, but FL defaults to Eastern
- **Northern Idaho** — actually Pacific time, but ID defaults to Mountain

These can be fixed by allowing admin to override the timezone per-location. The override field is included in the spec but not yet built. For a firm whose jobsites are all in one timezone, this issue is moot.

### Display change

The frontend `fmtDtClick(date, opts)` already accepts an optional `tz` argument. Switching from author to location is just changing the source of that argument:

```js
// Before (current, author-based)
fmtDtClick(note.note_date, {tz: note.author_timezone, label: "Author's local time"})

// After (location-based)
fmtDtClick(note.note_date, {tz: project.location.timezone, label: "Jobsite local time"})
```

The backend response for `recent_notes` and `/field-notes` endpoints would need to include `location_timezone` (or the timezone resolved server-side onto the note). Light backend change — one extra JOIN on the existing query.

### Bonus: extend to invoices and POs

The same `tz` arg works for invoices and POs. The financial routes already attach `project_id` per row; adding `location_timezone` to the response is a 3-line backend change. This was discussed and explicitly deferred at the same time, but the path to enable it is identical to field notes.

---

## What this is NOT

Just to be clear about scope:

- **Not a global "everything in jobsite time" change.** Notifications, audit logs, and login timestamps all stay in viewer's local time — those are system events, not jobsite events. Only records *about* on-site work get jobsite-time treatment.
- **Not a replacement for the date inputs on forms.** When a user types a date into a `<input type="date">`, that's still the user's intent in plain calendar form. Doesn't need timezone wrapping.
- **Not multi-tenancy.** Every record still belongs to exactly one location, exactly one timezone.

---

## Summary of the deferred decision

| Aspect | Current (author-based) | Future (location-based) |
|---|---|---|
| Data captured | `field_notes.author_timezone` | `locations.timezone` |
| Display format | `MM/DD/YY` + `(author's local time)` on click | `MM/DD/YY` + `(jobsite local time)` on click |
| For a single-timezone-jobsite firm | Works correctly | Works correctly (identical output) |
| For traveling foremen | Shows author's home tz, not jobsite | Shows jobsite tz |
| For multi-state customers | Each note's tz can differ within one project | Consistent tz per project |
| Implementation cost | Already done | 1–2 days |
| Recurring cost | $0 | $0 (static map) |
| Schema additions | 0 (already shipped) | 1 column on `locations` |

**Decision: deferred.** Author-based works for the current firm's deployment. Location-based is conceptually superior and is the path to choose if the firm's jobsites ever consistently span multiple timezones (which they already do for travel work, but not yet at the volume to justify the schema change).

---

*Update this document when implementation begins or when revisiting the decision.*
