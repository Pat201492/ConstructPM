// ConstructPM Mobile shell.
//
// Boot order:
//   1. Try to rehydrate session from localStorage 'token' via GET /auth/me.
//   2. Pick a profile (PM / shop / other) from user.role.
//   3. Hash router takes over (#login, #pm/quick-bid, #shop/active, etc).
//
// Screens are ES modules with a default-export object { mount(root, ctx) }.
// We lazy-import them so the initial bundle stays small and shop staff
// never download PM screens (and vice versa).

import { session, bootSession, login, logout, profile } from './lib/auth.js';

const app = document.getElementById('app');

// ── tiny toast helper ───────────────────────────────────────────
let toastTimer = null;
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2800);
}

// ── routes ──────────────────────────────────────────────────────
// Each entry: { path, title, profile, loader }.
// `loader` returns a Promise<{ mount(root, ctx) }>.
// Notifications is shared — registered under both pm and shop so each
// profile's shell can resolve it. buildTabbar() dedupes for admin so the
// bell only appears once.
const NOTIFICATIONS_ROUTE = { path: 'notifications', title: 'Inbox', loader: () => import('./shell/notifications.js') };
const ROUTES = {
  pm: [
    { path: 'quick-bid',          title: 'Quick Bid',        loader: () => import('./pm/quick-bid.js') },
    { path: 'equipment-request',  title: 'New Ticket',       loader: () => import('./pm/equipment-request.js') },
    NOTIFICATIONS_ROUTE,
  ],
  shop: [
    { path: 'active-tickets',     title: 'Active Tickets',   loader: () => import('./shop/active-tickets.js') },
    { path: 'maintenance',        title: 'Maintenance',      loader: () => import('./shop/maintenance.js') },
    { path: 'scan-to-shop',       title: 'Scan to Shop',     loader: () => import('./shop/scan-to-shop.js') },
    { path: 'equipment-entry',    title: 'New Equipment',    loader: () => import('./shop/equipment-entry.js') },
    NOTIFICATIONS_ROUTE,
  ],
};

// Icons are inline SVG strings so we don't depend on an icon font.
const TAB_ICONS = {
  'quick-bid':         '📝',
  'equipment-request': '🧰',
  'active-tickets':    '📋',
  'maintenance':       '🔧',
  'scan-to-shop':      '🏭',
  'equipment-entry':   '➕',
  'notifications':     '🔔',
};

// Global unread-count tracker. Polled every 60s (shorter when the bell
// screen itself is open — it has its own 30s poll). Used by buildTabbar
// to render a badge on the bell tab from any screen.
const badgeState = { unread: 0 };
let badgeTimer = null;

// ── boot ────────────────────────────────────────────────────────
(async function init() {
  await bootSession();
  if (!session.token) {
    location.hash = '#login';
  } else if (!location.hash || location.hash === '#login') {
    routeToDefault();
  }
  window.addEventListener('hashchange', render);
  render();
  if (session.token) startBadgePoll();
})();

// Poll unread count every 60s so the bell tab badge stays fresh on any
// screen. The notifications screen itself polls every 30s — its updates
// flow back through pokeBadge(), keeping the two in sync.
async function startBadgePoll() {
  await pokeBadge();
  if (badgeTimer) clearInterval(badgeTimer);
  badgeTimer = setInterval(pokeBadge, 60_000);
}

async function pokeBadge() {
  if (!session.token) return;
  try {
    const r = await fetch('/api/notifications/unread-count', { headers: { 'Authorization': 'Bearer ' + session.token } });
    if (!r.ok) return;
    const d = await r.json();
    const next = Number(d.unread) || 0;
    if (next !== badgeState.unread) {
      badgeState.unread = next;
      // In-place DOM patch — cheaper than re-rendering the whole shell.
      // The badge node lives inside the bell tab; create/update/remove it
      // depending on the count so the user sees the update within 60s
      // (or sooner via pokeBadge() called from the notifications screen).
      const bell = document.querySelector('[data-tab-bell] .ico');
      if (bell) {
        let badgeEl = bell.querySelector('[data-badge-count]');
        if (next > 0) {
          if (!badgeEl) {
            badgeEl = document.createElement('span');
            badgeEl.className = 'tab-badge';
            badgeEl.dataset.badgeCount = '1';
            bell.appendChild(badgeEl);
          }
          badgeEl.textContent = next > 99 ? '99+' : String(next);
        } else if (badgeEl) {
          badgeEl.remove();
        }
      }
    }
  } catch {}
}
export { pokeBadge, badgeState };

function routeToDefault() {
  const p = profile();
  // Admin lands on the first PM tab. The PM tab bar comes first in the
  // admin shell ordering, so this matches what the user sees.
  if (p === 'admin') { location.hash = `#pm/${ROUTES.pm[0].path}`; return; }
  const list = ROUTES[p];
  if (list && list.length) {
    location.hash = `#${p}/${list[0].path}`;
  } else {
    location.hash = '#no-features';
  }
}

// ── render ──────────────────────────────────────────────────────
async function render() {
  const hash = (location.hash || '').replace(/^#/, '');

  if (!session.token && hash !== 'login') {
    location.hash = '#login';
    return;
  }
  if (hash === 'login') return renderLogin();
  if (hash === 'no-features') return renderNoFeatures();

  const [prof, screenPath] = hash.split('/');
  const list = ROUTES[prof];
  if (!list) return routeToDefault();
  const route = list.find(r => r.path === screenPath);
  if (!route) {
    // Unknown screen for this profile — jump to first.
    location.hash = `#${prof}/${list[0].path}`;
    return;
  }
  // Profile guard: a shop_staff user can't reach #pm/* routes (and vice
  // versa). Admins (profile === 'admin') are allowed on either pm/* or
  // shop/* — they get the union of both tab bars in buildTabbar().
  if (profile() !== prof && profile() !== 'admin') {
    routeToDefault();
    return;
  }

  app.innerHTML = '';
  app.appendChild(buildAppbar(route.title));
  const main = document.createElement('main');
  main.className = 'main';
  app.appendChild(main);
  app.appendChild(buildTabbar(prof, screenPath));

  try {
    const mod = await route.loader();
    await mod.default.mount(main, { toast, navigate, session, logout, pokeBadge });
  } catch (e) {
    main.innerHTML = `<div class="empty"><div class="ico">⚠️</div><div>${escapeHtml(e.message || 'Failed to load screen')}</div></div>`;
  }
}

function buildAppbar(title) {
  const bar = document.createElement('header');
  bar.className = 'appbar';
  bar.innerHTML = `
    <div class="title"></div>
    <button data-logout>Sign out</button>
  `;
  bar.querySelector('.title').textContent = title;
  bar.querySelector('[data-logout]').onclick = () => { logout(); render(); };
  return bar;
}

function buildTabbar(prof, currentPath) {
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  // Admins see PM + Shop tabs concatenated so they can drive either
  // workflow from a phone without re-logging-in or context switching.
  // Each tab carries its own profile prefix in the hash so the route
  // remains unambiguous (#pm/quick-bid vs #shop/maintenance). The bell
  // (notifications) is in both ROUTES.pm and ROUTES.shop — dedupe by
  // path so admin sees one bell, not two.
  let tabs;
  if (profile() === 'admin') {
    const all = ROUTES.pm.map(r => ({ ...r, _prof: 'pm' })).concat(ROUTES.shop.map(r => ({ ...r, _prof: 'shop' })));
    const seen = new Set();
    tabs = all.filter(r => (seen.has(r.path) ? false : seen.add(r.path)));
  } else {
    tabs = (ROUTES[prof] || []).map(r => ({ ...r, _prof: prof }));
  }
  for (const r of tabs) {
    const b = document.createElement('button');
    if (r.path === currentPath && r._prof === prof) b.classList.add('active');
    const isBell = r.path === 'notifications';
    if (isBell) b.dataset.tabBell = '1';
    const badge = isBell && badgeState.unread > 0
      ? `<span class="tab-badge" data-badge-count>${badgeState.unread > 99 ? '99+' : badgeState.unread}</span>`
      : '';
    b.innerHTML = `<span class="ico">${TAB_ICONS[r.path] || '•'}${badge}</span><span>${escapeHtml(r.title)}</span>`;
    b.onclick = () => navigate(`#${r._prof}/${r.path}`);
    bar.appendChild(b);
  }
  return bar;
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function renderLogin() {
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'login';
  wrap.innerHTML = `
    <h1>ConstructPM</h1>
    <form>
      <div>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="username" autocapitalize="none" required />
      </div>
      <div>
        <label for="pass">Password</label>
        <input id="pass" type="password" autocomplete="current-password" required />
      </div>
      <button class="btn block" type="submit">Sign in</button>
      <div class="muted small" data-err style="color:var(--danger)"></div>
    </form>
  `;
  app.appendChild(wrap);
  const form = wrap.querySelector('form');
  const err = wrap.querySelector('[data-err]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await login(wrap.querySelector('#email').value.trim(), wrap.querySelector('#pass').value);
      routeToDefault();
      render();
      startBadgePoll();
    } catch (ex) {
      err.textContent = ex.message || 'Sign-in failed';
    }
  };
}

function renderNoFeatures() {
  app.innerHTML = '';
  app.appendChild(buildAppbar('ConstructPM'));
  const main = document.createElement('main');
  main.className = 'main';
  main.innerHTML = `
    <div class="empty">
      <div class="ico">📱</div>
      <h3>No mobile features for your role yet</h3>
      <p class="muted">Open ConstructPM on desktop for full access.</p>
      <a class="btn secondary" href="/" style="display:inline-block;margin-top:12px;text-decoration:none">Open desktop</a>
    </div>
  `;
  app.appendChild(main);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Register service worker. Best-effort — site works fine without it.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/mobile/sw.js', { scope: '/mobile/' }).catch(() => {});
  });
}
