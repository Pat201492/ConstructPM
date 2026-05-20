// Equipment Entry — Shop Staff mobile screen.
//
// Scan a barcode → form pre-fills barcode_id → user fills required fields
// (manufacturer, equipment_name, equipment_type, equipment_subtype) plus
// optional cert date → POST /equipment/mobile/entry upserts. No email.

import { api } from '../lib/api.js';

export default {
  async mount(root, ctx) {
    const state = {
      step: 'scan', // 'scan' | 'form'
      form: emptyForm(),
      eqOptions: { items: [] },
      busy: false,
      error: '',
    };

    // Prefetch options for the datalists (types/subtypes/names suggestions).
    api('/equipment-tickets/equipment-options')
      .then(opts => { state.eqOptions = opts; render(); })
      .catch(() => {});

    render();

    function render() {
      root.innerHTML = '';
      if (state.step === 'scan') renderScan();
      else renderForm();
    }

    function renderScan() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="card">
          <p class="muted small" style="margin-top:0">Scan a barcode to start a new equipment entry. If the barcode is already in the database, the entry will be updated.</p>
          <button class="btn block accent" data-action="scan">📷 Scan barcode</button>
          <div style="margin-top:12px"><label>Or enter manually</label><input data-field="manualCode" value="${esc(state.form.barcode_id)}" placeholder="Barcode / serial" /></div>
          <button class="btn secondary block" data-action="manual" style="margin-top:8px">Continue manually</button>
          ${state.error ? `<div class="muted" style="color:var(--danger);margin-top:8px">${esc(state.error)}</div>` : ''}
        </div>
      `;
      root.appendChild(wrap);
      wrap.querySelector('[data-action="scan"]').onclick = doScan;
      wrap.querySelector('[data-action="manual"]').onclick = () => {
        const code = wrap.querySelector('[data-field="manualCode"]').value.trim();
        if (!code) { state.error = 'Enter a barcode'; render(); return; }
        startForm(code);
      };
    }

    async function doScan() {
      const { showScanner } = await import('../lib/scan.js');
      try {
        const code = await showScanner({ title: 'Scan new equipment' });
        await startForm(code);
      } catch (e) {
        if (e.message !== 'cancelled') ctx.toast(e.message, 'danger');
      }
    }

    async function startForm(code) {
      // Pre-fill from existing equipment if barcode already in DB.
      state.form = emptyForm();
      state.form.barcode_id = code;
      try {
        const existing = await api('/equipment/barcode/' + encodeURIComponent(code));
        state.form.manufacturer = existing.manufacturer || '';
        state.form.equipment_name = existing.equipment_name || '';
        state.form.equipment_type = existing.equipment_type || '';
        state.form.equipment_subtype = existing.equipment_subtype || '';
        state.form.certification_date = (existing.certification_date || '').slice(0, 10);
        ctx.toast('Existing entry — editing', 'ok');
      } catch {
        // 404 = new entry, normal path.
      }
      state.step = 'form';
      state.error = '';
      render();
    }

    function renderForm() {
      const items = state.eqOptions.items || [];
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <button class="btn secondary" data-action="back" style="margin-bottom:12px">← New scan</button>
        <div class="card">
          <form data-form>
            <div><label>Barcode</label><input name="barcode_id" value="${esc(state.form.barcode_id)}" required /></div>
            <div><label>Equipment name <span style="color:var(--danger)">*</span></label>
              <input name="equipment_name" list="dl-eq-name" value="${esc(state.form.equipment_name)}" required />
              <datalist id="dl-eq-name">${optList(uniq(items.map(i => i.equipment_name)))}</datalist>
            </div>
            <div><label>Manufacturer <span style="color:var(--danger)">*</span></label>
              <input name="manufacturer" list="dl-eq-mfr" value="${esc(state.form.manufacturer)}" required />
              <datalist id="dl-eq-mfr">${optList(uniq(items.map(i => i.manufacturer)))}</datalist>
            </div>
            <div><label>Type <span style="color:var(--danger)">*</span></label>
              <input name="equipment_type" list="dl-eq-type" value="${esc(state.form.equipment_type)}" required />
              <datalist id="dl-eq-type">${optList(uniq(items.map(i => i.equipment_type)))}</datalist>
            </div>
            <div><label>Subtype <span style="color:var(--danger)">*</span></label>
              <input name="equipment_subtype" list="dl-eq-sub" value="${esc(state.form.equipment_subtype)}" required />
              <datalist id="dl-eq-sub">${optList(uniq(items.map(i => i.equipment_subtype)))}</datalist>
            </div>
            <div><label>Certification date (optional)</label>
              <input type="date" name="certification_date" value="${esc(state.form.certification_date)}" />
            </div>
            ${state.error ? `<div class="muted" style="color:var(--danger)">${esc(state.error)}</div>` : ''}
            <button class="btn block accent" type="submit" ${state.busy ? 'disabled' : ''}>Save equipment</button>
          </form>
        </div>
      `;
      root.appendChild(wrap);
      wrap.querySelector('[data-action="back"]').onclick = () => {
        state.step = 'scan';
        state.form = emptyForm();
        state.error = '';
        render();
      };
      wrap.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        state.form = {
          barcode_id: f.barcode_id.value.trim(),
          equipment_name: f.equipment_name.value.trim(),
          manufacturer: f.manufacturer.value.trim(),
          equipment_type: f.equipment_type.value.trim(),
          equipment_subtype: f.equipment_subtype.value.trim(),
          certification_date: f.certification_date.value || '',
        };
        const missing = Object.entries(state.form)
          .filter(([k]) => k !== 'certification_date')
          .filter(([, v]) => !v).map(([k]) => k);
        if (missing.length) {
          state.error = 'Missing: ' + missing.join(', ');
          render();
          return;
        }
        state.busy = true; state.error = ''; render();
        try {
          const r = await api('/equipment/mobile/entry', {
            method: 'POST',
            body: JSON.stringify({
              barcode_id: state.form.barcode_id,
              manufacturer: state.form.manufacturer,
              equipment_name: state.form.equipment_name,
              equipment_type: state.form.equipment_type,
              equipment_subtype: state.form.equipment_subtype,
              certification_date: state.form.certification_date || null,
            }),
          });
          ctx.toast(r.created ? 'Equipment created' : 'Equipment updated', 'ok');
          state.step = 'scan';
          state.form = emptyForm();
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

function emptyForm() {
  return { barcode_id: '', equipment_name: '', manufacturer: '', equipment_type: '', equipment_subtype: '', certification_date: '' };
}
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))].sort(); }
function optList(arr) { return arr.map(v => `<option value="${esc(v)}"></option>`).join(''); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
