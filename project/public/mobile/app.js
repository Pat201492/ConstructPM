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
const ROUTES = {
  pm: [
    { path: 'quick-bid',          title: 'Quick Bid',        loader: () => import('./pm/quick-bid.js') },
    { path: 'equipment-request',  title: 'New Ticket',       loader: () => import('./pm/equipment-request.js') },
  ],
  shop: [
    { path: 'active-tickets',     title: 'Active Tickets',   loader: () => import('./shop/active-tickets.js') },
    { path: 'maintenance',        title: 'Maintenance',      loader: () => import('./shop/maintenance.js') },
    { path: 'scan-to-shop',       title: 'Scan to Shop',     loader: () => import('./shop/scan-to-shop.js') },
    { path: 'equipment-entry',    title: 'New Equipment',    loader: () => import('./shop/equipment-entry.js') },
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
};

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
})();

function routeToDefault() {
  const p = profile();
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
  // versa). Admins map to 'pm' in profile() so they're allowed on #pm/*.
  if (profile() !== prof) {
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
    await mod.default.mount(main, { toast, navigate, session, logout });
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
  for (const r of ROUTES[prof] || []) {
    const b = document.createElement('button');
    if (r.path === currentPath) b.classList.add('active');
    b.innerHTML = `<span class="ico">${TAB_ICONS[r.path] || '•'}</span><span>${escapeHtml(r.title)}</span>`;
    b.onclick = () => navigate(`#${prof}/${r.path}`);
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
