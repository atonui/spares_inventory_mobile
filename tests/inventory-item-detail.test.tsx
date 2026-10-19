import {fireEvent, render, waitFor} from '@testing-library/react-native';
import InventoryItemDetailScreen from '../src/app/inventory/[itemId]';

const mockBack = jest.fn();
let mockItemId = '2';

jest.mock('expo-router', () => ({
  useRouter: () => ({back: mockBack}),
  useLocalSearchParams: () => ({itemId: mockItemId}),
}));

describe('inventory item detail screen', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockItemId = '2';
  });

  it('loads a mock inventory row by route ID and shows its read-only details', async () => {
    const screen = await render(<InventoryItemDetailScreen />);

    await waitFor(() => expect(screen.getByText('Stock details')).toBeTruthy());
    expect(screen.getByText('110245012')).toBeTruthy();
    expect(screen.getByText('PCB THYRATRON GRID CONTROL')).toBeTruthy();
    expect(screen.getByText('1 unit')).toBeTruthy();
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
});
