// Equipment Maintenance — Shop Staff mobile screen.
//
// Flow:
//   1. Scan barcode (or manual entry) → GET /equipment/barcode/:code
//   2. Show equipment header + history (GET /equipment/:id/maintenance-records)
//   3. Add entry form → POST /equipment/:id/maintenance-records
// No emails.

import { api } from '../lib/api.js';

export default {
  async mount(root, ctx) {
    const state = {
      equipment: null,
      history: [],
      form: defaultForm(ctx.session),
      manualCode: '',
      busy: false,
      error: '',
    };

    render();

    function render() {
      root.innerHTML = '';
      if (!state.equipment) renderLookup();
      else renderDetail();
    }

    function renderLookup() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="card">
          <p class="muted small" style="margin-top:0">Scan an equipment barcode or enter the ID manually to add a maintenance record.</p>
          <button class="btn block accent" data-action="scan">📷 Scan barcode</button>
          <div style="margin-top:12px"><label>Or enter manually</label><input data-field="manualCode" value="${esc(state.manualCode)}" placeholder="Barcode / serial" /></div>
          <button class="btn secondary block" data-action="lookup" style="margin-top:8px" ${state.busy ? 'disabled' : ''}>Look up</button>
          ${state.error ? `<div class="muted" style="color:var(--danger);margin-top:8px">${esc(state.error)}</div>` : ''}
        </div>
      `;
      root.appendChild(wrap);
      wrap.querySelector('[data-field="manualCode"]').oninput = (e) => { state.manualCode = e.target.value; };
      wrap.querySelector('[data-action="scan"]').onclick = scan;
      wrap.querySelector('[data-action="lookup"]').onclick = () => lookup(state.manualCode);
    }

    async function scan() {
      const { showScanner } = await import('../lib/scan.js');
      try {
        const code = await showScanner({ title: 'Scan equipment barcode' });
        await lookup(code);
      } catch (e) {
        if (e.message !== 'cancelled') ctx.toast(e.message, 'danger');
      }
    }

    async function lookup(code) {
      const c = String(code || '').trim();
      if (!c) { state.error = 'Enter a barcode or scan one'; render(); return; }
      state.busy = true; state.error = ''; render();
      try {
        const eq = await api('/equipment/barcode/' + encodeURIComponent(c));
        state.equipment = eq;
        const h = await api('/equipment/' + eq.id + '/maintenance-records').catch(() => ({ records: [] }));
        state.history = h.records || [];
      } catch (e) {
        state.error = e.message || 'Lookup failed';
      } finally {
        state.busy = false;
        render();
      }
    }

    function renderDetail() {
      const eq = state.equipment;
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <button class="btn secondary" data-action="back" style="margin-bottom:12px">← New scan</button>
        <div class="card">
          <h3 style="margin:0">${esc(eq.equipment_name || '—')}</h3>
          <div class="meta">${esc([eq.barcode_id, eq.manufacturer, eq.equipment_type].filter(Boolean).join(' • '))}</div>
          ${flagBadge(eq.flag)}
          ${eq.rolled_cert_date ? `<div class="small" style="margin-top:6px">Cert: ${esc(eq.rolled_cert_date.slice(0,10))}</div>` : ''}
          ${eq.service_date ? `<div class="small">Last service: ${esc(eq.service_date.slice(0,10))}</div>` : ''}
        </div>

        <div class="section-title">Add maintenance entry</div>
        <div class="card">
          <form data-form>
            <div><label>Date of service</label><input type="date" name="date_of_service" value="${esc(state.form.date_of_service)}" required /></div>
            <div><label>Entered by</label><input name="entered_by_name" value="${esc(state.form.entered_by_name)}" /></div>
            <div><label>Certification date (optional)</label><input type="date" name="cert_date" value="${esc(state.form.cert_date)}" /></div>
            <div><label>Flag</label>
              <select name="flag">
                <option value=""${state.form.flag === '' ? ' selected' : ''}>None</option>
                <option value="yellow"${state.form.flag === 'yellow' ? ' selected' : ''}>Yellow</option>
                <option value="red"${state.form.flag === 'red' ? ' selected' : ''}>Red</option>
              </select>
            </div>
            <div><label>Notes</label><textarea name="notes" placeholder="Work performed, parts replaced, observations…">${esc(state.form.notes)}</textarea></div>
            ${state.error ? `<div class="muted" style="color:var(--danger)">${esc(state.error)}</div>` : ''}
            <button class="btn block accent" type="submit" ${state.busy ? 'disabled' : ''}>Save record</button>
          </form>
        </div>

        <div class="section-title">History (${state.history.length})</div>
        ${state.history.length === 0 ? '<div class="muted small" style="padding:0 4px">No records yet.</div>' : ''}
        <div class="list">
          ${state.history.map(h => `
            <div class="card" style="padding:12px">
              <div class="row">
                <div class="grow">
                  <div><b>${esc((h.date_of_service || '').slice(0,10))}</b> — ${esc(h.entered_by_name || '')}</div>
                  ${h.cert_date ? `<div class="small muted">Cert: ${esc(h.cert_date.slice(0,10))}</div>` : ''}
                  ${h.notes ? `<div class="small" style="margin-top:4px">${esc(h.notes)}</div>` : ''}
                </div>
                ${flagBadge(h.flag) || ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      root.appendChild(wrap);

      wrap.querySelector('[data-action="back"]').onclick = () => {
        state.equipment = null; state.history = []; state.error = '';
        state.form = defaultForm(ctx.session);
        state.manualCode = '';
        render();
      };
      wrap.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        state.form = {
          date_of_service: f.date_of_service.value,
          entered_by_name: f.entered_by_name.value.trim(),
          cert_date: f.cert_date.value,
          flag: f.flag.value,
          notes: f.notes.value.trim(),
        };
        state.busy = true; state.error = ''; render();
        try {
          const payload = {
            date_of_service: state.form.date_of_service || null,
            entered_by_name: state.form.entered_by_name || null,
            cert_date: state.form.cert_date || null,
            notes: state.form.notes || null,
            flag: state.form.flag || null,
          };
          await api('/equipment/' + eq.id + '/maintenance-records', { method: 'POST', body: JSON.stringify(payload) });
          ctx.toast('Maintenance entry saved', 'ok');
          // Refresh history + equipment rollup.
          const fresh = await api('/equipment/barcode/' + encodeURIComponent(eq.barcode_id));
          state.equipment = fresh;
          const h = await api('/equipment/' + eq.id + '/maintenance-records').catch(() => ({ records: [] }));
          state.history = h.records || [];
          state.form = defaultForm(ctx.session);
        } catch (ex) {
          state.error = ex.message || 'Save failed';
        } finally {
          state.busy = false;
          render();
        }
      };
    }
  },
};

function defaultForm(session) {
  const u = session?.user;
  const enteredBy = u ? `${u.firstName || u.first_name || ''} ${u.lastName || u.last_name || ''}`.trim() : '';
  return {
    date_of_service: new Date().toISOString().slice(0, 10),
    entered_by_name: enteredBy,
    cert_date: '',
    flag: '',
    notes: '',
  };
}
function flagBadge(f) {
  if (f === 'red') return '<div class="badge danger" style="margin-top:6px">Red flag</div>';
  if (f === 'yellow') return '<div class="badge warn" style="margin-top:6px">Yellow flag</div>';
  return '';
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
