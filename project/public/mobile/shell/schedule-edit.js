// Mobile schedule popup — mirror of desktop showScheduleEditPopup.
//
// Reached via tap on a project_schedule notification in the bell, or
// directly via openScheduleEdit(projectId, onSaved). Renders a
// full-screen overlay on top of whatever screen is mounted; closes back
// to that screen on save/cancel. No route registration — invoked
// imperatively so it works from any screen without hash-routing the
// projectId.
//
// Fields:
//   - start_date         (date input)
//   - project_length_days (number)
//   - manpower           (number)
//   - works_saturday     (toggle)
//   - works_sunday       (toggle)
//   - weekend_only       (toggle, exclusive with the two above)
//
// Save → PATCH /projects/:id  (start_date, length, manpower)
//      + PATCH /projects/:id/schedule  (working-day overrides)
// Both fire sequentially. If the first fails, the second is skipped
// and the error surfaces; partial saves are minimised but not
// transactional across the two endpoints.

import { api } from '../lib/api.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const fmtDate = (d) => { if (!d) return ''; const s = String(d); return s.length >= 10 ? s.slice(0, 10) : s; };

let activeOverlay = null;

export async function openScheduleEdit(projectId, { onSaved, toast } = {}) {
  if (!projectId) return;
  // Only one schedule overlay at a time — close any existing first so
  // tapping a second notification while one is open doesn't stack.
  if (activeOverlay) { activeOverlay.remove(); activeOverlay = null; }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:60;display:flex;align-items:flex-end';
  overlay.innerHTML = `<div data-sheet style="background:var(--surface);width:100%;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:20px;padding-bottom:calc(20px + var(--safe-bot))"><div class="boot"><div class="spinner"></div></div></div>`;
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  const sheet = overlay.querySelector('[data-sheet]');

  // Tapping the dim area (outside the sheet) cancels.
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  // Load project + schedule in parallel.
  let project, sched;
  try {
    [project, sched] = await Promise.all([
      api('/projects/' + projectId).then(r => r.project || r),
      api('/projects/' + projectId + '/schedule').catch(() => ({ works_saturday: false, works_sunday: false, weekend_only: false })),
    ]);
  } catch (e) {
    sheet.innerHTML = `<div class="empty"><div class="ico">⚠️</div><div>${esc(e.message || 'Failed to load')}</div><button class="btn secondary" style="margin-top:12px" data-close>Close</button></div>`;
    sheet.querySelector('[data-close]').onclick = close;
    return;
  }

  const state = {
    start_date: fmtDate(project.start_date),
    project_length_days: project.project_length_days ?? '',
    manpower: project.manpower ?? '',
    works_saturday: !!sched.works_saturday,
    works_sunday: !!sched.works_sunday,
    weekend_only: !!sched.weekend_only,
    busy: false,
    error: '',
  };

  render();

  function render() {
    sheet.innerHTML = `
      <div class="row" style="align-items:center;margin-bottom:12px">
        <h3 style="margin:0" class="grow">Schedule</h3>
        <button class="btn secondary" data-close ${state.busy ? 'disabled' : ''}>Close</button>
      </div>
      <div class="muted small" style="margin-bottom:12px">${esc(project.name || '')}${project.primary_number ? ' — ' + esc(project.primary_number) : ''}</div>

      <div><label>Start date</label><input type="date" data-f="start_date" value="${esc(state.start_date)}" /></div>
      <div class="row" style="gap:8px;margin-top:8px">
        <div class="grow"><label>Project length (days)</label><input type="number" inputmode="numeric" min="0" data-f="project_length_days" value="${esc(state.project_length_days)}" /></div>
        <div class="grow"><label>Manpower</label><input type="number" inputmode="numeric" min="0" data-f="manpower" value="${esc(state.manpower)}" /></div>
      </div>

      <div class="section-title" style="margin-top:16px">Working days</div>
      <div class="card" style="padding:12px">
        ${toggleRow('works_saturday', 'Saturdays', state.works_saturday)}
        ${toggleRow('works_sunday',   'Sundays',   state.works_sunday)}
        ${toggleRow('weekend_only',   'Weekend only', state.weekend_only)}
      </div>

      ${state.error ? `<div class="muted" style="color:var(--danger);margin-top:8px">${esc(state.error)}</div>` : ''}

      <button class="btn block accent" data-save style="margin-top:16px" ${state.busy ? 'disabled' : ''}>Save schedule</button>
    `;
    sheet.querySelector('[data-close]').onclick = close;
    sheet.querySelectorAll('[data-f]').forEach(el => {
      el.oninput = () => { state[el.dataset.f] = el.value; };
    });
    sheet.querySelectorAll('[data-toggle]').forEach(t => {
      t.onchange = () => { state[t.dataset.toggle] = t.checked; render(); };
    });
    sheet.querySelector('[data-save]').onclick = save;
  }

  function toggleRow(key, label, checked) {
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:6px 0;min-height:var(--tap)">
        <input type="checkbox" data-toggle="${esc(key)}" ${checked ? 'checked' : ''} style="width:20px;height:20px;min-height:0" />
        <span class="grow">${esc(label)}</span>
      </label>
    `;
  }

  async function save() {
    state.busy = true; state.error = ''; render();
    try {
      // PATCH the project body first (start_date / length / manpower).
      // If this fails we don't touch the schedule overrides — the user
      // sees the original data on retry, no half-applied state.
      const projectPayload = {
        start_date: state.start_date || null,
        project_length_days: state.project_length_days === '' ? null : (parseInt(state.project_length_days, 10) || 0),
        manpower: state.manpower === '' ? null : (parseInt(state.manpower, 10) || 0),
      };
      await api('/projects/' + projectId, { method: 'PATCH', body: JSON.stringify(projectPayload) });
      await api('/projects/' + projectId + '/schedule', { method: 'PATCH', body: JSON.stringify({
        works_saturday: state.works_saturday,
        works_sunday: state.works_sunday,
        weekend_only: state.weekend_only,
      })});
      toast?.('Schedule saved', 'ok');
      onSaved?.();
      close();
    } catch (e) {
      state.error = e.message || 'Save failed';
      state.busy = false;
      render();
    }
  }

  function close() {
    if (activeOverlay === overlay) activeOverlay = null;
    overlay.remove();
  }
}
