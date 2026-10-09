// projectDates.computeEndDate — the server-side mirror of the Schedule
// calendar's working-day rule (public/index.html `projectOccupiesDay`).
//
// project_length_days counts WORKING days, so the end date lands on the
// Nth working day on/after start_date (start_date itself counted as day 1
// when it is a working day), honouring the per-project Sat/Sun/weekend-only
// overrides.
//
// Calibration against the real June-2026 calendar:
//   2026-06-01 = Monday, 06-05 = Friday, 06-06 = Saturday, 06-07 = Sunday.

const { computeEndDate, toYmd } = require('../../src/services/projectDates');

describe('projectDates.computeEndDate', () => {
  it('Mon start + 5 working days (M–F) → Fri', () => {
    // 2026-06-01 Mon … 06-05 Fri (5 consecutive weekdays, start counted).
    expect(computeEndDate({ start_date: '2026-06-01', project_length_days: 5 }))
      .toBe('2026-06-05');
  });

  it('Fri start + 3 working days (M–F) → the next Tuesday', () => {
    // 2026-06-05 Fri(1) → skip Sat/Sun → 06-08 Mon(2) → 06-09 Tue(3).
    // The issue text labels this "Wed", but the authoritative
    // projectOccupiesDay rule (inclusive, start counted) lands on Tue —
    // consistent with Mon+5→Fri and the works_saturday case below.
    expect(computeEndDate({ start_date: '2026-06-05', project_length_days: 3 }))
      .toBe('2026-06-09');
  });

  it('Fri start + 3 working days with works_saturday → Mon', () => {
    // 2026-06-05 Fri(1) → 06-06 Sat(2) → skip Sun → 06-08 Mon(3).
    expect(computeEndDate({
      start_date: '2026-06-05',
      project_length_days: 3,
      works_saturday: true,
    })).toBe('2026-06-08');
  });

  it('weekend_only Sat start + 3 working days → the next Sat', () => {
    // 2026-06-06 Sat(1) → 06-07 Sun(2) → 06-13 Sat(3).
    expect(computeEndDate({
      start_date: '2026-06-06',
      project_length_days: 3,
      weekend_only: true,
    })).toBe('2026-06-13');
  });

  it('null length with end_date set → end_date', () => {
    expect(computeEndDate({
      start_date: '2026-06-01',
      project_length_days: null,
      end_date: '2026-07-15',
    })).toBe('2026-07-15');
  });

  it('null length and no end_date → start_date', () => {
    expect(computeEndDate({ start_date: '2026-06-01', project_length_days: null }))
      .toBe('2026-06-01');
  });

  it('works_sunday extends the working set across Sundays', () => {
    // 2026-06-05 Fri(1) → 06-07 Sun(2, works_sunday) → skip Sat(06-06)
    // → 06-08 Mon(3). (Sunday counts, Saturday does not.)
    expect(computeEndDate({
      start_date: '2026-06-05',
      project_length_days: 3,
      works_sunday: true,
    })).toBe('2026-06-08');
  });

  it('accepts a JS Date (as pg returns DATE columns) for start_date', () => {
    expect(computeEndDate({ start_date: new Date(2026, 5, 1), project_length_days: 5 }))
      .toBe('2026-06-05');
  });

  it('length of 1 returns the start day itself', () => {
    expect(computeEndDate({ start_date: '2026-06-01', project_length_days: 1 }))
      .toBe('2026-06-01');
  });

  it('no start_date falls back to end_date, else null', () => {
    expect(computeEndDate({ end_date: '2026-07-15' })).toBe('2026-07-15');
    expect(computeEndDate({})).toBeNull();
  });
});

describe('projectDates.toYmd', () => {
  it('formats a JS Date using local calendar components', () => {
    expect(toYmd(new Date(2026, 5, 1))).toBe('2026-06-01');
  });

  it('trims a longer date string to YYYY-MM-DD', () => {
    expect(toYmd('2026-06-01T00:00:00.000Z')).toBe('2026-06-01');
  });

  it('returns null for empty / unparseable input', () => {
    expect(toYmd(null)).toBeNull();
    expect(toYmd('')).toBeNull();
    expect(toYmd('not-a-date')).toBeNull();
  });
});
