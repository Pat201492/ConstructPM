import * as SecureStore from 'expo-secure-store';

// Set this to your server URL
// Dev: http://192.168.x.x:3000 (your computer's local IP)
// Prod: https://your-domain.com
const BASE_URL = __DEV__
  ? 'http://192.168.1.100:3000' // ← Change to your dev machine IP
  : 'https://your-production-server.com';

let _accessToken = null;
let _refreshToken = null;
let _onAuthFail = null; // Callback to logout

export function setAuthFailHandler(fn) { _onAuthFail = fn; }

export async function loadTokens() {
  _accessToken = await SecureStore.getItemAsync('access_token');
  _refreshToken = await SecureStore.getItemAsync('refresh_token');
}

export async function saveTokens(access, refresh) {
  _accessToken = access;
  _refreshToken = refresh;
  await SecureStore.setItemAsync('access_token', access);
  await SecureStore.setItemAsync('refresh_token', refresh);
}

export async function clearTokens() {
  _accessToken = null;
  _refreshToken = null;
  await SecureStore.deleteItemAsync('access_token');
  await SecureStore.deleteItemAsync('refresh_token');
}

export function getAccessToken() { return _accessToken; }

async function refreshAccessToken() {
  if (!_refreshToken) throw new Error('No refresh token');
  const resp = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: _refreshToken }),
  });
  if (!resp.ok) throw new Error('Refresh failed');
  const data = await resp.json();
  await saveTokens(data.access_token, data.refresh_token || _refreshToken);
  return data.access_token;
}

/**
 * Main API call function. Auto-retries once on 401 with token refresh.
 */
export async function api(path, options = {}) {
  const url = `${BASE_URL}/api${path}`;
  const headers = { ...options.headers };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  let resp = await fetch(url, { ...options, headers });

  // Auto-refresh on 401
  if (resp.status === 401 && _refreshToken) {
    try {
      const newToken = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;
      resp = await fetch(url, { ...options, headers });
    } catch {
      if (_onAuthFail) _onAuthFail();
      throw new Error('Session expired. Please log in again.');
    }
  }

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || data.message || `Error ${resp.status}`);
  return data;
}

/**
 * Upload a file via multipart form data.
 */
export async function uploadFile(path, fileUri, fieldName = 'file', extraFields = {}) {
  const fd = new FormData();
  const ext = fileUri.split('.').pop() || 'jpg';
  fd.append(fieldName, {
    uri: fileUri,
    name: `upload_${Date.now()}.${ext}`,
    type: ext === 'png' ? 'image/png' : 'image/jpeg',
  });
  for (const [k, v] of Object.entries(extraFields)) {
    fd.append(k, v);
  }
  return api(path, { method: 'POST', body: fd, headers: {} });
}

export { BASE_URL };
