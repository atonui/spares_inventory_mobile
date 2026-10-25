import {fireEvent, render, waitFor} from '@testing-library/react-native';
import OfflineChangesScreen from '../src/app/offline-changes';
import {api} from '../src/api/runtime';
import {offlineStockStore} from '../src/features/inventory/offlineStockStore';

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({useRouter: () => ({back: mockBack, push: mockPush})}));
jest.mock('../src/api/runtime', () => ({api: {adjustStock: jest.fn()}}));
jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    getActiveUserId: jest.fn(async () => 7),
    list: jest.fn(async () => [
      {operationId: 'queued-1', userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 6,
        createdAt: 1000, status: 'queued', error: null},
      {operationId: 'conflict-1', userId: 7, inventoryId: 12, expectedQuantity: 1, newQuantity: 3,
        createdAt: 2000, status: 'conflict', error: 'Stock changed on the server.'},
    ]),
    loadInventorySnapshot: jest.fn(async () => [
      {id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null},
      {id: 12, partId: 102, storeId: 1, partNumber: 'PART-12', description: 'Drive belt',
        storeName: 'Service van 3', storeType: 'vehicle', storeOwner: 7, quantity: 1,
        minThreshold: 1, isAllocated: false, workOrder: null},
    ]),
    subscribeQueueChanges: jest.fn(() => () => undefined),
    remove: jest.fn(async () => undefined),
    enqueue: jest.fn(),
    markConflict: jest.fn(),
  },
}));

describe('offline changes screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows queued changes and conflicts with their stock items and counts', async () => {
    const screen = await render(<OfflineChangesScreen />);

    await waitFor(() => expect(screen.getByText('PART-11')).toBeTruthy());
    expect(screen.getByText('PART-12')).toBeTruthy();
    expect(screen.getByText('Store: Main')).toBeTruthy();
    expect(screen.getByText('Store: Service van 3')).toBeTruthy();
    expect(screen.getByLabelText('Stock count changes from 4 to 6')).toBeTruthy();
    expect(screen.getByLabelText('Stock count changes from 1 to 3')).toBeTruthy();
    expect(screen.getAllByText('Waiting to sync')).toHaveLength(2);
    expect(screen.getByText('Need review')).toBeTruthy();
    expect(screen.getByText('Stock changed on the server.')).toBeTruthy();
  });

  it('opens the inventory item for a conflicted change', async () => {
    const screen = await render(<OfflineChangesScreen />);

    await waitFor(() => expect(screen.getByText('PART-12')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Review PART-12'}));

    expect(mockPush).toHaveBeenCalledWith({pathname: '/inventory/[itemId]', params: {itemId: '12', userId: '7'}});
  });

  it('keeps pending edits and explains when sync is blocked by a connection failure', async () => {
    (api.adjustStock as jest.Mock).mockRejectedValue(new Error('Network unavailable'));
    const screen = await render(<OfflineChangesScreen />);

    await waitFor(() => expect(screen.getByText('PART-11')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Sync changes now'}));

    await waitFor(() => expect(screen.getByText('No connection to the server. Your changes remain saved on this device.')).toBeTruthy());
    expect(offlineStockStore.remove).not.toHaveBeenCalled();
    expect(api.adjustStock).toHaveBeenCalledWith(expect.objectContaining({operationId: 'queued-1'}));
  });

  it('requires confirmation before discarding a conflicted count', async () => {
    const screen = await render(<OfflineChangesScreen />);

    await waitFor(() => expect(screen.getByText('PART-12')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Discard PART-12 change'}));

    expect(screen.getByText('Discard this stock change?')).toBeTruthy();
    expect(offlineStockStore.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', {name: 'Confirm discard'}));
    await waitFor(() => expect(offlineStockStore.remove).toHaveBeenCalledWith('conflict-1'));
  });
});
