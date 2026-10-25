import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {Keyboard} from 'react-native';
import {ApiError} from '../src/api/client';
import {api} from '../src/api/runtime';
import {offlineStockStore} from '../src/features/inventory/offlineStockStore';
import InventoryScreen from '../src/app/index';
import {clearInventorySnapshot, getCachedInventoryItem} from '../src/features/inventory/inventorySnapshot';


async function pairFromPreview(screen: ReturnType<typeof render>) {
  await waitFor(() => expect(screen.getByText('Sign in through your desktop account')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', {name: 'Try preview pairing'}));
  await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy(), {timeout: 5000});
}

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockItemId = '2';
let mockNetworkListener: ((state: {isConnected: boolean; isInternetReachable: boolean}) => void) | null = null;

jest.mock('expo-network', () => ({addNetworkStateListener: (listener: typeof mockNetworkListener) => {
  mockNetworkListener = listener;
  return {remove: jest.fn()};
}}));
jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    list: async () => [], enqueue: async () => undefined, remove: async () => undefined,
    markConflict: async () => undefined,
    saveInventorySnapshot: async () => undefined, loadInventorySnapshot: async () => null,
    getInventorySnapshotSavedAt: async () => Date.now(), subscribeQueueChanges: () => () => undefined,
    saveProfile: async () => undefined, loadProfile: async () => null,
    getActiveUserId: async () => null, setActiveUserId: async () => undefined,
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({push: mockPush, back: mockBack}),
  useLocalSearchParams: () => ({itemId: mockItemId}),
}));

describe('inventory device-pairing flow', () => {
  it('renders desktop pairing guidance on initial load', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Sign in through your desktop account')).toBeTruthy());
    expect(screen.getByText('Spares Tracker')).toBeTruthy();
    expect(screen.getByText('Everything in its place.')).toBeTruthy();
  });

  it('restores a saved session and loads inventory without showing sign-in', async () => {
    const session = await api.login({email: 'field@company.example', password: 'preview-password', rememberMe: true});
    await api.saveSession(session);
    const getMe = jest.spyOn(api, 'getMe');

    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Good to see you, Preview')).toBeTruthy();
    expect(screen.getByText('Saved inventory')).toBeTruthy();
    expect(screen.getByText('Last refreshed · Updated just now')).toBeTruthy();
    expect(screen.queryByText('Sign in through your desktop account')).toBeNull();
    getMe.mockRestore();
  });

  it('clears an expired session and returns to sign-in', async () => {
    const session = await api.login({email: 'field@company.example', password: 'preview-password', rememberMe: true});
    await api.saveSession(session);
    const getMe = jest.spyOn(api, 'getMe').mockRejectedValue(new ApiError('Expired session', 401));

    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Your session expired. Please sign in again.')).toBeTruthy());
    expect(await api.getSession()).toBeNull();
    expect(screen.queryByText('Inventory')).toBeNull();
    getMe.mockRestore();
  });

  it.each([
    {status: 401, message: 'Your session expired. Please sign in again.'},
    {status: 403, message: 'This account does not have an active company membership.'},
  ])('does not show cached inventory after an API $status response', async ({status, message}) => {
    const session = await api.login({email: 'field@company.example', password: 'preview-password', rememberMe: true});
    await api.saveSession(session);
    const cachedRows = await api.getInventory();
    const loadSnapshot = jest.spyOn(offlineStockStore, 'loadInventorySnapshot').mockResolvedValue(cachedRows);
    jest.spyOn(api, 'getInventory').mockRejectedValue(new ApiError('Access denied', status));

    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(await api.getSession()).toBeNull();
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();
  });

  it('clears the session when a network refresh reveals a 403 response', async () => {
    const screen = await render(<InventoryScreen />);
    await pairFromPreview(screen);
    jest.spyOn(api, 'getInventory').mockRejectedValue(new ApiError('Access denied', 403));

    mockNetworkListener?.({isConnected: true, isInternetReachable: true});

    await waitFor(() => expect(screen.getByText('This account does not have an active company membership.')).toBeTruthy());
    expect(await api.getSession()).toBeNull();
  });

  it('keeps a session after a temporary restore failure and retries successfully', async () => {
    const session = await api.login({email: 'field@company.example', password: 'preview-password', rememberMe: true});
    await api.saveSession(session);
    const getMe = jest.spyOn(api, 'getMe').mockRejectedValueOnce(new Error('Connection lost'));

    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Connection lost')).toBeTruthy());
    expect(await api.getSession()).not.toBeNull();
    await fireEvent.press(screen.getByRole('button', {name: 'Retry'}));

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(await api.getSession()).not.toBeNull();
    getMe.mockRestore();
  });

  it('shows a retryable pairing error when a QR code is rejected', async () => {
    jest.spyOn(api, 'claimMobilePairing').mockRejectedValue(new Error('This QR code is invalid or has expired.'));
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Sign in through your desktop account')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Try preview pairing'}));

    await waitFor(() => expect(screen.getByText('This QR code is invalid or has expired.')).toBeTruthy());
    expect(screen.getByRole('button', {name: 'Use preview QR'})).toBeTruthy();
    expect(screen.queryByText('Inventory')).toBeNull();
  });

  it('opens the camera permission step from pairing instructions', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Sign in through your desktop account')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Scan QR code'}));
    expect(screen.getByText('Camera access is needed to scan your QR code')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Allow camera'})).toBeTruthy();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await api.clearSession();
    clearInventorySnapshot();
    mockPush.mockClear();
    mockBack.mockClear();
    mockItemId = '2';
    mockNetworkListener = null;
  });

  it('pairs a preview device and opens the read-only inventory preview', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    expect(screen.getByText('Spares Tracker')).toBeTruthy();
    expect(screen.getByText('6190901970')).toBeTruthy();
    expect(getCachedInventoryItem(2)?.partNumber).toBe('110245012');
    expect(screen.getAllByText('LOW STOCK').length).toBeGreaterThan(0);
    expect(screen.queryByText('Adjust stock')).toBeNull();

    await fireEvent.press(screen.getByRole('button', {name: 'Sign out'}));
    await waitFor(() => expect(screen.getByText('Sign in through your desktop account')).toBeTruthy());
    expect(getCachedInventoryItem(2)).toBeUndefined();
  });

  it('asks before signing out when offline stock changes are still saved', async () => {
    const screen = await render(<InventoryScreen />);
    await pairFromPreview(screen);
    jest.spyOn(offlineStockStore, 'list').mockResolvedValue([
      {operationId: 'queued-1', userId: 1, inventoryId: 1, expectedQuantity: 2, newQuantity: 4,
        createdAt: 1000, status: 'queued', error: null},
      {operationId: 'conflict-1', userId: 1, inventoryId: 2, expectedQuantity: 1, newQuantity: 3,
        createdAt: 2000, status: 'conflict', error: 'Stock changed on the server.'},
    ]);
    const remove = jest.spyOn(offlineStockStore, 'remove');
    const logout = jest.spyOn(api, 'logout');

    await fireEvent.press(screen.getByRole('button', {name: 'Sign out'}));

    await waitFor(() => expect(screen.getByText(/2 unsynced stock changes are saved on this device/)).toBeTruthy());
    expect(logout).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', {name: 'Stay signed in'}));
    expect(screen.getByText('Inventory')).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', {name: 'Sign out'}));
    await waitFor(() => expect(screen.getByText('Keep your offline changes?')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Sign out and keep changes'}));
    await waitFor(() => expect(screen.getByText('Sign in through your desktop account')).toBeTruthy());
    expect(logout).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not report empty stock when the inventory request fails, and retries cleanly', async () => {
    const inventoryRequest = jest.spyOn(api, 'getInventory')
      .mockRejectedValueOnce(new Error('Inventory service unavailable'));
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);

    await waitFor(() => expect(screen.getByText('Inventory service unavailable')).toBeTruthy());
    expect(screen.queryByText('No stock to show')).toBeNull();
    expect(screen.queryByText('No matching stock')).toBeNull();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.press(screen.getByText('Retry'));

    await waitFor(() => expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy());
    expect(screen.queryByText('Inventory service unavailable')).toBeNull();
    inventoryRequest.mockRestore();
  });

  it('shows cached inventory age and queued changes while offline', async () => {
    const cachedRows = await api.getInventory();
    jest.spyOn(api, 'getInventory').mockRejectedValue(new Error('Network unavailable'));
    jest.spyOn(offlineStockStore, 'loadInventorySnapshot').mockResolvedValue(cachedRows);
    jest.spyOn(offlineStockStore, 'getInventorySnapshotSavedAt').mockResolvedValue(Date.now() - 2 * 60 * 60 * 1000);
    jest.spyOn(offlineStockStore, 'list').mockResolvedValue([{
      operationId: 'f0bb08a1-bc7b-4f6a-b8af-ced2fd686de9', userId: 1, inventoryId: 1,
      expectedQuantity: 2, newQuantity: 3, createdAt: Date.now(), status: 'queued', error: null,
    }]);

    const screen = await render(<InventoryScreen />);
    await pairFromPreview(screen);

    await waitFor(() => expect(screen.getByText('Offline · saved inventory')).toBeTruthy());
    expect(screen.getByText('Last refreshed · Updated 2 hrs ago')).toBeTruthy();
    expect(screen.getByText('1 waiting to sync')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', {name: 'Review offline changes'}));
    expect(mockPush).toHaveBeenCalledWith('/offline-changes');
  });

  it('navigates to an inventory item detail using the item ID', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Search inventory'), '110245012');
    await fireEvent.press(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'}));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/inventory/[itemId]',
      params: {itemId: '2', userId: '1'},
    });
  });

  it('opens inventory scanning with the signed-in user scope', async () => {
    const screen = await render(<InventoryScreen />);
    await pairFromPreview(screen);

    await fireEvent.press(screen.getByRole('button', {name: 'Scan barcode or QR code'}));

    expect(mockPush).toHaveBeenCalledWith({pathname: '/scan', params: {userId: '1'}});
  });

  it('shows inventory-shaped skeleton rows during the first inventory load', async () => {
    const session = await api.login({email: 'field@company.example', password: 'preview-password', rememberMe: true});
    await api.saveSession(session);
    const rows = await api.getInventory();
    let resolveInventory: ((items: typeof rows) => void) | undefined;
    jest.spyOn(api, 'getInventory').mockImplementation(() => new Promise(resolve => { resolveInventory = resolve; }));

    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByLabelText('Loading inventory')).toBeTruthy());
    expect(screen.getByRole('button', {name: 'Scan barcode or QR code'})).toBeTruthy();
    resolveInventory?.(rows);
    await waitFor(() => expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy());
  });

  it('dismisses the keyboard on search submit and before opening a stock item', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss');
    const searchInput = screen.getByLabelText('Search inventory');
    await fireEvent.changeText(searchInput, '110245012');
    await fireEvent(searchInput, 'submitEditing');
    expect(dismissKeyboard).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'}));
    expect(dismissKeyboard).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/inventory/[itemId]',
      params: {itemId: '2', userId: '1'},
    });
    dismissKeyboard.mockRestore();
  });

  it('filters inventory status and combines the filter with local search', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    await fireEvent.press(screen.getByRole('radio', {name: 'Low stock'}));

    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'View M-410720, Magnetron control cable'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.press(screen.getByRole('radio', {name: 'Allocated'}));
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();

    await fireEvent.press(screen.getByRole('radio', {name: 'Available'}));
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeNull();

    await fireEvent.press(screen.getByRole('radio', {name: 'Low stock'}));
    await fireEvent.changeText(screen.getByLabelText('Search inventory'), '6190901970');
    expect(screen.getByText('No matching stock')).toBeTruthy();

    await fireEvent.press(screen.getByRole('radio', {name: 'All'}));
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
  });

  it('shows counts for each inventory status filter', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    expect(screen.getByRole('radio', {name: 'All'})).toHaveTextContent('All · 4');
    expect(screen.getByRole('radio', {name: 'Low stock'})).toHaveTextContent('Low stock · 1');
    expect(screen.getByRole('radio', {name: 'Out of stock'})).toHaveTextContent('Out of stock · 1');
    expect(screen.getByRole('radio', {name: 'Available'})).toHaveTextContent('Available · 3');
    expect(screen.getByRole('radio', {name: 'Allocated'})).toHaveTextContent('Allocated · 1');
    await fireEvent.press(screen.getByRole('radio', {name: 'Out of stock'}));
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeNull();
  });

  it('finds allocated stock by its work-order number', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'wo-004537370');

    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
  });

  it('searches by a human-readable inventory location type', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'CUSTOMER SITE');
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
    expect(screen.getByText('Showing 1 of 4 items')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'warehouse');
    expect(screen.getByText('Showing 2 of 4 items')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'engineer');
    expect(screen.getByRole('button', {name: 'View M-410720, Magnetron control cable'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
  });

  it('matches search terms across fields and normalizes work-order punctuation', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    const search = screen.getByLabelText('Search inventory');
    await fireEvent.changeText(search, 'coast cooling');
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
    expect(screen.getByText('Showing 1 of 4 items')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.changeText(search, 'WO 004537370');
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.getByText('Showing 1 of 4 items')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
  });

  it('sorts inventory by lowest quantity without breaking search and filters', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    await fireEvent.press(screen.getByRole('radio', {name: 'Lowest stock'}));
    const inventoryLabels = screen.getAllByRole('button')
      .map(button => button.props.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string' && label.startsWith('View '));
    expect(inventoryLabels).toEqual([
      'View D-008214, Cooling fan assembly',
      'View 110245012, PCB THYRATRON GRID CONTROL',
      'View M-410720, Magnetron control cable',
      'View 6190901970, THYRATRON CX1140LG',
    ]);

    await fireEvent.press(screen.getByRole('radio', {name: 'Low stock'}));
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'cooling');
    expect(screen.getByText('No matching stock')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeNull();
  });

  it('shows an accessible clear-search action and restores all matching rows', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Search inventory'), '6190901970');

    expect(screen.getByRole('button', {name: 'Clear search'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeNull();

    await fireEvent.press(screen.getByRole('button', {name: 'Clear search'}));

    expect(screen.getByLabelText('Search inventory').props.value).toBe('');
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Clear search'})).toBeNull();
  });

  it('clears search, filter, and sort from the no-results state', async () => {
    const screen = await render(<InventoryScreen />);

    await pairFromPreview(screen);
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    await fireEvent.press(screen.getByRole('radio', {name: 'Low stock'}));
    await fireEvent.press(screen.getByRole('radio', {name: 'Lowest stock'}));
    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'no-such-part');

    expect(screen.getByText('No matching stock')).toBeTruthy();
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss');
    await fireEvent.press(screen.getByRole('button', {name: 'Clear search and filters'}));

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    dismissKeyboard.mockRestore();
    expect(screen.getByLabelText('Search inventory').props.value).toBe('');
    expect(screen.getByRole('radio', {name: 'All'}).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('radio', {name: 'Default'}).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
  });
});
