import * as SecureStore from 'expo-secure-store';
import {secureSessionStore} from './sessionStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const getItemAsync = jest.mocked(SecureStore.getItemAsync);
const deleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);

describe('secure session store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('discards a saved session with an empty credential', async () => {
    getItemAsync.mockResolvedValue(JSON.stringify({
      access_token: '',
      refresh_token: 'refresh-1',
      expires_at: '2026-10-20T12:00:00Z',
    }));

    await expect(secureSessionStore.getSession()).resolves.toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('native-session-token');
  });
});
