// Notifications — mobile bell, shared across PM and Shop profiles.
//
// Poll cadence:
//   - List + unread count refresh every 30s while this screen is mounted.
//   - Pull-to-refresh is intentionally omitted in v1 — the explicit
//     refresh button at the top covers the same intent without us
//     fighting the browser's native pull-to-reload on Safari.
//
// Behaviour on tap:
//   - Always marks the notification read (PATCH /:id/read).
//   - For reference types the mobile shell can route to internally
//     (equipment_ticket → active-tickets screen for shop) we navigate.
//     For everything else we just show a "Open in desktop" link so the
//     PM can jump to the full UI if needed.

import { api } from '../lib/api.js';

const POLL_MS = 30_000;

export default {
  async mount(root, ctx) {
    const state = {
      items: [],
      unread: 0,
      loading: true,
      busy: false,
      error: '',
    };
    let pollTimer = null;

    await refresh();
    pollTimer = setInterval(refresh, POLL_MS);

    // When the shell swaps in a new screen, our root is detached. Tear
    // down the poll then so we don't leak intervals.
    new MutationObserver((muts, obs) => {
      if (!document.contains(root)) {
        clearInterval(pollTimer);
        obs.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });

    async function refresh() {
      try {
        const r = await api('/notifications?limit=50');
        state.items = r.notifications || r || [];
        state.unread = state.items.filter(n => !n.read).length;
        state.loading = false;
        state.error = '';
      } catch (e) {
        state.error = e.message;
      }
      render();
    }

    async function markRead(n) {
      if (n.read) return;
      // Optimistic update — flip locally first, then PATCH. Roll back on
      // failure so the UI doesn't claim "read" while the server has it
      // unread (the badge would also drift out of sync).
      n.read = true;
      state.unread = Math.max(0, state.unread - 1);
      render();
      try {
        await api('/notifications/' + n.id + '/read', { method: 'PATCH' });
        // Refresh the global tab badge immediately rather than waiting
        // for the 60s shell poll to catch up.
        ctx.pokeBadge?.();
      } catch (e) {
        n.read = false;
        state.unread = state.unread + 1;
        render();
        ctx.toast(e.message, 'danger');
      }
    }

    async function markAllRead() {
      if (!state.items.some(n => !n.read)) return;
      state.busy = true; render();
      try {
        await api('/notifications/read-all', { method: 'POST' });
        for (const n of state.items) n.read = true;
        state.unread = 0;
        ctx.toast('All notifications marked read', 'ok');
        ctx.pokeBadge?.();
      } catch (e) {
        ctx.toast(e.message, 'danger');
      } finally {
        state.busy = false;
        render();
      }
    }

    function navigateForReference(n) {
      // For now, only equipment_ticket has a mobile screen. Everything
      // else just marks read and stays on the bell.
      if (n.reference_type === 'equipment_ticket') {
        ctx.navigate('#shop/active-tickets');
      }
    }

    function render() {
      root.innerHTML = '';
      const wrap = document.createElement('div');
      // Header is always rendered when not in initial-load spinner state,
      // so the user can manually refresh from any state (empty, error,
      // or populated). Empty state previously hid the refresh button and
      // left the user stuck waiting for the 30s auto-poll.
      const header = `
        <div class="row" style="align-items:center;margin:0 4px 8px">
          <div class="grow muted small">${state.unread} unread of ${state.items.length}</div>
          <button class="btn secondary" data-refresh ${state.busy ? 'disabled' : ''}>Refresh</button>
          <button class="btn secondary" data-mark-all style="margin-left:6px" ${state.busy || state.unread === 0 ? 'disabled' : ''}>Mark all read</button>
        </div>
      `;
      if (state.loading) {
        wrap.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;
      } else if (state.error) {
        wrap.innerHTML = header + `<div class="empty"><div class="ico">⚠️</div><div>${esc(state.error)}</div></div>`;
      } else if (!state.items.length) {
        wrap.innerHTML = header + `<div class="empty"><div class="ico">🔔</div><div>No notifications</div></div>`;
      } else {
        wrap.innerHTML = header + `<div class="list" data-list></div>`;
        const list = wrap.querySelector('[data-list]');
        for (const n of state.items) list.appendChild(notifCard(n));
      }
      root.appendChild(wrap);

      const refreshBtn = wrap.querySelector('[data-refresh]');
      if (refreshBtn) refreshBtn.onclick = () => { state.loading = true; render(); refresh(); };
      const markAllBtn = wrap.querySelector('[data-mark-all]');
      if (markAllBtn) markAllBtn.onclick = markAllRead;
    }

    function notifCard(n) {
      const card = document.createElement('div');
      card.className = 'card tap';
      if (!n.read) card.style.borderLeft = '3px solid var(--accent)';
      const symbol = n.category === 'actionable' ? '⚡ ' : (n.priority === 'high' ? '⚠️ ' : '');
      const time = relTime(n.created_at);
      card.innerHTML = `
        <div class="row" style="gap:8px;align-items:flex-start">
          <div class="grow">
            <div style="font-weight:${n.read ? '500' : '600'}">${symbol}${esc(n.title || '—')}</div>
            ${n.body ? `<div class="muted small" style="margin-top:4px;white-space:pre-line">${esc(n.body)}</div>` : ''}
            <div class="muted small" style="margin-top:6px">${esc(time)}</div>
          </div>
          ${!n.read ? '<div class="badge warn">New</div>' : ''}
        </div>
      `;
      card.onclick = async () => {
        await markRead(n);
        navigateForReference(n);
      };
      return card;
    }
  },
};

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
