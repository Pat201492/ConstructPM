// Create Equipment Request Ticket — PM mobile screen.
//
// Mirrors desktop etRequest() at public/index.html:4161-4330.
// Submits to POST /equipment-tickets which inserts a ticket_project row +
// N ticket_equipment rows. No email/notification today (template
// ticket_ready_pickup is wired to the 'ready for pickup' event, not to
// ticket creation).

import { api } from '../lib/api.js';
import { pickerHtml, bindPicker } from '../lib/pickers.js';

const projectLabel = (p) => p.primary_number || p.name || p.id;
const userLabel = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() + (u.email ? ` (${u.email})` : '');
const EQ_FIELDS = ['equipment_type', 'equipment_name', 'manufacturer'];

export default {
  async mount(root, ctx) {
    const state = {
      projects: [],
      users: [],
      eqOptions: { items: [], types: [], names: [] },
      form: {
        project_id: '',
        pickup_person_id: '',
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
      const [proj, eq, usr] = await Promise.all([
        api('/projects?status=active&limit=500').catch(() => ({ projects: [] })),
        api('/equipment-tickets/equipment-options').catch(() => ({ items: [], types: [], names: [], manufacturers: [] })),
        api('/users').catch(() => ({ users: [] })),
      ]);
      state.projects = proj.projects || proj || [];
      state.eqOptions = eq;
      // Strict active===true matches the server's `active: true` lookup
      // — a soft `!== false` would include users with undefined/null
      // active and the server would 400 them.
      state.users = (usr.users || []).filter(u => u.active === true);
    } catch {}

    render();

    function render() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="section-title">Project</div>
        <div class="card">
          ${pickerHtml({
            id: 'project_id',
            label: 'Project',
            selectedDisplay: (() => { const p = state.projects.find(x => x.id === state.form.project_id); return p ? projectLabel(p) : ''; })(),
            placeholder: 'Type to search your projects…',
          })}
          ${pickerHtml({
            id: 'pickup_person_id',
            label: 'Pick up person',
            selectedDisplay: (() => { const u = state.users.find(x => x.id === state.form.pickup_person_id); return u ? userLabel(u) : ''; })(),
            placeholder: 'Type to search users…',
          })}
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

      // Header field bindings (text inputs)
      wrap.querySelectorAll('[data-field]').forEach(el => {
        el.onchange = () => { state.form[el.dataset.field] = el.value; };
      });

      // Project picker — type-to-filter. On select, fetch the project to
      // auto-fill location + site contact fields (only if currently empty
      // so we don't clobber user edits).
      bindPicker(wrap, {
        id: 'project_id',
        items: state.projects,
        labelFn: projectLabel,
        onPick: async (pickedId) => {
          state.form.project_id = pickedId;
          if (!pickedId) { render(); return; }
          try {
            const r = await api('/projects/' + pickedId);
            const p = r.project || r;
            if (!state.form.location_name) state.form.location_name = p.location_name || p.address || '';
            if (!state.form.location_address) state.form.location_address = p.address || '';
            if (!state.form.site_contact_name) state.form.site_contact_name = p.site_contact_name || '';
            if (!state.form.site_contact_phone) state.form.site_contact_phone = p.site_contact_phone || '';
          } catch {}
          render();
        },
      });

      // Pickup picker — user list. Pickup user's email gets the
      // ticket-ready notification server-side; no UI hook needed here.
      bindPicker(wrap, {
        id: 'pickup_person_id',
        items: state.users,
        labelFn: userLabel,
        onPick: (pickedId) => { state.form.pickup_person_id = pickedId; },
      });

      // Line field bindings
      wrap.querySelectorAll('[data-line]').forEach(el => {
        el.onchange = () => {
          const i = parseInt(el.dataset.line, 10);
          const f = el.dataset.lineField;
          if (f === 'quantity') {
            state.lines[i][f] = parseInt(el.value, 10) || 1;
            return;
          }
          state.lines[i][f] = el.value;
          // Bidirectional auto-fill: if the four equipment fields narrow
          // to exactly one item in the options pool, fill the unset ones.
          const items = matchingItems(state.lines[i]);
          if (items.length === 1) {
            EQ_FIELDS.forEach(k => { if (!state.lines[i][k] && items[0][k]) state.lines[i][k] = items[0][k]; });
          }
          // Re-render so the OTHER fields' datalists narrow to whatever is
          // still consistent with the just-set field. Without this each
          // datalist would keep showing every known value globally and the
          // PM would see Saw names after picking type=Drill.
          render();
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

    // Items consistent with whatever is already set on this line. Empty
    // fields are wildcards. Used by renderLine to cascade the datalists
    // and by the onchange autofill to detect a single-match narrow.
    function matchingItems(ln) {
      const items = state.eqOptions.items || [];
      return items.filter(it => EQ_FIELDS.every(k => !ln[k] || it[k] === ln[k]));
    }

    // Per-field uniqs from the matching subset — what the user can pick
    // for this field that won't contradict their other picks. Excluding
    // the field's own current value from the pool would make the user's
    // current selection vanish from the dropdown after typing, so we
    // re-include the full unique set for that field's own column.
    function filteredOpts(ln) {
      const items = matchingItems(ln);
      const pull = (k) => [...new Set(items.map(i => i[k]).filter(Boolean))].sort();
      return {
        types: pull('equipment_type'),
        names: pull('equipment_name'),
        manufacturers: pull('manufacturer'),
      };
    }

    function renderLine(ln, i) {
      // Datalist IDs unique per line. Options pulled from filteredOpts(ln)
      // so picking Type=Drill collapses name/manufacturer to only
      // drills; picking Manufacturer=DeWalt collapses everything to DeWalt
      // tools. Bidirectional — works from any field.
      const fo = filteredOpts(ln);
      return `
        <div class="card">
          <div class="row">
            <div class="grow"><label>Quantity</label><input data-line="${i}" data-line-field="quantity" type="number" inputmode="numeric" min="1" value="${esc(ln.quantity)}" /></div>
            <button class="remove" data-remove-line="${i}" title="Remove line">×</button>
          </div>
          <div style="margin-top:8px">
            <label>Type</label>
            <input data-line="${i}" data-line-field="equipment_type" list="dl-type-${i}" value="${esc(ln.equipment_type)}" placeholder="Type to filter…" />
            <datalist id="dl-type-${i}">${optList(fo.types)}</datalist>
          </div>
          <div style="margin-top:8px">
            <label>Name</label>
            <input data-line="${i}" data-line-field="equipment_name" list="dl-name-${i}" value="${esc(ln.equipment_name)}" placeholder="Type to filter…" />
            <datalist id="dl-name-${i}">${optList(fo.names)}</datalist>
          </div>
          <div style="margin-top:8px">
            <label>Manufacturer</label>
            <input data-line="${i}" data-line-field="manufacturer" list="dl-mfr-${i}" value="${esc(ln.manufacturer)}" placeholder="Type to filter…" />
            <datalist id="dl-mfr-${i}">${optList(fo.manufacturers)}</datalist>
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
      const filledLines = state.lines.filter(l => (l.equipment_type || l.equipment_name || l.manufacturer));
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
          // Server denormalises the picked user's display name into
          // pickup_person and emails their inbox on ready-for-pickup.
          pickup_person_id: state.form.pickup_person_id || null,
          requestor_name: state.form.requestor_name || null,
          location_name: state.form.location_name || null,
          location_address: state.form.location_address || null,
          site_contact_name: state.form.site_contact_name || null,
          site_contact_phone: state.form.site_contact_phone || null,
          lines: filledLines.map(l => ({
            quantity: l.quantity || 1,
            equipment_name: l.equipment_name || null,
            equipment_type: l.equipment_type || null,
            manufacturer: l.manufacturer || null,
          })),
        };
        const r = await api('/equipment-tickets', { method: 'POST', body: JSON.stringify(payload) });
        ctx.toast(`Ticket #${r.ticket_number || r.project?.ticket_number || ''} created`, 'ok');
        // Reset
        state.form = {
          project_id: '', pickup_person_id: '',
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
  return { quantity: 1, equipment_type: '', equipment_name: '', manufacturer: '' };
}
function defaultRequestorName(session) {
  const u = session?.user;
  if (!u) return '';
  return `${u.firstName || u.first_name || ''} ${u.lastName || u.last_name || ''}`.trim();
}
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))].sort(); }
function optList(arr) { return arr.map(v => `<option value="${esc(v)}"></option>`).join(''); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
