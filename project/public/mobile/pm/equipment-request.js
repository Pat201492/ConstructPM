// Create Equipment Request Ticket — PM mobile screen.
//
// Mirrors desktop etRequest() at public/index.html:4161-4330.
// Submits to POST /equipment-tickets which inserts a ticket_project row +
// N ticket_equipment rows. No email/notification today (template
// ticket_ready_pickup is wired to the 'ready for pickup' event, not to
// ticket creation).

import { api } from '../lib/api.js';

export default {
  async mount(root, ctx) {
    const state = {
      projects: [],
      eqOptions: { items: [], types: [], subtypes: [], names: [] },
      form: {
        project_id: '',
        pickup_person: '',
        requestor_name: defaultRequestorName(ctx.session),
        location_name: '',
        location_address: '',
        site_contact_name: '',
        site_contact_phone: '',
      },
      lines: [emptyLine()],
      busy: false,
      error: '',
      success: '',
    };

    try {
      const [proj, eq] = await Promise.all([
        api('/projects?status=active&limit=500').catch(() => ({ projects: [] })),
        api('/equipment-tickets/equipment-options').catch(() => ({ items: [], types: [], subtypes: [], names: [], manufacturers: [] })),
      ]);
      state.projects = proj.projects || proj || [];
      state.eqOptions = eq;
    } catch {}

    render();

    function render() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="section-title">Project</div>
        <div class="card">
          <div>
            <label>Project</label>
            <select data-field="project_id">
              <option value="">— Select project —</option>
              ${state.projects.map(p => `<option value="${esc(p.id)}" ${p.id === state.form.project_id ? 'selected' : ''}>${esc(p.primary_number || p.name || p.id)}</option>`).join('')}
            </select>
          </div>
          <div style="margin-top:8px"><label>Pick up person</label><input data-field="pickup_person" value="${esc(state.form.pickup_person)}" /></div>
          <div style="margin-top:8px"><label>Requestor</label><input data-field="requestor_name" value="${esc(state.form.requestor_name)}" /></div>
          <div style="margin-top:8px"><label>Location name</label><input data-field="location_name" value="${esc(state.form.location_name)}" /></div>
          <div style="margin-top:8px"><label>Location address</label><input data-field="location_address" value="${esc(state.form.location_address)}" /></div>
          <div style="margin-top:8px"><label>Site contact name</label><input data-field="site_contact_name" value="${esc(state.form.site_contact_name)}" /></div>
          <div style="margin-top:8px"><label>Site contact phone</label><input data-field="site_contact_phone" type="tel" inputmode="tel" value="${esc(state.form.site_contact_phone)}" /></div>
        </div>

        <div class="section-title">Equipment</div>
        ${state.lines.map((ln, i) => renderLine(ln, i)).join('')}
        <button class="btn secondary block" data-action="add-line" style="margin-top:8px">+ Add line</button>

        ${state.error ? `<div class="muted" style="color:var(--danger);margin-top:12px">${esc(state.error)}</div>` : ''}
        ${state.success ? `<div class="muted" style="color:var(--ok);margin-top:12px">${esc(state.success)}</div>` : ''}

        <button class="btn block accent" data-action="submit" style="margin-top:16px" ${state.busy ? 'disabled' : ''}>Submit ticket</button>
      `;
      root.appendChild(wrap);

      // Header field bindings
      wrap.querySelectorAll('[data-field]').forEach(el => {
        el.onchange = () => { state.form[el.dataset.field] = el.value; };
      });
      wrap.querySelector('[data-field="project_id"]').onchange = async (e) => {
        state.form.project_id = e.target.value;
        if (!state.form.project_id) return;
        try {
          const r = await api('/projects/' + state.form.project_id);
          const p = r.project || r;
          if (!state.form.location_name) state.form.location_name = p.location_name || p.address || '';
          if (!state.form.location_address) state.form.location_address = p.address || '';
          if (!state.form.site_contact_name) state.form.site_contact_name = p.site_contact_name || '';
          if (!state.form.site_contact_phone) state.form.site_contact_phone = p.site_contact_phone || '';
          render();
        } catch {}
      };

      // Line field bindings
      wrap.querySelectorAll('[data-line]').forEach(el => {
        el.onchange = () => {
          const i = parseInt(el.dataset.line, 10);
          const f = el.dataset.lineField;
          if (f === 'quantity') {
            state.lines[i][f] = parseInt(el.value, 10) || 1;
          } else {
            state.lines[i][f] = el.value;
          }
          // Bidirectional auto-fill: if the four equipment fields narrow
          // to exactly one item in the options pool, fill the unset ones.
          const fields = ['equipment_type', 'equipment_subtype', 'equipment_name', 'manufacturer'];
          const items = (state.eqOptions.items || []).filter(it =>
            fields.every(k => !state.lines[i][k] || it[k] === state.lines[i][k])
          );
          if (items.length === 1) {
            fields.forEach(k => { if (!state.lines[i][k] && items[0][k]) state.lines[i][k] = items[0][k]; });
            render();
          }
        };
      });
      wrap.querySelectorAll('[data-remove-line]').forEach(b => {
        b.onclick = () => {
          state.lines.splice(parseInt(b.dataset.removeLine, 10), 1);
          if (!state.lines.length) state.lines.push(emptyLine());
          render();
        };
      });
      wrap.querySelector('[data-action="add-line"]').onclick = () => {
        state.lines.push(emptyLine());
        render();
      };
      wrap.querySelector('[data-action="submit"]').onclick = submit;
    }

    function renderLine(ln, i) {
      // Datalist IDs unique per line.
      return `
        <div class="card">
          <div class="row">
            <div class="grow"><label>Quantity</label><input data-line="${i}" data-line-field="quantity" type="number" inputmode="numeric" min="1" value="${esc(ln.quantity)}" /></div>
            <button class="remove" data-remove-line="${i}" title="Remove line">×</button>
          </div>
          <div style="margin-top:8px">
            <label>Type</label>
            <input data-line="${i}" data-line-field="equipment_type" list="dl-type-${i}" value="${esc(ln.equipment_type)}" />
            <datalist id="dl-type-${i}">${optList(uniq((state.eqOptions.items || []).map(x => x.equipment_type)))}</datalist>
          </div>
          <div style="margin-top:8px">
            <label>Subtype</label>
            <input data-line="${i}" data-line-field="equipment_subtype" list="dl-sub-${i}" value="${esc(ln.equipment_subtype)}" />
            <datalist id="dl-sub-${i}">${optList(uniq((state.eqOptions.items || []).map(x => x.equipment_subtype)))}</datalist>
          </div>
          <div style="margin-top:8px">
            <label>Name</label>
            <input data-line="${i}" data-line-field="equipment_name" list="dl-name-${i}" value="${esc(ln.equipment_name)}" />
            <datalist id="dl-name-${i}">${optList(uniq((state.eqOptions.items || []).map(x => x.equipment_name)))}</datalist>
          </div>
          <div style="margin-top:8px">
            <label>Manufacturer</label>
            <input data-line="${i}" data-line-field="manufacturer" list="dl-mfr-${i}" value="${esc(ln.manufacturer)}" />
            <datalist id="dl-mfr-${i}">${optList(uniq((state.eqOptions.items || []).map(x => x.manufacturer)))}</datalist>
          </div>
        </div>
      `;
    }

    async function submit() {
      // Validate
      if (!state.form.project_id) {
        state.error = 'Project is required';
        render();
        return;
      }
      const filledLines = state.lines.filter(l => (l.equipment_type || l.equipment_subtype || l.equipment_name || l.manufacturer));
      if (!filledLines.length) {
        state.error = 'Add at least one equipment line';
        render();
        return;
      }
      state.error = '';
      state.busy = true; render();
      try {
        const payload = {
          project_id: state.form.project_id,
          pickup_person: state.form.pickup_person || null,
          requestor_name: state.form.requestor_name || null,
          location_name: state.form.location_name || null,
          location_address: state.form.location_address || null,
          site_contact_name: state.form.site_contact_name || null,
          site_contact_phone: state.form.site_contact_phone || null,
          lines: filledLines.map(l => ({
            quantity: l.quantity || 1,
            equipment_name: l.equipment_name || null,
            equipment_type: l.equipment_type || null,
            equipment_subtype: l.equipment_subtype || null,
            manufacturer: l.manufacturer || null,
          })),
        };
        const r = await api('/equipment-tickets', { method: 'POST', body: JSON.stringify(payload) });
        ctx.toast(`Ticket #${r.ticket_number || r.project?.ticket_number || ''} created`, 'ok');
        // Reset
        state.form = {
          project_id: '', pickup_person: '',
          requestor_name: defaultRequestorName(ctx.session),
          location_name: '', location_address: '',
          site_contact_name: '', site_contact_phone: '',
        };
        state.lines = [emptyLine()];
        state.busy = false; state.success = '';
        render();
      } catch (e) {
        state.error = e.message || 'Failed to create ticket';
        state.busy = false;
        render();
      }
    }
  },
};

function emptyLine() {
  return { quantity: 1, equipment_type: '', equipment_subtype: '', equipment_name: '', manufacturer: '' };
}
function defaultRequestorName(session) {
  const u = session?.user;
  if (!u) return '';
  return `${u.firstName || u.first_name || ''} ${u.lastName || u.last_name || ''}`.trim();
}
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))].sort(); }
function optList(arr) { return arr.map(v => `<option value="${esc(v)}"></option>`).join(''); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
