import {fireEvent, render, waitFor} from '@testing-library/react-native';
import type {QueuedStockAdjustment} from '../src/features/inventory/offlineStockQueue';
import {api} from '../src/api/runtime';
import {StockAdjustmentControls} from '../src/features/inventory/StockAdjustmentControls';
import {offlineStockStore} from '../src/features/inventory/offlineStockStore';

let mockQueue: QueuedStockAdjustment[] = [];

jest.mock('expo-network', () => ({addNetworkStateListener: () => ({remove: jest.fn()})}));
jest.mock('../src/api/runtime', () => ({api: {adjustStock: jest.fn(), getInventory: jest.fn(async () => [])}}));
jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    list: jest.fn(async () => mockQueue),
    remove: jest.fn(async (operationId: string) => {
      mockQueue = mockQueue.filter(entry => entry.operationId !== operationId);
    }),
    enqueue: jest.fn(),
    replaceQueued: jest.fn(async (adjustment: QueuedStockAdjustment) => {
      const existing = mockQueue.find(entry => entry.userId === adjustment.userId &&
        entry.inventoryId === adjustment.inventoryId && entry.status === 'queued');
      const replacement = existing
        ? {...adjustment, expectedQuantity: existing.expectedQuantity, operationId: existing.operationId, createdAt: existing.createdAt}
        : adjustment;
      mockQueue = [...mockQueue.filter(entry => !(entry.userId === adjustment.userId &&
        entry.inventoryId === adjustment.inventoryId && entry.status === 'queued')), replacement];
    }),
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

  it('undoes an offline stock count by removing the queued operation', async () => {
    mockQueue = [];
    jest.spyOn(api, 'adjustStock').mockRejectedValue(new TypeError('offline'));
    const onQuantityChange = jest.fn();
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={onQuantityChange}
      onRefresh={jest.fn(async () => 4)}
    />);

    await fireEvent.press(screen.getByRole('button', {name: 'Add stock'}));
    await fireEvent.changeText(screen.getByLabelText('Quantity to add'), '2');
    await fireEvent.press(screen.getByRole('button', {name: 'Save change'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Undo stock change'})).toBeTruthy());
    expect(mockQueue).toHaveLength(1);
    expect(onQuantityChange).toHaveBeenCalledWith(6);

    await fireEvent.press(screen.getByRole('button', {name: 'Undo stock change'}));

    await waitFor(() => expect(screen.getByText('Stock change undone.')).toBeTruthy());
    expect(mockQueue).toHaveLength(0);
    expect(onQuantityChange).toHaveBeenLastCalledWith(4);
  });

  it('undoes a synced stock count with a guarded compensating adjustment', async () => {
    mockQueue = [];
    const adjustStock = jest.spyOn(api, 'adjustStock').mockResolvedValue(undefined);
    const onQuantityChange = jest.fn();
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={onQuantityChange}
      onRefresh={jest.fn(async () => 4)}
    />);

    await fireEvent.press(screen.getByRole('button', {name: 'Add stock'}));
    await fireEvent.changeText(screen.getByLabelText('Quantity to add'), '2');
    await fireEvent.press(screen.getByRole('button', {name: 'Save change'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Undo stock change'})).toBeTruthy());
    await waitFor(() => expect(mockQueue).toHaveLength(0));

    await fireEvent.press(screen.getByRole('button', {name: 'Undo stock change'}));

    await waitFor(() => expect(screen.getByText('Stock change undone.')).toBeTruthy());
    expect(adjustStock).toHaveBeenCalledTimes(2);
    expect(adjustStock.mock.calls[1]?.[0]).toMatchObject({expectedQuantity: 6, newQuantity: 4});
    expect(onQuantityChange).toHaveBeenLastCalledWith(4);
  });

  it('requires an explicit confirmation before saving a zero stock count', async () => {
    mockQueue = [];
    const adjustStock = jest.spyOn(api, 'adjustStock').mockRejectedValue(new TypeError('offline'));
    const onQuantityChange = jest.fn();
    const screen = await render(<StockAdjustmentControls
      item={{id: 11, partId: 101, storeId: 1, partNumber: 'PART-11', description: 'Filter element',
        storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
        minThreshold: 1, isAllocated: false, workOrder: null}}
      userId={7}
      onQuantityChange={onQuantityChange}
      onRefresh={jest.fn(async () => 4)}
    />);

    await fireEvent.press(screen.getByRole('button', {name: 'Edit count'}));
    await fireEvent.changeText(screen.getByLabelText('New stock quantity'), '0');
    await fireEvent.press(screen.getByRole('button', {name: 'Save change'}));

    expect(screen.getByText('Set this item to zero?')).toBeTruthy();
    expect(screen.getByText(/Confirm the physical count for PART-11 from 4 units to 0/)).toBeTruthy();
    expect(adjustStock).not.toHaveBeenCalled();
    expect(onQuantityChange).not.toHaveBeenCalled();
    expect(mockQueue).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', {name: 'Keep editing count'}));
    expect(screen.getByLabelText('New stock quantity').props.value).toBe('0');
    expect(adjustStock).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', {name: 'Save change'}));
    await fireEvent.press(screen.getByRole('button', {name: 'Confirm zero count'}));

    await waitFor(() => expect(screen.getByText('Saved on this device. It will sync when you’re back online.')).toBeTruthy());
    expect(adjustStock).toHaveBeenCalledTimes(1);
    expect(onQuantityChange).toHaveBeenLastCalledWith(0);
    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0]).toMatchObject({expectedQuantity: 4, newQuantity: 0});
  });
});
