import {resolveAppConfig} from '../core/config/appConfig';
import {createApiClient} from './client';
import {createMockApiClient} from './mockClient';
import {secureSessionStore} from './sessionStore';

const config = resolveAppConfig({
  isRelease: !__DEV__,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
});

export const isMockMode = config.useMockApi;
export const api = config.useMockApi
  ? createMockApiClient()
  : createApiClient({baseUrl: config.apiBaseUrl!, sessionStore: secureSessionStore});
