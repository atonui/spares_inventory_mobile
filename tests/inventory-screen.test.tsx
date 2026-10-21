import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {Keyboard} from 'react-native';
import {api} from '../src/api/runtime';
import InventoryScreen from '../src/app/index';
import {clearInventorySnapshot, getCachedInventoryItem} from '../src/features/inventory/inventorySnapshot';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockItemId = '2';

jest.mock('expo-router', () => ({
  useRouter: () => ({push: mockPush, back: mockBack}),
  useLocalSearchParams: () => ({itemId: mockItemId}),
}));

describe('inventory sign-in flow', () => {
  it('renders the sign-in screen on initial load', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    expect(screen.getByText('SparesFlow')).toBeTruthy();
    expect(screen.getByText('Everything in its place.')).toBeTruthy();
  });

  beforeEach(async () => {
    await api.clearSession();
    clearInventorySnapshot();
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
    expect(screen.getByText('SparesFlow')).toBeTruthy();
    expect(screen.getByText('6190901970')).toBeTruthy();
    expect(getCachedInventoryItem(2)?.partNumber).toBe('110245012');
    expect(screen.getAllByText('LOW STOCK').length).toBeGreaterThan(0);
    expect(screen.queryByText('Adjust stock')).toBeNull();

    await fireEvent.press(screen.getByRole('button', {name: 'Sign out'}));
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    expect(getCachedInventoryItem(2)).toBeUndefined();
  });

  it('does not report empty stock when the inventory request fails, and retries cleanly', async () => {
    const inventoryRequest = jest.spyOn(api, 'getInventory')
      .mockRejectedValueOnce(new Error('Inventory service unavailable'));
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));

    await waitFor(() => expect(screen.getByText('Inventory service unavailable')).toBeTruthy());
    expect(screen.queryByText('No stock to show')).toBeNull();
    expect(screen.queryByText('No matching stock')).toBeNull();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.press(screen.getByText('Retry'));

    await waitFor(() => expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy());
    expect(screen.queryByText('Inventory service unavailable')).toBeNull();
    inventoryRequest.mockRestore();
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

  it('dismisses the keyboard on search submit and before opening a stock item', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
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
      params: {itemId: '2'},
    });
    dismissKeyboard.mockRestore();
  });

  it('filters inventory status and combines the filter with local search', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));

    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());
    await fireEvent.press(screen.getByRole('radio', {name: 'Low stock'}));

    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
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

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    expect(screen.getByRole('radio', {name: 'All'})).toHaveTextContent('All · 4');
    expect(screen.getByRole('radio', {name: 'Low stock'})).toHaveTextContent('Low stock · 2');
    expect(screen.getByRole('radio', {name: 'Available'})).toHaveTextContent('Available · 3');
    expect(screen.getByRole('radio', {name: 'Allocated'})).toHaveTextContent('Allocated · 1');
  });

  it('finds allocated stock by its work-order number', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'wo-004537370');

    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeNull();
  });

  it('searches by a human-readable inventory location type', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
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

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
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

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
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
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'cooling');
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeNull();
  });

  it('shows an accessible clear-search action and restores all matching rows', async () => {
    const screen = await render(<InventoryScreen />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));

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

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'field@company.example');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'preview-password');
    await fireEvent.press(screen.getByRole('button', {name: 'Sign in'}));
    await waitFor(() => expect(screen.getByText('Inventory')).toBeTruthy());

    await fireEvent.press(screen.getByRole('radio', {name: 'Low stock'}));
    await fireEvent.press(screen.getByRole('radio', {name: 'Lowest stock'}));
    await fireEvent.changeText(screen.getByLabelText('Search inventory'), 'no-such-part');

    expect(screen.getByText('No matching stock')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', {name: 'Clear search and filters'}));

    expect(screen.getByLabelText('Search inventory').props.value).toBe('');
    expect(screen.getByRole('radio', {name: 'All'}).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('radio', {name: 'Default'}).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('button', {name: 'View 6190901970, THYRATRON CX1140LG'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View 110245012, PCB THYRATRON GRID CONTROL'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'View D-008214, Cooling fan assembly'})).toBeTruthy();
  });
});
