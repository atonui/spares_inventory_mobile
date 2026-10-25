import {fireEvent, render, waitFor} from '@testing-library/react-native';
import type {QueuedStockAdjustment} from '../src/features/inventory/offlineStockQueue';
import {StockAdjustmentControls} from '../src/features/inventory/StockAdjustmentControls';
import {offlineStockStore} from '../src/features/inventory/offlineStockStore';

let mockQueue: QueuedStockAdjustment[] = [];

jest.mock('expo-network', () => ({addNetworkStateListener: () => ({remove: jest.fn()})}));
jest.mock('../src/api/runtime', () => ({api: {adjustStock: jest.fn()}}));
jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    list: jest.fn(async () => mockQueue),
    remove: jest.fn(async (operationId: string) => {
      mockQueue = mockQueue.filter(entry => entry.operationId !== operationId);
    }),
    enqueue: jest.fn(),
    markConflict: jest.fn(),
  },
}));

describe('stock adjustment conflict handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue = [{operationId: 'conflict-1', userId: 7, inventoryId: 11,
      expectedQuantity: 4, newQuantity: 6, createdAt: 1000,
      status: 'conflict', error: 'Stock changed on the server.'}];
  });

  it('requires confirmation before removing outdated offline counts', async () => {
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={jest.fn()}
    />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Discard outdated changes'})).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Discard outdated changes'}));

    expect(screen.getByText('Discard these outdated stock changes?')).toBeTruthy();
    expect(offlineStockStore.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', {name: 'Confirm discard outdated changes'}));
    await waitFor(() => expect(offlineStockStore.remove).toHaveBeenCalledWith('conflict-1'));
    expect(screen.getByText('Outdated offline changes removed. The displayed quantity is ready for a new count.')).toBeTruthy();
  });
});
