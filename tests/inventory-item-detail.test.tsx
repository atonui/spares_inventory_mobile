import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {api} from '../src/api/runtime';
import InventoryItemDetailScreen from '../src/app/inventory/[itemId]';
import {clearInventorySnapshot, setInventorySnapshot} from '../src/features/inventory/inventorySnapshot';
import type {NativeUser} from '../src/api/client';
import type {InventoryItem} from '../src/features/inventory/inventoryRepository';
import type {QueuedStockAdjustment} from '../src/features/inventory/offlineStockQueue';

const mockBack = jest.fn();
let mockItemId = '2';
let mockProfile: NativeUser | null = null;
let mockQueue: QueuedStockAdjustment[] = [];

jest.mock('expo-network', () => ({addNetworkStateListener: () => ({remove: jest.fn()})}));
jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    list: async () => mockQueue, enqueue: async () => undefined,
    remove: async (operationId: string) => {mockQueue = mockQueue.filter(entry => entry.operationId !== operationId);},
    markConflict: async () => undefined,
    saveInventorySnapshot: async () => undefined, loadInventorySnapshot: async () => null,
    saveProfile: async () => undefined, loadProfile: async () => mockProfile,
    getActiveUserId: async () => 1, setActiveUserId: async () => undefined,
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({back: mockBack}),
  useLocalSearchParams: () => ({itemId: mockItemId, userId: '1'}),
}));

describe('inventory item detail screen', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    clearInventorySnapshot();
    mockBack.mockClear();
    mockItemId = '2';
    mockProfile = null;
    mockQueue = [];
  });

  it('loads a mock inventory row by route ID and shows its details', async () => {
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByText('Stock details')).toBeTruthy());
    expect(screen.getByText('Spares Tracker')).toBeTruthy();
    expect(screen.getByText('110245012')).toBeTruthy();
    expect(screen.getByText('PCB THYRATRON GRID CONTROL')).toBeTruthy();
    expect(screen.getByLabelText('1 unit on hand')).toBeTruthy();
    expect(screen.getByText('On hand')).toBeTruthy();
    expect(screen.getByText('2 units')).toBeTruthy();
    expect(screen.getByText('Allocated')).toBeTruthy();
    expect(screen.getByText('Nairobi Main Store')).toBeTruthy();
    expect(screen.getByText('Warehouse')).toBeTruthy();
    expect(screen.getByText('WO-004537370')).toBeTruthy();
    expect(screen.queryByText('Adjust stock')).toBeNull();

    await fireEvent.press(screen.getByRole('button', {name: 'Back to inventory'}));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows a not-found state for an inventory ID that does not exist', async () => {
    mockItemId = '999';
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByText('Stock item not found')).toBeTruthy());
  });

  it('uses the inventory snapshot instead of fetching all rows again', async () => {
    const rows = await api.getInventory();
    setInventorySnapshot(rows);
    const inventoryRequest = jest.spyOn(api, 'getInventory');

    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByText('Stock details')).toBeTruthy());
    expect(screen.getByText('110245012')).toBeTruthy();
    expect(inventoryRequest).not.toHaveBeenCalled();
  });

  it('labels zero quantity as out of stock on the detail screen', async () => {
    const row: InventoryItem = {
      id: 92, partId: 3, storeId: 10, partNumber: 'PART-92', description: 'Pump seal',
      storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 0,
      minThreshold: 1, isAllocated: false, workOrder: null,
    };
    mockItemId = '92';
    setInventorySnapshot([row]);
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByText('PART-92')).toBeTruthy());
    expect(screen.getByText('Out of stock')).toBeTruthy();
    expect(screen.queryByText('Low stock')).toBeNull();
  });

  it('shows stock actions for a manager assigned to the inventory store', async () => {
    const row: InventoryItem = {
      id: 88, partId: 3, storeId: 8, partNumber: 'PART-88', description: 'Pump seal',
      storeName: 'My van', storeType: 'engineer', storeOwner: 1, quantity: 4,
      minThreshold: 1, isAllocated: false, workOrder: null,
    };
    mockProfile = {id: 1, email: 'worker@example.com', name: 'Worker', role: 'manager', territory: null};
    mockItemId = '88';
    setInventorySnapshot([row]);
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Receive stock'})).toBeTruthy());
    expect(screen.getByRole('button', {name: 'Edit count'})).toBeTruthy();
  });

  it('hides stock actions for an engineer assigned to a different store', async () => {
    const row: InventoryItem = {
      id: 89, partId: 3, storeId: 9, partNumber: 'PART-89', description: 'Pump seal',
      storeName: 'Other van', storeType: 'engineer', storeOwner: 2, quantity: 4,
      minThreshold: 1, isAllocated: false, workOrder: null,
    };
    mockProfile = {id: 1, email: 'worker@example.com', name: 'Worker', role: 'engineer', territory: null};
    mockItemId = '89';
    setInventorySnapshot([row]);
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByText('PART-89')).toBeTruthy());
    expect(screen.queryByRole('button', {name: 'Receive stock'})).toBeNull();
    expect(screen.getByText('Stock adjustments are limited to central and assigned stores.')).toBeTruthy();
  });

  it('allows an admin to adjust unallocated stock outside their assignment', async () => {
    const row: InventoryItem = {
      id: 90, partId: 3, storeId: 10, partNumber: 'PART-90', description: 'Pump seal',
      storeName: 'Other van', storeType: 'engineer', storeOwner: 2, quantity: 4,
      minThreshold: 1, isAllocated: false, workOrder: null,
    };
    mockProfile = {id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', territory: null};
    mockItemId = '90';
    setInventorySnapshot([row]);
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Receive stock'})).toBeTruthy());
  });

  it('fetches and displays the current server count when resolving an offline conflict', async () => {
    const staleRow: InventoryItem = {
      id: 91, partId: 3, storeId: 10, partNumber: 'PART-91', description: 'Pump seal',
      storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
      minThreshold: 1, isAllocated: false, workOrder: null,
    };
    mockProfile = {id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', territory: null};
    mockItemId = '91';
    mockQueue = [{operationId: 'conflict-91', userId: 1, inventoryId: 91, expectedQuantity: 4,
      newQuantity: 6, createdAt: 1000, status: 'conflict', error: 'Stock changed on the server.'}];
    setInventorySnapshot([staleRow]);
    const getInventory = jest.spyOn(api, 'getInventory').mockResolvedValue([{...staleRow, quantity: 8}]);
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Refresh current quantity'})).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Refresh current quantity'}));

    await waitFor(() => expect(getInventory).toHaveBeenCalledTimes(1));
    expect(screen.getByText('8', {exact: true})).toBeTruthy();
    expect(screen.getByText('Current server quantity refreshed. Review it before discarding this change.')).toBeTruthy();
  });
});
