// Active Tickets — Shop Staff mobile screen.
//
// List view polls GET /equipment-tickets/active every 5s while foreground.
// Tap a ticket to see lines and:
//   - Scan to fill → camera scan → GET /equipment/barcode/:code → push
//     into the local filled_items list → POST /equipment-tickets/:n/fill
//     with the full list (server replaces, see route comment).
//   - Ready for Pickup → POST /equipment-tickets/:n/ready. Server fires the
//     ticket_ready_pickup email to project PM + admin static list and
//     in-app notification to requestor + admins.

import { api } from '../lib/api.js';

const POLL_MS = 5000;

export default {
  async mount(root, ctx) {
    let pollTimer = null;
    const state = {
      tickets: [],
      loading: true,
      error: '',
      open: null, // ticket detail object when expanded
      busy: false,
    };

    await refresh();
    pollTimer = setInterval(refresh, POLL_MS);

    // Cleanup when the screen gets replaced. The shell calls mount on new
    // screens, which clears `root`; the timer would otherwise keep firing.
    new MutationObserver((muts, obs) => {
      if (!document.contains(root)) {
        clearInterval(pollTimer);
        obs.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });

    async function refresh() {
      try {
        const r = await api('/equipment-tickets/active');
        state.tickets = r.tickets || [];
        state.loading = false;
        state.error = '';
      } catch (e) {
        state.error = e.message;
      }
      render();
    }

    function render() {
      root.innerHTML = '';
      if (state.open) return renderDetail();
      const wrap = document.createElement('div');
      if (state.loading) {
        wrap.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;
      } else if (state.error) {
        wrap.innerHTML = `<div class="empty"><div class="ico">⚠️</div><div>${esc(state.error)}</div></div>`;
      } else if (!state.tickets.length) {
        wrap.innerHTML = `<div class="empty"><div class="ico">📋</div><div>No active tickets</div></div>`;
      } else {
        wrap.innerHTML = `<div class="section-title">${state.tickets.length} ticket${state.tickets.length === 1 ? '' : 's'}</div><div class="list" data-list></div>`;
        const list = wrap.querySelector('[data-list]');
        for (const t of state.tickets) list.appendChild(ticketCard(t));
      }
      root.appendChild(wrap);
    }

    function ticketCard(t) {
      const filledCount = countFilled(t);
      const totalQty = t.total_quantity || 0;
      const card = document.createElement('div');
      card.className = 'card tap';
      card.innerHTML = `
        <div class="row" style="gap:8px;align-items:flex-start">
          <div class="grow">
            <h3 style="margin:0">#${esc(t.ticket_number)} — ${esc(t.project_number || '—')}</h3>
            <div class="meta">${esc(t.requestor_name || 'No requestor')}${t.pickup_person ? ` • Pickup: ${esc(t.pickup_person)}` : ''}</div>
          </div>
          ${statusBadge(t.status, filledCount, totalQty)}
        </div>
      `;
      card.onclick = async () => {
        state.busy = true; render();
        try {
          const r = await api('/equipment-tickets/' + t.ticket_number);
          state.open = { ...r, ticket_number: t.ticket_number };
          state.busy = false;
          render();
        } catch (e) {
          ctx.toast(e.message, 'danger');
          state.busy = false;
          render();
        }
      };
      return card;
    }

    function renderDetail() {
      const t = state.open;
      const lines = t.lines || [];
      const filled = currentFilled(t);
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <button class="btn secondary" data-action="back" style="margin-bottom:12px">← Back</button>
        <div class="card">
          <h3 style="margin:0">Ticket #${esc(t.ticket_number)}</h3>
          <div class="meta">${esc(t.project?.project_number || '—')}</div>
          ${t.project?.pickup_person ? `<div class="small" style="margin-top:6px">Pickup: ${esc(t.project.pickup_person)}</div>` : ''}
          ${t.project?.location_address ? `<div class="small">Location: ${esc(t.project.location_address)}</div>` : ''}
        </div>

        <div class="section-title">Requested</div>
        ${lines.length === 0 ? '<div class="empty">No lines</div>' : ''}
        ${lines.map(l => `
          <div class="card">
            <div class="row">
              <div class="grow">
                <div><b>${esc(l.equipment_name || l.equipment_type || '—')}</b></div>
                <div class="meta">${esc([l.equipment_type, l.manufacturer].filter(Boolean).join(' • '))}</div>
              </div>
              <div class="badge muted">×${esc(l.quantity || 1)}</div>
            </div>
          </div>
        `).join('')}

        <div class="section-title">Filled (${filled.length})</div>
        ${filled.length === 0 ? '<div class="muted small" style="padding:0 4px">Nothing scanned yet.</div>' : ''}
        <div class="list">
          ${filled.map((f, i) => `
            <div class="card" style="padding:10px 12px">
              <div class="row">
                <div class="grow">
                  <div><b>${esc(f.equipment_name || '—')}</b></div>
                  <div class="meta">${esc(f.equipment_number || f.barcode_id || '')}</div>
                </div>
                <button class="remove" data-unfill="${i}">×</button>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="btn-row" style="margin-top:16px">
          <button class="btn accent" data-action="scan" ${state.busy ? 'disabled' : ''}>📷 Scan to fill</button>
          <button class="btn ok" data-action="ready" ${state.busy || filled.length === 0 ? 'disabled' : ''}>Ready for Pickup</button>
        </div>
      `;
      root.appendChild(wrap);

      wrap.querySelector('[data-action="back"]').onclick = () => { state.open = null; render(); refresh(); };
      wrap.querySelector('[data-action="scan"]').onclick = scanAndFill;
      wrap.querySelector('[data-action="ready"]').onclick = markReady;
      wrap.querySelectorAll('[data-unfill]').forEach(b => {
        b.onclick = () => {
          const i = parseInt(b.dataset.unfill, 10);
          const cur = currentFilled(state.open);
          cur.splice(i, 1);
          // Persist immediately.
          pushFilled(cur);
        };
      });
    }

    async function scanAndFill() {
      const { showScanner } = await import('../lib/scan.js');
      let item;
      try {
        await showScanner({
          title: 'Scan equipment barcode',
          onLookup: async (code) => {
            try {
              item = await api('/equipment/barcode/' + encodeURIComponent(code));
              return !!item;
            } catch { return false; }
          },
        });
      } catch (e) {
        if (e.message !== 'cancelled') ctx.toast(e.message, 'danger');
        return;
      }
      if (!item) return;
      const cur = currentFilled(state.open);
      // Skip duplicates by barcode_id.
      if (cur.some(f => (f.equipment_number || f.barcode_id) === item.barcode_id)) {
        ctx.toast('Already scanned', 'danger');
        return;
      }
      cur.push({
        equipment_number: item.barcode_id,
        equipment_name: item.equipment_name,
        source: 'mobile_scan',
      });
      await pushFilled(cur);
    }

    async function pushFilled(items) {
      state.busy = true; render();
      try {
        await api(`/equipment-tickets/${state.open.ticket_number}/fill`, {
          method: 'POST',
          body: JSON.stringify({ items }),
        });
        // Refresh the open ticket detail.
        const r = await api('/equipment-tickets/' + state.open.ticket_number);
        state.open = { ...r, ticket_number: state.open.ticket_number };
      } catch (e) {
        ctx.toast(e.message, 'danger');
      } finally {
        state.busy = false;
        render();
      }
    }

    async function markReady() {
      state.busy = true; render();
      try {
        await api(`/equipment-tickets/${state.open.ticket_number}/ready`, { method: 'POST', body: JSON.stringify({}) });
        ctx.toast(`Ticket #${state.open.ticket_number} marked ready — email sent to PM`, 'ok');
        state.open = null;
        await refresh();
      } catch (e) {
        ctx.toast(e.message, 'danger');
        state.busy = false;
        render();
      }
    }
  },
};

function countFilled(t) {
  const lines = t.lines || [];
  const first = lines[0];
  if (!first?.filled_items) return 0;
  const arr = parseFilled(first.filled_items);
  return arr.length;
}
function currentFilled(t) {
  const lines = t.lines || [];
  const first = lines[0];
  if (!first?.filled_items) return [];
  return parseFilled(first.filled_items);
}
function parseFilled(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) || []; } catch { return []; }
}
function statusBadge(status, filled, total) {
  if (status === 'ready_for_pickup') return '<div class="badge ok">Ready</div>';
  if (status === 'picked_up') return '<div class="badge muted">Picked up</div>';
  if (filled >= total && total > 0) return '<div class="badge warn">Filled</div>';
  if (filled > 0) return `<div class="badge warn">${filled}/${total || '?'}</div>`;
  return '<div class="badge muted">Open</div>';
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
