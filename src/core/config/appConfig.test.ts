import { resolveAppConfig } from './appConfig';

describe('resolveAppConfig', () => {
  it('selects deterministic mock mode when development has no API URL', () => {
    expect(resolveAppConfig({ isRelease: false, apiBaseUrl: undefined })).toEqual({
      useMockApi: true,
      apiBaseUrl: null,
    });
  });

  it('rejects a release build without an API URL', () => {
    expect(() => resolveAppConfig({ isRelease: true, apiBaseUrl: undefined })).toThrow(
      'API_BASE_URL is required for release builds',
    );
  });

  it('uses deterministic mock data in an explicitly marked demo build', () => {
    expect(
      resolveAppConfig({ isRelease: true, apiBaseUrl: undefined, forceMockData: true }),
    ).toEqual({ useMockApi: true, apiBaseUrl: null });
  });

  it('never contacts the API from an explicitly marked demo build', () => {
    expect(
      resolveAppConfig({
        isRelease: true,
        apiBaseUrl: 'https://inventory.example',
        forceMockData: true,
      }),
    ).toEqual({ useMockApi: true, apiBaseUrl: null });
  });

  it('rejects non-HTTPS real API URLs', () => {
    expect(() =>
      resolveAppConfig({ isRelease: false, apiBaseUrl: 'http://inventory.example' }),
    ).toThrow('API_BASE_URL must use HTTPS');
  });

  it('normalizes an explicit HTTPS API URL', () => {
    expect(
      resolveAppConfig({ isRelease: true, apiBaseUrl: 'https://inventory.example/' }),
    ).toEqual({ useMockApi: false, apiBaseUrl: 'https://inventory.example' });
  });
});
