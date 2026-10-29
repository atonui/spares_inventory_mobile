import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {StockOperations} from './StockOperations';
import {api} from '../../api/runtime';
import {offlineStockStore} from './offlineStockStore';
import type {InventoryRow} from '../../api/client';

jest.mock('../../api/runtime', () => ({api: {getMe: jest.fn(), getInventory: jest.fn(), receiveStock: jest.fn(), issueStock: jest.fn()}}));
jest.mock('./offlineStockStore', () => ({offlineStockStore: {list: jest.fn()}}));
const item: InventoryRow = {id: 1, partId: 2, storeId: 3, partNumber: 'PART-1', description: 'Test part', storeName: 'Main', storeType: 'central', storeOwner: null, quantity: 5, minThreshold: 1, isAllocated: false, workOrder: null};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.getMe).mockResolvedValue({id: 7} as Awaited<ReturnType<typeof api.getMe>>);
  jest.mocked(api.getInventory).mockResolvedValue([item]);
  jest.mocked(offlineStockStore.list).mockResolvedValue([]);
});

it('requires a work order and confirmation before issuing stock', async () => {
  await render(<StockOperations item={item} userId={7} onRefresh={jest.fn().mockResolvedValue(3)} />);
  await fireEvent.press(screen.getByText('Issue stock'));
  await fireEvent.changeText(screen.getByLabelText('Movement quantity'), '2');
  await fireEvent.press(screen.getByText('Review movement'));
  expect(screen.getByText('Enter the work order for this issue.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Work order'), 'WO-42');
  await fireEvent.press(screen.getByText('Review movement'));
  await waitFor(() => expect(screen.getByText('Confirm movement')).toBeTruthy());
  expect(api.issueStock).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Confirm movement'));
  await waitFor(() => expect(api.issueStock).toHaveBeenCalledWith({inventoryId: 1, quantity: 2, workOrder: 'WO-42', notes: ''}));
});

it('does not offer to resubmit a movement after a lost response', async () => {
  jest.mocked(api.receiveStock).mockRejectedValue(new TypeError('Failed to fetch'));
  await render(<StockOperations item={item} userId={7} onRefresh={jest.fn()} />);
  await fireEvent.press(screen.getByText('Receive stock'));
  await fireEvent.changeText(screen.getByLabelText('Movement quantity'), '2');
  await fireEvent.press(screen.getByText('Review movement'));
  await waitFor(() => expect(screen.getByText('Confirm movement')).toBeTruthy());
  await fireEvent.press(screen.getByText('Confirm movement'));
  await waitFor(() => expect(screen.getByText(/result could not be confirmed/)).toBeTruthy());
  expect(screen.queryByText('Confirm movement')).toBeNull();
  expect(api.receiveStock).toHaveBeenCalledTimes(1);
});

it('blocks operational writes while the item has queued counts', async () => {
  jest.mocked(offlineStockStore.list).mockResolvedValue([{inventoryId: 1}] as Awaited<ReturnType<typeof offlineStockStore.list>>);
  await render(<StockOperations item={item} userId={7} onRefresh={jest.fn()} />);
  await fireEvent.press(screen.getByText('Receive stock'));
  await fireEvent.changeText(screen.getByLabelText('Movement quantity'), '2');
  await fireEvent.press(screen.getByText('Review movement'));
  await waitFor(() => expect(screen.getByText(/Sync or resolve/)).toBeTruthy());
  expect(api.receiveStock).not.toHaveBeenCalled();
});
