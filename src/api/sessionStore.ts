import * as SecureStore from 'expo-secure-store';
import type {NativeSession, SessionStore} from './client';

const SESSION_KEY = 'native-session-token';

function isNativeSession(value: unknown): value is NativeSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.access_token === 'string' &&
    typeof candidate.refresh_token === 'string' &&
    typeof candidate.expires_at === 'string';
}

export const secureSessionStore: SessionStore = {
  async getSession() {
    const stored = await SecureStore.getItemAsync(SESSION_KEY);
    if (!stored) return null;
    try {
      const value: unknown = JSON.parse(stored);
      if (isNativeSession(value)) return value;
    } catch {
      // A malformed or old token entry is discarded below.
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  },
  async setSession(session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },
  async clearSession() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
