import {
  fetchAllInventory,
  parseInventoryPage,
  type InventoryItem,
} from '../features/inventory/inventoryRepository.ts';

export type NativeUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  territory: string | null;
  is_platform_admin?: boolean;
  saas_mode?: boolean;
};

export type InventoryRow = InventoryItem;

export type NativeSession = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

export type NativeLogin = NativeSession & {
  success: true;
  token_type: 'Bearer';
  user: NativeUser;
};

export type MobilePairingClaim = {claimToken: string; expiresAt: string};
export type MobilePairingStatus = {status: 'pending'} | {status: 'approved'; session: NativeLogin};

export type SessionStore = {
  getSession(): Promise<NativeSession | null>;
  setSession(session: NativeSession): Promise<void>;
  clearSession(): Promise<void>;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sessionStore?: SessionStore;
  requestIdFactory?: () => string;
};

function safeMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  if ('error' in payload) {
    const error = (payload as {error?: {detail?: unknown}}).error;
    if (error && typeof error.detail === 'string' && error.detail.trim()) return error.detail;
  }
  if ('detail' in payload) {
    const detail = (payload as {detail?: unknown}).detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDateTime(value: unknown): value is string {
  return isNonEmptyString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function parseNativeSessionResponse(value: unknown): NativeSession {
  if (!isRecord(value) || value.success !== true || value.token_type !== 'Bearer' ||
      !isNonEmptyString(value.access_token) || !isNonEmptyString(value.refresh_token) ||
      !isDateTime(value.expires_at)) {
    throw new ApiError('The server returned an invalid session response.', 0);
  }
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: value.expires_at,
  };
}

function parseNativeUser(
  value: unknown,
  errorMessage = 'The server returned an invalid user response.',
  validateOptionalFlags = true,
): NativeUser {
  if (!isRecord(value) || typeof value.id !== 'number' || !Number.isInteger(value.id) ||
      !isNonEmptyString(value.email) || !isNonEmptyString(value.name) ||
      !isNonEmptyString(value.role) ||
      !(value.territory === undefined || value.territory === null || typeof value.territory === 'string') ||
      (validateOptionalFlags && !(value.is_platform_admin === undefined || typeof value.is_platform_admin === 'boolean')) ||
      (validateOptionalFlags && !(value.saas_mode === undefined || typeof value.saas_mode === 'boolean'))) {
    throw new ApiError(errorMessage, 0);
  }

  return {
    id: value.id,
    email: value.email,
    name: value.name,
    role: value.role,
    territory: value.territory ?? null,
    ...(typeof value.is_platform_admin === 'boolean' ? {is_platform_admin: value.is_platform_admin} : {}),
    ...(typeof value.saas_mode === 'boolean' ? {saas_mode: value.saas_mode} : {}),
  };
}

function parseNativeLoginResponse(value: unknown): NativeLogin {
  const session = parseNativeSessionResponse(value);
  if (!isRecord(value)) {
    throw new ApiError('The server returned an invalid session response.', 0);
  }

  return {
    ...session,
    success: true,
    token_type: 'Bearer',
    user: parseNativeUser(value.user, 'The server returned an invalid session response.', false),
  };
}

function makeRequestId(): string {
  return `mobile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function createApiClient({
  baseUrl,
  fetchImpl = fetch,
  sessionStore,
  requestIdFactory = makeRequestId,
}: ApiClientOptions) {
  const root = baseUrl.trim().replace(/\/+$/, '');
  let refreshInFlight: Promise<NativeSession> | null = null;

  async function request<T>(
    path: string,
    {token, method = 'GET', body, extraHeaders = {}}: {
      token?: string;
      method?: string;
      body?: unknown;
      extraHeaders?: Record<string, string>;
    } = {},
  ): Promise<T> {
    if (!/^https:\/\//i.test(root)) {
      throw new ApiError('The mobile API server is not configured with an HTTPS URL.', 0);
    }
    const headers: Record<string, string> = {Accept: 'application/json', ...extraHeaders};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers,
        credentials: 'omit',
        cache: 'no-store',
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
    } catch (reason) {
      if (reason instanceof TypeError) throw reason;
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) throw new ApiError('The server returned an unreadable response.', response.status);
    }
    if (!response.ok) {
      throw new ApiError(safeMessage(payload, `Request failed (${response.status}).`), response.status);
    }
    return payload as T;
  }

  async function refresh(refreshToken: string, requestId = requestIdFactory()): Promise<NativeSession> {
    const options = {
      method: 'POST',
      body: {refresh_token: refreshToken},
      extraHeaders: {'X-Request-ID': requestId},
    };
    const send = async () => {
      const result = await request<unknown>('/api/v1/auth/native/refresh', options);
      return parseNativeSessionResponse(result);
    };
    try {
      return await send();
    } catch (reason) {
      // The backend caches a refresh response for this request ID so a lost
      // response can be replayed without consuming the rotated credential.
      if (!(reason instanceof TypeError)) throw reason;
      return send();
    }
  }

  async function rotateSession(rejected: NativeSession): Promise<NativeSession> {
    if (!sessionStore) throw new ApiError('Your session is unavailable. Please sign in again.', 401);
    const latest = await sessionStore.getSession();
    if (!latest) throw new ApiError('Your session expired. Please sign in again.', 401);
    // Another request may already have rotated this pair while this request
    // was in flight. Reuse its result instead of replaying the old refresh token.
    if (latest.access_token !== rejected.access_token) return latest;

    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        const renewed = await refresh(latest.refresh_token);
        const nextSession: NativeSession = {
          access_token: renewed.access_token,
          refresh_token: renewed.refresh_token,
          expires_at: renewed.expires_at,
        };
        await sessionStore.setSession(nextSession);
        return nextSession;
      })().finally(() => { refreshInFlight = null; });
    }

    try {
      return await refreshInFlight;
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await sessionStore.clearSession();
      }
      throw reason;
    }
  }

  async function authenticated<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    if (!sessionStore) throw new ApiError('Please sign in to continue.', 401);
    const session = await sessionStore.getSession();
    if (!session?.access_token || !session.refresh_token || !session.expires_at) {
      throw new ApiError('Please sign in to continue.', 401);
    }
    try {
      return await operation(session.access_token);
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 401) throw reason;
      const renewed = await rotateSession(session);
      return operation(renewed.access_token);
    }
  }

  return {
    async login({email, password, rememberMe = false}: {email: string; password: string; rememberMe?: boolean}) {
      const {csrf_token: csrfToken} = await request<{csrf_token: string}>('/api/v1/csrf-token');
      if (!csrfToken) throw new ApiError('The server did not provide a security token.', 0);
      const result = await request<unknown>('/api/v1/auth/native/login', {
        method: 'POST',
        body: {email: email.trim(), password, remember_me: rememberMe},
        extraHeaders: {'X-CSRF-Token': csrfToken},
      });
      return parseNativeLoginResponse(result);
    },
    async claimMobilePairing(qrData: string, deviceName: string): Promise<MobilePairingClaim> {
      const result = await request<unknown>('/api/v1/auth/mobile-pairing/claim', {
        method: 'POST',
        body: {qr_data: qrData, device_name: deviceName},
      });
      if (!isRecord(result) || !isNonEmptyString(result.claim_token) || !isDateTime(result.expires_at)) {
        throw new ApiError('The pairing request could not be started.', 0);
      }
      return {claimToken: result.claim_token, expiresAt: result.expires_at};
    },
    async completeMobilePairing(claimToken: string): Promise<MobilePairingStatus> {
      const result = await request<unknown>('/api/v1/auth/mobile-pairing/complete', {
        method: 'POST',
        body: {claim_token: claimToken},
      });
      if (!isRecord(result)) throw new ApiError('The pairing response was invalid.', 0);
      if (result.status === 'pending') return {status: 'pending'};
      if (result.status === 'approved') {
        return {status: 'approved', session: parseNativeLoginResponse(result)};
      }
      throw new ApiError('The pairing response was invalid.', 0);
    },
    refresh,
    getSession() {
      return sessionStore?.getSession() ?? Promise.resolve(null);
    },
    saveSession(session: NativeSession) {
      if (!sessionStore) throw new ApiError('Secure session storage is unavailable.', 0);
      return sessionStore.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      });
    },
    clearSession() {
      return sessionStore?.clearSession() ?? Promise.resolve();
    },
    getMe() {
      return authenticated(async token => {
        const response = await request<unknown>('/api/v1/me', {token});
        return parseNativeUser(response);
      });
    },
    async getInventory(): Promise<InventoryRow[]> {
      return authenticated(token => fetchAllInventory({
        async fetchPage({limit, cursor}) {
          const query = cursor === null
            ? `?limit=${limit}`
            : `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
          const response = await request<unknown>(`/api/v1/inventory${query}`, {token});
          try {
            return parseInventoryPage(response);
          } catch {
            throw new ApiError('The server returned an invalid inventory response.', 0);
          }
        },
      }));
    },
    logout() {
      return authenticated(async token => {
        const result = await request<{success: boolean}>('/api/v1/auth/logout', {token, method: 'POST'});
        if (result.success) await sessionStore?.clearSession();
        return result;
      });
    },
  };
}

export type MobileApi = ReturnType<typeof createApiClient>;
