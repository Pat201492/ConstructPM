// Quick Bid — PM mobile screen.
//
// Step 1: capture bid info + customer/location/scope.
//   - Save → POST /bids → bid stays in 'draft' status. No email, no project.
//   - Continue → advance to step 2.
// Step 2: minimal quote (project length days + total man hours + markup %).
//   Mark Won + Create Project → POST /bids/:id/quote, then
//   POST /bids/:id/generate, then POST /bids/:id/quick-project. The last
//   call is where server-side side effects fire: bid_project_quote email,
//   bid_won + schedule_dates_needed notifications, project + folder creation.

import { api } from '../lib/api.js';

export default {
  async mount(root, ctx) {
    const state = {
      step: 1,
      bidId: null,
      bidNumber: null,
      customers: [],
      locations: [],
      form: {
        customer_id: '',
        location_id: '',
        project_scope: '',
        description: '',
      },
      quote: {
        project_length_days: '',
        total_man_hours: '',
        markup_pct: 15,
      },
      busy: false,
      error: '',
    };

    // Prefetch dropdown data in parallel — both are cheap reads.
    try {
      const [cust, locs] = await Promise.all([
        api('/customers').catch(() => ({ customers: [] })),
        api('/locations').catch(() => ({ locations: [] })),
      ]);
      state.customers = cust.customers || cust || [];
      state.locations = locs.locations || locs || [];
    } catch {}

    render();

    function render() {
      root.innerHTML = '';
      if (state.step === 1) renderStep1();
      else renderStep2();
    }

    function renderStep1() {
      const wrap = el('div');
      wrap.innerHTML = `
        <div class="section-title">Bid info</div>
        <div class="card">
          <form data-form="step1">
            <div>
              <label>Customer</label>
              <select name="customer_id">
                <option value="">— Select —</option>
                ${state.customers.map(c => `<option value="${esc(c.id)}" ${c.id === state.form.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Location</label>
              <select name="location_id">
                <option value="">— Select —</option>
                ${state.locations.map(l => `<option value="${esc(l.id)}" ${l.id === state.form.location_id ? 'selected' : ''}>${esc(l.name || l.town || '(unnamed)')}</option>`).join('')}
              </select>
            </div>
            <div>
              <label>Project scope <span style="color:var(--danger)">*</span></label>
              <textarea name="project_scope" required placeholder="Short description of work">${esc(state.form.project_scope)}</textarea>
            </div>
            <div>
              <label>Description (optional)</label>
              <textarea name="description">${esc(state.form.description)}</textarea>
            </div>
            ${state.error ? `<div class="muted" style="color:var(--danger)">${esc(state.error)}</div>` : ''}
            <div class="btn-row">
              <button type="button" class="btn secondary" data-action="save" ${state.busy ? 'disabled' : ''}>Save</button>
              <button type="submit" class="btn" ${state.busy ? 'disabled' : ''}>Continue →</button>
            </div>
          </form>
        </div>
        <div class="muted small" style="text-align:center;margin-top:8px">
          Save keeps the bid as a draft. Continue lets you mark it won and create a project.
        </div>
      `;
      root.appendChild(wrap);
      const form = wrap.querySelector('form');

      form.querySelector('[data-action="save"]').onclick = async () => {
        if (!collectStep1(form, { requireLocation: false })) return;
        await createBid({ thenStep2: false });
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        // Location drives rate-sheet lookup in /bids/:id/quote. Without it
        // the server silently uses 0 rates and the bid amount comes out
        // as 0, which silently breaks Quick Project. Require it on the
        // Continue path; Save (draft only) stays unconstrained.
        if (!collectStep1(form, { requireLocation: true })) return;
        await createBid({ thenStep2: true });
      };
    }

    function collectStep1(form, { requireLocation } = {}) {
      state.form.customer_id = form.customer_id.value || '';
      state.form.location_id = form.location_id.value || '';
      state.form.project_scope = form.project_scope.value.trim();
      state.form.description = form.description.value.trim();
      if (!state.form.project_scope) {
        state.error = 'Project scope is required';
        render();
        return false;
      }
      if (requireLocation && !state.form.location_id) {
        state.error = 'Location is required to create a project (it sets the union rates)';
        render();
        return false;
      }
      state.error = '';
      return true;
    }

    async function createBid({ thenStep2 }) {
      state.busy = true; render();
      try {
        // If a bid was already created earlier in this session and we're
        // editing further, we'd PATCH instead of POST. v1 keeps it simple:
        // every Save creates a fresh bid; user backs out to start over.
        const payload = {
          customer_id: state.form.customer_id || null,
          location_id: state.form.location_id || null,
          project_scope: state.form.project_scope,
          description: state.form.description || null,
        };
        const bid = await api('/bids', { method: 'POST', body: JSON.stringify(payload) });
        state.bidId = bid.id;
        state.bidNumber = bid.bid_number;
        if (thenStep2) {
          state.step = 2;
          state.busy = false;
          render();
        } else {
          ctx.toast(`Bid ${bid.bid_number} saved as draft`, 'ok');
          // Reset for next bid.
          state.bidId = null; state.bidNumber = null;
          state.form = { customer_id: '', location_id: '', project_scope: '', description: '' };
          state.busy = false;
          render();
        }
      } catch (e) {
        state.error = e.message || 'Failed to save';
        state.busy = false;
        render();
      }
    }

    function renderStep2() {
      const wrap = el('div');
      wrap.innerHTML = `
        <div class="section-title">Bid ${esc(state.bidNumber || '')}</div>
        <div class="card">
          <form data-form="step2">
            <div>
              <label>Project length (days) <span style="color:var(--danger)">*</span></label>
              <input name="project_length_days" type="number" inputmode="numeric" min="1" value="${esc(state.quote.project_length_days)}" required />
            </div>
            <div>
              <label>Total man-hours <span style="color:var(--danger)">*</span></label>
              <input name="total_man_hours" type="number" inputmode="numeric" min="1" value="${esc(state.quote.total_man_hours)}" required />
            </div>
            <div>
              <label>Markup %</label>
              <input name="markup_pct" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(state.quote.markup_pct)}" />
            </div>
            ${state.error ? `<div class="muted" style="color:var(--danger)">${esc(state.error)}</div>` : ''}
            <div class="btn-row">
              <button type="button" class="btn secondary" data-action="back" ${state.busy ? 'disabled' : ''}>Back</button>
              <button type="submit" class="btn accent" ${state.busy ? 'disabled' : ''}>Mark Won + Create Project</button>
            </div>
          </form>
        </div>
        <div class="muted small" style="text-align:center;margin-top:8px">
          A single Journeyman line covers the total hours. Edit on desktop for itemized quotes.
        </div>
      `;
      root.appendChild(wrap);
      const form = wrap.querySelector('form');
      form.querySelector('[data-action="back"]').onclick = () => { state.step = 1; render(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        state.quote.project_length_days = parseInt(form.project_length_days.value, 10);
        state.quote.total_man_hours = parseInt(form.total_man_hours.value, 10);
        state.quote.markup_pct = parseFloat(form.markup_pct.value) || 0;
        if (!state.quote.project_length_days || !state.quote.total_man_hours) {
          state.error = 'Project length and total man-hours are required';
          render();
          return;
        }
        state.error = '';
        await runQuickProject();
      };
    }

    async function runQuickProject() {
      state.busy = true; render();
      try {
        const linePayload = {
          markup_pct: state.quote.markup_pct,
          project_length_days: state.quote.project_length_days,
          per_diem_rate: 0,
          lines: [{
            classification: 'Journeyman',
            personnel: 1,
            st_hours: state.quote.total_man_hours,
            ot_hours: 0,
            dt_hours: 0,
          }],
        };
        await api(`/bids/${state.bidId}/quote`, { method: 'POST', body: JSON.stringify(linePayload) });
        await api(`/bids/${state.bidId}/generate`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
        const out = await api(`/bids/${state.bidId}/quick-project`, { method: 'POST', body: JSON.stringify({}) });
        const projectNum = out?.project?.id || '';
        ctx.toast(`Project created from bid ${state.bidNumber}`, 'ok');
        state.step = 1;
        state.bidId = null; state.bidNumber = null;
        state.form = { customer_id: '', location_id: '', project_scope: '', description: '' };
        state.quote = { project_length_days: '', total_man_hours: '', markup_pct: 15 };
        state.busy = false;
        render();
      } catch (e) {
        state.error = e.message || 'Quick Project failed';
        state.busy = false;
        render();
      }
    }
  },
};

function el(tag) { return document.createElement(tag); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
