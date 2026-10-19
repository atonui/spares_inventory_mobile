import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {api} from '../src/api/runtime';
import InventoryScreen from '../src/app/index';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockItemId = '2';

jest.mock('expo-router', () => ({
  useRouter: () => ({push: mockPush, back: mockBack}),
  useLocalSearchParams: () => ({itemId: mockItemId}),
}));

describe('inventory sign-in flow', () => {
  beforeEach(async () => {
    await api.clearSession();
    mockPush.mockClear();
    mockBack.mockClear();
    mockItemId = '2';
  });

  it('validates sign-in and opens the read-only inventory preview', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
    expect(screen.getByText('Enter your email and password to continue.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    expect(screen.getByText('6190901970')).toBeTruthy();
    expect(screen.getAllByText('LOW STOCK').length).toBeGreaterThan(0);
    expect(screen.queryByText('Adjust stock')).toBeNull();
  });

  it('navigates to an inventory item detail using the item ID', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Search inventory'), '110245012');
    await fireEvent.press(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'}));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/inventory/[itemId]',
      params: {itemId: '2'},
    });
  });
});
