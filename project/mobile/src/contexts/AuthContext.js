import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api, saveTokens, clearTokens, loadTokens, setAuthFailHandler } from '../services/api';

const AuthContext = createContext(null);

// /auth/login returns the user with camelCase name fields (firstName/lastName),
// while /auth/me returns the full snake_case DB row. Screens read snake_case
// (user.first_name / user.last_name), so normalize both entry points to that
// shape to keep the contract consistent.
function normalizeUser(u) {
  if (!u) return u;
  return {
    ...u,
    first_name: u.first_name ?? u.firstName,
    last_name: u.last_name ?? u.lastName,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await clearTokens();
    setUser(null);
  }, []);

  // Set the auth-fail handler so api.js can trigger logout
  useEffect(() => { setAuthFailHandler(logout); }, [logout]);

  // Check for existing session on mount
  useEffect(() => {
    (async () => {
      await loadTokens();
      try {
        const data = await api('/auth/me');
        setUser(normalizeUser(data.user || data));
      } catch { /* no valid session */ }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await saveTokens(data.accessToken, data.refreshToken);
    const u = normalizeUser(data.user);
    setUser(u);
    // Register push token
    registerPushToken();
    return u;
  };

  const registerPushToken = async () => {
    if (!Device.isDevice) return; // Push only works on real devices
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      const tokenData = await Notifications.getExpoPushTokenAsync();
      const pushToken = tokenData.data;

      // Register with backend
      await api('/users/me/device', {
        method: 'POST',
        body: JSON.stringify({
          push_token: pushToken,
          platform: Platform.OS,
          device_name: Device.modelName || 'Unknown',
        }),
      });
    } catch (err) {
      console.log('Push token registration failed:', err.message);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
