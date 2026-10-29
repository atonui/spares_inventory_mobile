import type {NativeSession, SessionStore} from './client';

const SESSION_KEY = 'native-session-token';

// Browser sessions last for this tab. Native builds use Expo SecureStore.
export const secureSessionStore: SessionStore = {
  async getSession() {
    if (typeof window === 'undefined') return null;
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    try {
      const value: unknown = JSON.parse(stored);
      if (typeof value === 'object' && value !== null) {
        const candidate = value as Partial<NativeSession>;
        if ([candidate.access_token, candidate.refresh_token, candidate.expires_at]
          .every(field => typeof field === 'string' && field.trim().length > 0)) {
          return candidate as NativeSession;
        }
      }
    } catch {
      // Discard malformed and legacy sessions.
    }
    window.sessionStorage.removeItem(SESSION_KEY);
    return null;
  },
  async setSession(session) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      throw new Error('Allow browser storage for this site, then generate a new pairing QR code.');
    }
  },
  async clearSession() {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_KEY);
  },
};
