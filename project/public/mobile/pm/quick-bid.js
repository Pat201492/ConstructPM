// Quick Bid — PM mobile screen, feature-parity with desktop bid create +
// bid quote sheet.
//
// Step 1 (bid info):
//   - Customer + Customer Contact + Site Contact + Location pickers,
//     each with an inline "+ New" overlay (POST /customers /contacts
//     /locations on save).
//   - Site Contact auto-mirrors Customer Contact until manually edited.
//   - Local Union auto-fills from selected location (display-only).
//   - Assigned PM dropdown (defaults to self when the user is a PM).
//   - Project scope (required), description.
//   - Save → POST /bids (draft, no email).
//   - Continue → advance to Step 2.
//
// Step 2 (quote):
//   - markup_pct, project_length_days, per_diem_rate.
//   - Multi-line table: classification (dropdown from rate-sheet for the
//     bid's local_union) + personnel + st/ot/dt hours. Rates lock from
//     the rate-sheet on the server during save.
//   - Length-vs-hours warning (±1 day tolerance) requires an
//     acknowledgement checkbox before Mark Won + Create Project.
//   - Mark Won → POST /bids/:id/quote → /bids/:id/generate →
//     /bids/:id/quick-project (fires bid_project_quote email, bid_won
//     + schedule_dates_needed notifications, creates project + folder).

import { api } from '../lib/api.js';
import { pickerHtml, bindPicker } from '../lib/pickers.js';

const ESC_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC_HTML[c]);

export default {
  async mount(root, ctx) {
    const state = {
      step: 1,
      bidId: null,
      bidNumber: null,
      customers: [],
      contacts: [],
      locations: [],
      pms: [],
      rateClassifications: [],
      form: {
        customer_id: '',
        customer_contact_id: '',
        site_contact_id: '',
        location_id: '',
        project_scope: '',
        description: '',
        assigned_pm_id: '',
        local_union: '',
        miles_from_hq: '',
      },
      siteContactManuallyEdited: false,
      quote: {
        markup_pct: 15,
        project_length_days: '',
        per_diem_rate: 0,
        lines: [],
      },
      lengthAck: false,
      busy: false,
      error: '',
      modal: null,
    };

    const u = ctx.session?.user;
    if (u?.default_markup_pct != null) state.quote.markup_pct = parseFloat(u.default_markup_pct) || 15;
    if (u?.role === 'project_manager' && u.id) state.form.assigned_pm_id = u.id;

    await Promise.all([
      api('/customers').then(r => { state.customers = r.customers || r || []; }).catch(() => {}),
      api('/contacts').then(r => { state.contacts = r.contacts || r || []; }).catch(() => {}),
      api('/locations').then(r => { state.locations = r.locations || r || []; }).catch(() => {}),
      api('/users/pms').then(r => { state.pms = r.users || r || []; }).catch(() => {}),
    ]);

    render();

    function render() {
      root.innerHTML = '';
      if (state.step === 1) renderStep1();
      else renderStep2();
      if (state.modal) renderModal();
    }

    function renderStep1() {
      const pickerConfigs = [
        { label: 'Customer',         id: 'customer_id',         items: state.customers, labelFn: c => c.name, modalType: 'customer' },
        { label: 'Customer contact', id: 'customer_contact_id', items: state.contacts,  labelFn: c => `${c.name}${c.company ? ' (' + c.company + ')' : ''}`, modalType: 'contact' },
        { label: 'Site contact',     id: 'site_contact_id',     items: state.contacts,  labelFn: c => `${c.name}${c.company ? ' (' + c.company + ')' : ''}`, modalType: 'contact' },
        { label: 'Location',         id: 'location_id',         items: state.locations, labelFn: l => `${l.name || l.town || '(unnamed)'}${l.local_union ? ' — ' + l.local_union : ''}`, modalType: 'location' },
      ];
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="section-title">Bid info</div>
        <div class="card">
          ${pickerConfigs.map(c => {
            const sel = state.form[c.id];
            const selItem = sel ? c.items.find(i => i.id === sel) : null;
            return pickerHtml({
              id: c.id, label: c.label,
              selectedDisplay: selItem ? c.labelFn(selItem) : '',
              addModalType: c.modalType,
            });
          }).join('')}
          <div class="row" style="gap:6px;margin-top:8px">
            <div class="grow"><label>Local union</label><input value="${esc(state.form.local_union)}" readonly placeholder="From location" /></div>
            <div style="width:120px"><label>Miles from HQ</label><input value="${esc(state.form.miles_from_hq)}" readonly placeholder="—" /></div>
          </div>
          <div style="margin-top:8px">
            <label>Assigned PM</label>
            <select data-field="assigned_pm_id">
              <option value="">— Unassigned —</option>
              ${state.pms.map(p => `<option value="${esc(p.id)}" ${p.id === state.form.assigned_pm_id ? 'selected' : ''}>${esc((p.first_name || '') + ' ' + (p.last_name || ''))}</option>`).join('')}
            </select>
          </div>
          <div style="margin-top:8px"><label>Project scope <span style="color:var(--danger)">*</span></label><textarea data-field="project_scope" required>${esc(state.form.project_scope)}</textarea></div>
          <div style="margin-top:8px"><label>Description (optional)</label><textarea data-field="description">${esc(state.form.description)}</textarea></div>
        </div>
        ${state.error ? `<div class="muted" style="color:var(--danger);margin:8px 4px">${esc(state.error)}</div>` : ''}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn secondary" data-action="save" ${state.busy ? 'disabled' : ''}>Save draft</button>
          <button class="btn" data-action="continue" ${state.busy ? 'disabled' : ''}>Continue →</button>
        </div>
        <div class="muted small" style="text-align:center;margin-top:8px">
          Save draft keeps the bid in 'draft' status with no email. Continue lets you mark it won and create the project.
        </div>
      `;
      root.appendChild(wrap);

      // Wire each picker: type-to-filter input + click-to-pick dropdown.
      // Closure over the config keeps items/labelFn accessible without
      // round-tripping through data-attributes (which can't carry objects).
      pickerConfigs.forEach(cfg => {
        bindPicker(wrap, {
          id: cfg.id, items: cfg.items, labelFn: cfg.labelFn,
          onPick: (pickedId, item) => {
            state.form[cfg.id] = pickedId;
            applyPickSideEffects(cfg.id, pickedId, item);
            render();
          },
        });
      });

      wrap.querySelectorAll('select[data-field]').forEach(sel => {
        sel.onchange = () => {
          state.form[sel.dataset.field] = sel.value;
          render();
        };
      });
      wrap.querySelectorAll('textarea[data-field]').forEach(t => {
        t.oninput = () => { state.form[t.dataset.field] = t.value; };
      });
      wrap.querySelectorAll('[data-add]').forEach(b => {
        b.onclick = () => openInlineCreate(b.dataset.add, b.dataset.target);
      });

      wrap.querySelector('[data-action="save"]').onclick = () => submitStep1({ thenStep2: false });
      wrap.querySelector('[data-action="continue"]').onclick = () => submitStep1({ thenStep2: true });
    }

    function applyPickSideEffects(id, pickedId, item) {
      if (id === 'customer_contact_id' && !state.siteContactManuallyEdited) {
        state.form.site_contact_id = pickedId || '';
      }
      if (id === 'site_contact_id') {
        // Any explicit user pick stops auto-mirroring (intent: "I've
        // decided site is this person") even when it matches the current
        // customer contact.
        state.siteContactManuallyEdited = true;
      }
      if (id === 'location_id') {
        const loc = item || state.locations.find(l => l.id === pickedId);
        state.form.local_union = loc?.local_union || '';
        // miles_from_hq lives on the same locations row — pull alongside
        // local_union so the quote knows the mileage cost basis without
        // a separate manual entry.
        state.form.miles_from_hq = (loc?.miles_from_hq != null) ? loc.miles_from_hq : '';
      }
    }

    async function submitStep1({ thenStep2 }) {
      const scope = (root.querySelector('[data-field="project_scope"]')?.value || '').trim();
      const description = (root.querySelector('[data-field="description"]')?.value || '').trim();
      state.form.project_scope = scope;
      state.form.description = description;
      if (!scope) { state.error = 'Project scope is required'; render(); return; }
      if (thenStep2 && !state.form.location_id) {
        state.error = 'Location is required to create a project (it sets the union rates)';
        render(); return;
      }
      state.error = ''; state.busy = true; render();
      try {
        const payload = {
          customer_id: state.form.customer_id || null,
          customer_contact_id: state.form.customer_contact_id || null,
          site_contact_id: state.form.site_contact_id || null,
          location_id: state.form.location_id || null,
          assigned_pm_id: state.form.assigned_pm_id || null,
          project_scope: state.form.project_scope,
          description: state.form.description || null,
        };
        // If a draft was already created earlier in this session (user
        // clicked Continue, hit Back, edited fields, clicked Continue
        // again), PATCH the existing bid rather than POST a new one —
        // otherwise every round trip leaves a stray draft behind.
        let bid;
        if (state.bidId) {
          bid = await api('/bids/' + state.bidId, { method: 'PATCH', body: JSON.stringify(payload) });
        } else {
          bid = await api('/bids', { method: 'POST', body: JSON.stringify(payload) });
        }
        state.bidId = bid.id;
        state.bidNumber = bid.bid_number;
        if (thenStep2) {
          await loadClassifications();
          seedQuoteLines();
          state.step = 2;
          state.busy = false;
          render();
        } else {
          ctx.toast(`Bid ${bid.bid_number} saved as draft`, 'ok');
          resetAll();
        }
      } catch (e) {
        state.error = e.message || 'Save failed';
        state.busy = false;
        render();
      }
    }

    async function loadClassifications() {
      state.rateClassifications = [];
      if (!state.form.local_union) return;
      try {
        const r = await api('/admin/rate-sheet/local/' + encodeURIComponent(state.form.local_union));
        state.rateClassifications = r.rates || [];
      } catch {}
    }

    function seedQuoteLines() {
      if (state.quote.lines.length) return;
      const seedOrder = ['Foreman', 'Journeyman', 'foreman', 'journeyman'];
      const seeded = [];
      for (const name of seedOrder) {
        const rate = state.rateClassifications.find(r => r.classification === name);
        if (rate && !seeded.find(s => s.classification === rate.classification)) {
          seeded.push({ classification: rate.classification, personnel: 1, st_hours: 0, ot_hours: 0, dt_hours: 0 });
        }
      }
      state.quote.lines = seeded.length ? seeded : [newLine()];
    }

    function newLine() {
      const first = state.rateClassifications[0];
      return { classification: first?.classification || '', personnel: 1, st_hours: 0, ot_hours: 0, dt_hours: 0 };
    }

    function totals() {
      // Mirror server math at src/routes/bids.js:267-307 so the UI preview
      // tracks what the server will compute. Read-only.
      const rateMap = {};
      state.rateClassifications.forEach(r => {
        rateMap[r.classification] = {
          st: parseFloat(r.st_rate) || 0,
          ot: parseFloat(r.ot_rate) || 0,
          dt: parseFloat(r.dt_rate) || 0,
        };
      });
      let totalPersonnel = 0, totalManHours = 0, totalLabor = 0;
      for (const l of state.quote.lines) {
        const rates = rateMap[l.classification] || { st: 0, ot: 0, dt: 0 };
        const p = parseInt(l.personnel, 10) || 0;
        const st = parseFloat(l.st_hours) || 0;
        const ot = parseFloat(l.ot_hours) || 0;
        const dt = parseFloat(l.dt_hours) || 0;
        totalPersonnel += p;
        totalManHours += p * (st + ot + dt);
        totalLabor += p * (st * rates.st + ot * rates.ot + dt * rates.dt);
      }
      const days = parseInt(state.quote.project_length_days, 10) || 0;
      const perDiem = (parseFloat(state.quote.per_diem_rate) || 0) * totalPersonnel * days;
      const subtotal = totalLabor;
      const markup = subtotal * ((parseFloat(state.quote.markup_pct) || 0) / 100);
      const bidAmount = subtotal + markup + perDiem;
      const hoursPerPerson = totalPersonnel ? totalManHours / totalPersonnel : 0;
      const inferredDays = hoursPerPerson / 8;
      const lengthMismatch = days > 0 && inferredDays > 0 && Math.abs(inferredDays - days) > 1;
      return { totalPersonnel, totalManHours, totalLabor, perDiem, subtotal, markup, bidAmount, inferredDays, lengthMismatch };
    }

    function renderStep2() {
      const t = totals();
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="section-title">Bid ${esc(state.bidNumber || '')} — quote</div>

        <div class="card">
          <div class="row" style="gap:8px">
            <div class="grow"><label>Markup %</label><input type="number" inputmode="decimal" min="0" step="0.1" data-q="markup_pct" value="${esc(state.quote.markup_pct)}" /></div>
            <div class="grow"><label>Days</label><input type="number" inputmode="numeric" min="0" data-q="project_length_days" value="${esc(state.quote.project_length_days)}" /></div>
            <div class="grow"><label>Per diem $</label><input type="number" inputmode="decimal" min="0" step="0.01" data-q="per_diem_rate" value="${esc(state.quote.per_diem_rate)}" /></div>
          </div>
        </div>

        <div class="section-title">Lines (${state.quote.lines.length})</div>
        ${state.rateClassifications.length === 0 ? `
          <div class="muted small" style="padding:4px;color:var(--warn)">
            No rate sheet found for local union "${esc(state.form.local_union || '(none)')}". Lines saved with 0 rates — set rates in Admin → Rate Sheet, or pick a location with a configured union.
          </div>
        ` : ''}
        ${state.quote.lines.map((ln, i) => renderLine(ln, i)).join('')}
        <button class="btn secondary block" data-action="add-line" style="margin-top:8px">+ Add line</button>

        <div class="card" style="margin-top:16px">
          <div class="row"><div class="grow muted">Personnel</div><div>${t.totalPersonnel}</div></div>
          <div class="row"><div class="grow muted">Total man-hours</div><div>${fmt(t.totalManHours)}</div></div>
          <div class="row"><div class="grow muted">Labor cost</div><div>$${fmt(t.totalLabor, 2)}</div></div>
          <div class="row"><div class="grow muted">Per diem</div><div>$${fmt(t.perDiem, 2)}</div></div>
          <div class="row"><div class="grow muted">Markup</div><div>$${fmt(t.markup, 2)}</div></div>
          <div class="row" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><div class="grow"><b>Bid amount</b></div><div><b>$${fmt(t.bidAmount, 2)}</b></div></div>
          <div class="muted small" style="margin-top:4px">Mileage cost is added server-side (requires location miles_from_hq).</div>
        </div>

        ${t.lengthMismatch ? `
          <div class="card" style="margin-top:12px;background:#fef3c7;border-color:#fde68a">
            <div><b>⚠ Hours don't match project length</b></div>
            <div class="small">Quoted hours imply ~${fmt(t.inferredDays, 1)} days, but you entered ${state.quote.project_length_days}. Tick to acknowledge and continue.</div>
            <label style="display:flex;gap:8px;align-items:center;margin-top:8px">
              <input type="checkbox" data-ack ${state.lengthAck ? 'checked' : ''} style="width:auto;min-height:0" />
              <span>I've verified the hours and length</span>
            </label>
          </div>
        ` : ''}

        ${state.error ? `<div class="muted" style="color:var(--danger);margin:8px 4px">${esc(state.error)}</div>` : ''}

        <div class="btn-row" style="margin-top:16px">
          <button class="btn secondary" data-action="back" ${state.busy ? 'disabled' : ''}>Back</button>
          <button class="btn secondary" data-action="save-draft" ${state.busy ? 'disabled' : ''}>Save draft</button>
        </div>
        <button class="btn accent block" data-action="mark-won" style="margin-top:8px" ${state.busy || (t.lengthMismatch && !state.lengthAck) ? 'disabled' : ''}>Mark Won + Create Project</button>
        <div class="muted small" style="text-align:center;margin-top:6px">
          Save draft persists the estimate to this bid without marking it won. Reopen the bid on desktop to keep editing.
        </div>
      `;
      root.appendChild(wrap);

      wrap.querySelectorAll('[data-q]').forEach(el => {
        el.oninput = () => { state.quote[el.dataset.q] = el.value; };
        el.onchange = () => render();
      });
      wrap.querySelectorAll('[data-line]').forEach(el => {
        el.onchange = () => {
          const i = parseInt(el.dataset.line, 10);
          const f = el.dataset.lineField;
          state.quote.lines[i][f] = (f === 'classification') ? el.value : (parseFloat(el.value) || 0);
          render();
        };
      });
      wrap.querySelectorAll('[data-remove-line]').forEach(b => {
        b.onclick = () => {
          state.quote.lines.splice(parseInt(b.dataset.removeLine, 10), 1);
          if (!state.quote.lines.length) state.quote.lines.push(newLine());
          render();
        };
      });
      wrap.querySelector('[data-action="add-line"]').onclick = () => { state.quote.lines.push(newLine()); render(); };
      const ack = wrap.querySelector('[data-ack]'); if (ack) ack.onchange = () => { state.lengthAck = ack.checked; render(); };
      wrap.querySelector('[data-action="back"]').onclick = () => { state.step = 1; render(); };
      wrap.querySelector('[data-action="save-draft"]').onclick = saveDraftQuote;
      wrap.querySelector('[data-action="mark-won"]').onclick = runQuickProject;
    }

    // Save quote lines + top-level fields to the bid in draft status. No
    // /generate, no /quick-project. Stays on step 2 so the PM can keep
    // tweaking or come back to it on desktop.
    async function saveDraftQuote() {
      state.busy = true; state.error = ''; render();
      try {
        const payload = buildQuotePayload();
        if (payload.error) { state.error = payload.error; state.busy = false; render(); return; }
        await api(`/bids/${state.bidId}/quote`, { method: 'POST', body: JSON.stringify(payload.body) });
        ctx.toast(`Estimate saved to bid ${state.bidNumber}`, 'ok');
        state.busy = false;
        render();
      } catch (e) {
        state.error = e.message || 'Save failed';
        state.busy = false;
        render();
      }
    }

    function buildQuotePayload() {
      const body = {
        markup_pct: parseFloat(state.quote.markup_pct) || 0,
        project_length_days: parseInt(state.quote.project_length_days, 10) || 0,
        per_diem_rate: parseFloat(state.quote.per_diem_rate) || 0,
        lines: state.quote.lines
          .filter(l => l.classification && ((parseFloat(l.st_hours) || 0) + (parseFloat(l.ot_hours) || 0) + (parseFloat(l.dt_hours) || 0)) > 0)
          .map(l => ({
            classification: l.classification,
            personnel: parseInt(l.personnel, 10) || 0,
            st_hours: parseFloat(l.st_hours) || 0,
            ot_hours: parseFloat(l.ot_hours) || 0,
            dt_hours: parseFloat(l.dt_hours) || 0,
          })),
      };
      if (!body.lines.length) return { error: 'Add at least one line with hours' };
      if (!body.project_length_days) return { error: 'Project length (days) is required' };
      return { body };
    }

    function renderLine(ln, i) {
      const opts = state.rateClassifications.map(r => `<option value="${esc(r.classification)}" ${r.classification === ln.classification ? 'selected' : ''}>${esc(r.classification)}</option>`).join('');
      return `
        <div class="card">
          <div class="row">
            <div class="grow">
              <label>Classification</label>
              ${opts ? `<select data-line="${i}" data-line-field="classification">${opts}</select>`
                     : `<input data-line="${i}" data-line-field="classification" value="${esc(ln.classification)}" placeholder="Journeyman, Foreman, …" />`}
            </div>
            <button class="remove" data-remove-line="${i}" title="Remove">×</button>
          </div>
          <div class="row" style="margin-top:8px;gap:6px">
            <div class="grow"><label>Personnel</label><input type="number" inputmode="numeric" min="0" data-line="${i}" data-line-field="personnel" value="${esc(ln.personnel)}" /></div>
            <div class="grow"><label>ST hrs</label><input type="number" inputmode="decimal" min="0" step="0.25" data-line="${i}" data-line-field="st_hours" value="${esc(ln.st_hours)}" /></div>
          </div>
          <div class="row" style="margin-top:8px;gap:6px">
            <div class="grow"><label>OT hrs</label><input type="number" inputmode="decimal" min="0" step="0.25" data-line="${i}" data-line-field="ot_hours" value="${esc(ln.ot_hours)}" /></div>
            <div class="grow"><label>DT hrs</label><input type="number" inputmode="decimal" min="0" step="0.25" data-line="${i}" data-line-field="dt_hours" value="${esc(ln.dt_hours)}" /></div>
          </div>
        </div>
      `;
    }

    async function runQuickProject() {
      state.busy = true; state.error = ''; render();
      try {
        const payload = buildQuotePayload();
        if (payload.error) { state.error = payload.error; state.busy = false; render(); return; }
        await api(`/bids/${state.bidId}/quote`, { method: 'POST', body: JSON.stringify(payload.body) });
        await api(`/bids/${state.bidId}/generate`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
        await api(`/bids/${state.bidId}/quick-project`, { method: 'POST', body: JSON.stringify({}) });
        ctx.toast(`Project created from bid ${state.bidNumber}`, 'ok');
        resetAll();
      } catch (e) {
        state.error = e.message || 'Quick Project failed';
        state.busy = false;
        render();
      }
    }

    function resetAll() {
      state.step = 1;
      state.bidId = null; state.bidNumber = null;
      const keepMarkup = state.quote.markup_pct;
      state.form = {
        customer_id: '', customer_contact_id: '', site_contact_id: '',
        location_id: '', project_scope: '', description: '',
        assigned_pm_id: (ctx.session?.user?.role === 'project_manager') ? ctx.session.user.id : '',
        local_union: '', miles_from_hq: '',
      };
      state.siteContactManuallyEdited = false;
      state.quote = { markup_pct: keepMarkup, project_length_days: '', per_diem_rate: 0, lines: [] };
      state.lengthAck = false;
      state.busy = false; state.error = '';
      render();
    }

    function openInlineCreate(type, targetField) {
      state.modal = { type, targetField, draft: emptyDraft(type), error: '', busy: false };
      render();
    }

    function emptyDraft(type) {
      if (type === 'customer') return { name: '', billing_street: '', billing_town: '', billing_state: '', billing_zip: '' };
      if (type === 'contact')  return { name: '', email: '', phone: '', company: '' };
      if (type === 'location') return { name: '', location_code: '', street: '', town: '', state: '', zip: '', local_union: '' };
      return {};
    }

    function renderModal() {
      const m = state.modal;
      const title = { customer: 'New customer', contact: 'New contact', location: 'New location' }[m.type] || 'New';
      // Tear down any previous overlay before appending a new one. render()
      // can fire mid-submit (busy state), so without this we'd stack
      // multiple position:fixed overlays in the DOM and the user couldn't
      // interact with the page after dismiss.
      document.querySelectorAll('[data-quickbid-overlay]').forEach(el => el.remove());
      const overlay = document.createElement('div');
      overlay.dataset.quickbidOverlay = '1';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:60;display:flex;align-items:flex-end';
      overlay.innerHTML = `
        <div style="background:var(--surface);width:100%;max-height:90vh;overflow:auto;border-radius:16px 16px 0 0;padding:20px;padding-bottom:calc(20px + var(--safe-bot))">
          <h3 style="margin:0 0 12px">${esc(title)}</h3>
          <form data-create>
            ${createFields(m.type, m.draft)}
            ${m.error ? `<div class="muted" style="color:var(--danger);margin-top:8px">${esc(m.error)}</div>` : ''}
            <div class="btn-row" style="margin-top:12px">
              <button type="button" class="btn secondary" data-cancel ${m.busy ? 'disabled' : ''}>Cancel</button>
              <button type="submit" class="btn accent" ${m.busy ? 'disabled' : ''}>Save</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(overlay);
      const form = overlay.querySelector('form');
      form.querySelectorAll('[data-d]').forEach(el => {
        el.oninput = () => { m.draft[el.dataset.d] = el.value; };
      });
      form.onsubmit = async (e) => { e.preventDefault(); await submitCreate(overlay); };
      overlay.querySelector('[data-cancel]').onclick = () => { state.modal = null; overlay.remove(); render(); };
    }

    function createFields(type, d) {
      if (type === 'customer') return `
        <div><label>Name <span style="color:var(--danger)">*</span></label><input data-d="name" value="${esc(d.name)}" required /></div>
        <div style="margin-top:8px"><label>Billing street</label><input data-d="billing_street" value="${esc(d.billing_street)}" /></div>
        <div class="row" style="margin-top:8px;gap:6px">
          <div class="grow"><label>Town</label><input data-d="billing_town" value="${esc(d.billing_town)}" /></div>
          <div style="width:80px"><label>State</label><input data-d="billing_state" value="${esc(d.billing_state)}" maxlength="2" /></div>
          <div style="width:100px"><label>Zip</label><input data-d="billing_zip" value="${esc(d.billing_zip)}" inputmode="numeric" /></div>
        </div>
      `;
      if (type === 'contact') return `
        <div><label>Name <span style="color:var(--danger)">*</span></label><input data-d="name" value="${esc(d.name)}" required /></div>
        <div style="margin-top:8px"><label>Company</label><input data-d="company" value="${esc(d.company)}" /></div>
        <div style="margin-top:8px"><label>Email</label><input data-d="email" value="${esc(d.email)}" type="email" inputmode="email" autocapitalize="none" /></div>
        <div style="margin-top:8px"><label>Phone</label><input data-d="phone" value="${esc(d.phone)}" type="tel" inputmode="tel" /></div>
      `;
      if (type === 'location') return `
        <div><label>Name <span style="color:var(--danger)">*</span></label><input data-d="name" value="${esc(d.name)}" required /></div>
        <div style="margin-top:8px"><label>Location code (optional)</label><input data-d="location_code" value="${esc(d.location_code)}" /></div>
        <div style="margin-top:8px"><label>Street</label><input data-d="street" value="${esc(d.street)}" /></div>
        <div class="row" style="margin-top:8px;gap:6px">
          <div class="grow"><label>Town</label><input data-d="town" value="${esc(d.town)}" /></div>
          <div style="width:80px"><label>State</label><input data-d="state" value="${esc(d.state)}" maxlength="2" /></div>
          <div style="width:100px"><label>Zip</label><input data-d="zip" value="${esc(d.zip)}" inputmode="numeric" /></div>
        </div>
        <div style="margin-top:8px"><label>Local union</label><input data-d="local_union" value="${esc(d.local_union)}" placeholder="e.g. Local 164" /></div>
      `;
      return '';
    }

    async function submitCreate(overlay) {
      const m = state.modal;
      if (!m.draft.name?.trim()) { m.error = 'Name is required'; render(); return; }
      m.busy = true; m.error = ''; render();
      try {
        const path = m.type === 'customer' ? '/customers' : m.type === 'contact' ? '/contacts' : '/locations';
        const created = await api(path, { method: 'POST', body: JSON.stringify(m.draft) });
        const row = created.customer || created.contact || created.location || created;
        if (m.type === 'customer') {
          state.customers.push(row); state.form.customer_id = row.id;
        } else if (m.type === 'contact') {
          state.contacts.push(row);
          state.form[m.targetField] = row.id;
          if (m.targetField === 'customer_contact_id' && !state.siteContactManuallyEdited && !state.form.site_contact_id) {
            state.form.site_contact_id = row.id;
          }
        } else if (m.type === 'location') {
          state.locations.push(row);
          state.form.location_id = row.id;
          state.form.local_union = row.local_union || '';
        }
        ctx.toast(`${m.type[0].toUpperCase() + m.type.slice(1)} added`, 'ok');
        state.modal = null;
        overlay.remove();
        render();
      } catch (e) {
        m.error = e.message || 'Create failed';
        m.busy = false;
        render();
      }
    }
  },
};

function fmt(n, dp = 0) {
  if (!isFinite(n)) return '0';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
