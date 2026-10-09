/**
 * Project date math — server-side mirror of the Schedule calendar's
 * client-side `projectOccupiesDay` rule (public/index.html ~L5594).
 *
 * `project_length_days` is counted in WORKING days, not calendar days:
 * we walk forward from `start_date`, counting only days that match the
 * project's working-day rules (M–F by default, plus Sat/Sun when the
 * project's `project_schedule_overrides` enable them, or weekend-only),
 * until we've collected `length` of them. The last working day collected
 * is the project's end date.
 *
 * Keeping this identical to the client algorithm means the crew email's
 * "runs from … to …" line lands on the same weekday the Scheduler grid
 * already paints the final card on.
 *
 * The core `computeEndDate` is a pure function (no DB) so it's trivially
 * unit-testable; `getProjectDates` is the DB-backed convenience wrapper
 * the route + compose service call.
 */

/**
 * Normalise a date value (JS Date from pg, or a 'YYYY-MM-DD[...]' string)
 * to a plain 'YYYY-MM-DD' string. pg parses `date` columns to a Date at
 * local midnight, so local getFullYear/Month/Date reconstruct the stored
 * calendar day without a timezone shift.
 */
function toYmd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Compute a project's end date.
 *
 * @param {Object} p
 * @param {Date|string}  p.start_date          project start (required for the working-day walk)
 * @param {number|null}  p.project_length_days  length in WORKING days
 * @param {Date|string}  [p.end_date]           stored end date — fallback when length is null
 * @param {boolean}      [p.works_saturday]     from project_schedule_overrides
 * @param {boolean}      [p.works_sunday]       from project_schedule_overrides
 * @param {boolean}      [p.weekend_only]       from project_schedule_overrides
 * @returns {string|null} 'YYYY-MM-DD', or null when there's nothing to anchor on.
 */
function computeEndDate(p = {}) {
  const start = toYmd(p.start_date);
  const length = parseInt(p.project_length_days, 10);

  // No usable length → fall back to the stored end_date, else the start.
  if (!start || !Number.isFinite(length) || length <= 0) {
    return toYmd(p.end_date) || start || null;
  }

  const [y, mo, d] = start.split('-').map(Number);
  let cur = new Date(y, mo - 1, d);
  let last = new Date(cur);
  let count = 0;
  // Safety cap mirrors the client (length × 10 + 7 calendar days) so
  // pathological data (e.g. zero working days configured) can't spin.
  let safety = 0;
  const cap = length * 10 + 7;
  while (count < length && safety < cap) {
    const dow = cur.getDay(); // 0=Sun … 6=Sat
    const working = p.weekend_only
      ? (dow === 0 || dow === 6)
      : (dow >= 1 && dow <= 5)
        || (dow === 0 && !!p.works_sunday)
        || (dow === 6 && !!p.works_saturday);
    if (working) {
      count++;
      last = new Date(cur);
    }
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    safety++;
  }

  return toYmd(last);
}

/**
 * DB-backed wrapper: load a project's start/end dates (formatted) plus the
 * per-project schedule overrides, and return the start + computed end.
 *
 * @param {string} projectId
 * @param {import('knex')} knexDb
 * @returns {Promise<{ start_date: string|null, end_date: string|null }>}
 */
async function getProjectDates(projectId, knexDb) {
  const project = await knexDb('projects')
    .where('id', projectId)
    .first(['start_date', 'end_date', 'project_length_days']);
  if (!project) return { start_date: null, end_date: null };

  const ov = await knexDb('project_schedule_overrides')
    .where('project_id', projectId)
    .first(['works_saturday', 'works_sunday', 'weekend_only']);

  return {
    start_date: toYmd(project.start_date),
    end_date: computeEndDate({
      start_date: project.start_date,
      end_date: project.end_date,
      project_length_days: project.project_length_days,
      works_saturday: ov?.works_saturday,
      works_sunday: ov?.works_sunday,
      weekend_only: ov?.weekend_only,
    }),
  };
}

module.exports = { computeEndDate, getProjectDates, toYmd };
