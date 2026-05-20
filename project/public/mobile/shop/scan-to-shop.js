// Scan to Shop — Shop Staff mobile screen.
//
// Scan a barcode → POST /equipment/mobile/return → server flips equipment
// status='available', current_location='shop', current_project_id=null,
// status_change_date=today. No email.

import { api } from '../lib/api.js';

export default {
  async mount(root, ctx) {
    const state = {
      lastReturn: null, // { equipment_name, barcode_id } most recent success
      manualCode: '',
      busy: false,
      error: '',
    };
    render();

    function render() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="card">
          <p class="muted small" style="margin-top:0">Scan or enter an equipment barcode to send it back to the shop.</p>
          <button class="btn block accent" data-action="scan" ${state.busy ? 'disabled' : ''}>📷 Scan barcode</button>
          <div style="margin-top:12px"><label>Or enter manually</label><input data-field="manualCode" value="${esc(state.manualCode)}" placeholder="Barcode / serial" /></div>
          <button class="btn secondary block" data-action="submit" style="margin-top:8px" ${state.busy ? 'disabled' : ''}>Send to shop</button>
          ${state.error ? `<div class="muted" style="color:var(--danger);margin-top:8px">${esc(state.error)}</div>` : ''}
        </div>
        ${state.lastReturn ? `
          <div class="card" style="background:#dcfce7;border-color:#bbf7d0">
            <div><b>Returned</b></div>
            <div class="small">${esc(state.lastReturn.equipment_name || '—')} (${esc(state.lastReturn.barcode_id)})</div>
          </div>
        ` : ''}
      `;
      root.appendChild(wrap);
      wrap.querySelector('[data-field="manualCode"]').oninput = (e) => { state.manualCode = e.target.value; };
      wrap.querySelector('[data-action="scan"]').onclick = doScan;
      wrap.querySelector('[data-action="submit"]').onclick = () => submit(state.manualCode);
    }

    async function doScan() {
      const { showScanner } = await import('../lib/scan.js');
      try {
        const code = await showScanner({ title: 'Scan to shop' });
        await submit(code);
      } catch (e) {
        if (e.message !== 'cancelled') ctx.toast(e.message, 'danger');
      }
    }

    async function submit(code) {
      const c = String(code || '').trim();
      if (!c) { state.error = 'Scan or enter a barcode'; render(); return; }
      state.busy = true; state.error = ''; render();
      try {
        const r = await api('/equipment/mobile/return', { method: 'POST', body: JSON.stringify({ barcode_id: c }) });
        const eq = r.equipment || r;
        state.lastReturn = { equipment_name: eq.equipment_name || r.equipment_name, barcode_id: c };
        state.manualCode = '';
        ctx.toast(`Returned: ${state.lastReturn.equipment_name || c}`, 'ok');
      } catch (e) {
        state.error = e.message || 'Return failed';
      } finally {
        state.busy = false;
        render();
      }
    }
  },
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
