// Auth state. Stores JWT under the same 'token' key as the desktop SPA so a
// login/logout on either surface is shared. On boot we hit GET /auth/me to
// rehydrate the user object (the desktop only persists the token, not the
// user payload — same here for consistency).

import { api } from './api.js';

export const session = {
  token: null,
  user: null,        // { id, email, firstName, lastName, role, ... }
  allowedTabs: [],
  features: {},
  isSuperadmin: false,
};

export async function bootSession() {
  const t = localStorage.getItem('token');
  if (!t) return false;
  session.token = t;
  try {
    const d = await api('/auth/me');
    session.user = d.user || d;
    session.allowedTabs = d.allowed_tabs || [];
    session.features = d.features || {};
    session.isSuperadmin = !!d.is_superadmin;
    return true;
  } catch {
    clearSession();
    return false;
  }
}

export async function login(email, password) {
  const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  session.token = d.accessToken;
  session.user = d.user;
  session.allowedTabs = d.allowed_tabs || [];
  session.features = d.features || {};
  session.isSuperadmin = !!d.is_superadmin;
  localStorage.setItem('token', session.token);
  return session.user;
}

export function clearSession() {
  session.token = null;
  session.user = null;
  session.allowedTabs = [];
  session.features = {};
  session.isSuperadmin = false;
  localStorage.removeItem('token');
}

export function logout() {
  clearSession();
  location.hash = '#login';
}

// Returns 'pm' | 'shop' | 'admin' | 'other' based on user.role. Admins
// get their own profile so the shell can render PM + Shop tabs together
// (admins often wear both hats and may need either workflow on a phone).
export function profile() {
  const r = session.user?.role;
  if (r === 'admin') return 'admin';
  if (r === 'project_manager') return 'pm';
  if (r === 'shop_staff') return 'shop';
  return 'other';
}
