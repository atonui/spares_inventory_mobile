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
    const onRefresh = jest.fn(async () => 8);
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={jest.fn()}
      onRefresh={onRefresh}
    />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Discard outdated changes'})).toBeTruthy());
    const discardButton = screen.getByRole('button', {name: 'Discard outdated changes'});
    expect(discardButton.props.accessibilityState).toMatchObject({disabled: true});
    await fireEvent.press(screen.getByRole('button', {name: 'Refresh current quantity'}));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(discardButton.props.accessibilityState).toMatchObject({disabled: false});
    await fireEvent.press(screen.getByRole('button', {name: 'Discard outdated changes'}));

    expect(screen.getByText('Discard these outdated stock changes?')).toBeTruthy();
    expect(offlineStockStore.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', {name: 'Confirm discard outdated changes'}));
    await waitFor(() => expect(offlineStockStore.remove).toHaveBeenCalledWith('conflict-1'));
    expect(screen.getByText('Outdated offline changes removed. The displayed quantity is ready for a new count.')).toBeTruthy();
  });

  it('refreshes the current server quantity before the user discards a conflict', async () => {
    const onRefresh = jest.fn(async () => 8);
    const onQuantityChange = jest.fn();
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={onQuantityChange}
      onRefresh={onRefresh}
    />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Refresh current quantity'})).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Refresh current quantity'}));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onQuantityChange).toHaveBeenCalledWith(8);
    expect(screen.getByText('Current server quantity refreshed. Review it before discarding this change.')).toBeTruthy();
    expect(offlineStockStore.remove).not.toHaveBeenCalled();
  });

  it('keeps the conflicted change when refreshing the server quantity fails', async () => {
    const onRefresh = jest.fn(async () => {throw new Error('offline');});
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={jest.fn()}
      onRefresh={onRefresh}
    />);

    await waitFor(() => expect(screen.getByRole('button', {name: 'Refresh current quantity'})).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Refresh current quantity'}));

    await waitFor(() => expect(screen.getByText('Could not refresh the server quantity. Check your connection and try again.')).toBeTruthy());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(offlineStockStore.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Discard outdated changes'}).props.accessibilityState).toMatchObject({disabled: true});
  });
});
