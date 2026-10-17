export type AppConfig = {
  useMockApi: boolean;
  apiBaseUrl: string | null;
};

export type AppConfigInput = {
  isRelease: boolean;
  apiBaseUrl: string | undefined;
};

export function resolveAppConfig({ isRelease, apiBaseUrl }: AppConfigInput): AppConfig {
  const configuredUrl = apiBaseUrl?.trim();

  if (!configuredUrl) {
    if (isRelease) {
      throw new Error('API_BASE_URL is required for release builds');
    }
    return { useMockApi: true, apiBaseUrl: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error('API_BASE_URL must be a valid HTTPS URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('API_BASE_URL must use HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('API_BASE_URL must not contain credentials');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('API_BASE_URL must not contain a query or fragment');
  }

  const normalized = parsed.toString().replace(/\/$/, '');
  return { useMockApi: false, apiBaseUrl: normalized };
}
