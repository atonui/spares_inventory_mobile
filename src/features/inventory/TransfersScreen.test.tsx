import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import TransfersScreen from '../../app/transfers';
import {api} from '../../api/runtime';
import type {PendingTransfer} from '../../api/transferContract';

const mockRouter = {replace: jest.fn(), push: jest.fn()};
jest.mock('expo-router', () => ({useRouter: () => mockRouter, useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback])}));
jest.mock('../../api/runtime', () => ({api: {getMe: jest.fn(), getPendingTransfers: jest.fn(), completeTransfer: jest.fn(), getInventory: jest.fn(), clearSession: jest.fn()}}));
jest.mock('./offlineStockStore', () => ({offlineStockStore: {list: jest.fn(async () => []), saveInventorySnapshot: jest.fn()}}));
const transfer: PendingTransfer = {id: 12, quantity: 2, partNumber: 'P-1', description: 'Part', fromStoreId: 1, toStoreId: 2,
  fromStoreName: 'Source', toStoreName: 'Destination', createdAt: '2026-10-30T00:00:00Z', canReceive: true, canReturn: false};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.getMe).mockResolvedValue({id: 7} as Awaited<ReturnType<typeof api.getMe>>);
  jest.mocked(api.getPendingTransfers).mockReset().mockResolvedValue([transfer]);
  jest.mocked(api.getInventory).mockResolvedValue([]);
  jest.mocked(api.completeTransfer).mockReset().mockResolvedValue(undefined);
});

it('offers only server-authorized actions and requires physical confirmation', async () => {
  await render(<TransfersScreen />);
  await waitFor(() => expect(screen.getByLabelText('Receive transfer 12')).toBeTruthy());
  expect(screen.queryByLabelText('Return transfer 12')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Receive transfer 12'));
  expect(api.completeTransfer).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Confirm physical stock'));
  await waitFor(() => expect(api.completeTransfer).toHaveBeenCalledWith(12, 'receive'));
  await waitFor(() => expect(screen.getByText('No pending transfers')).toBeTruthy());
});

it('rechecks permission before submitting a reviewed transfer', async () => {
  jest.mocked(api.getPendingTransfers).mockResolvedValueOnce([transfer]).mockResolvedValue([{...transfer, canReceive: false}]);
  await render(<TransfersScreen />);
  await waitFor(() => expect(screen.getByLabelText('Receive transfer 12')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Receive transfer 12'));
  await fireEvent.press(screen.getByText('Confirm physical stock'));
  await waitFor(() => expect(screen.getByText(/permission was removed/)).toBeTruthy());
  expect(api.completeTransfer).not.toHaveBeenCalled();
});

it('requires a fresh read after an unconfirmed response', async () => {
  jest.mocked(api.completeTransfer).mockRejectedValue(new TypeError('lost response'));
  await render(<TransfersScreen />);
  await waitFor(() => expect(screen.getByLabelText('Receive transfer 12')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Receive transfer 12'));
  await fireEvent.press(screen.getByText('Confirm physical stock'));
  await waitFor(() => expect(screen.getByText(/result could not be confirmed/)).toBeTruthy());
  expect(api.completeTransfer).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Receive transfer 12').props.accessibilityState.disabled).toBe(true);
});
