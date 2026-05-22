// Thin fetch wrapper. Mirrors the desktop helper at public/index.html:154.
// Token is read from localStorage on every call so a login/logout in the
// same tab is picked up immediately by all callers.

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem('token');
    location.hash = '#login';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  // Server-side first-login gate (PR #28 authenticate middleware) 403s
  // every non-/auth/* call until the user resets their password. Route
  // the user to the forced-reset screen instead of bubbling a confusing
  // toast — happens for users whose JWT pre-dates the migration that
  // set must_change_password=true on existing rows.
  if (res.status === 403 && data && data.must_change_password) {
    location.hash = '#force-change-password';
    throw new Error('Password change required');
  }
  if (!res.ok) throw new Error(data.error || data.message || `API error ${res.status}`);
  return data;
}

export async function apiUpload(path, formData) {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, { method: 'POST', headers, body: formData });
  if (res.status === 401) {
    localStorage.removeItem('token');
    location.hash = '#login';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data && data.must_change_password) {
    location.hash = '#force-change-password';
    throw new Error('Password change required');
  }
  if (!res.ok) throw new Error(data.error || data.message || `Upload error ${res.status}`);
  return data;
}
