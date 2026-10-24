import {fireEvent, render, waitFor} from '@testing-library/react-native';
import InventoryScanScreen from '../src/app/scan';
import {clearInventorySnapshot, setInventorySnapshot} from '../src/features/inventory/inventorySnapshot';
import type {InventoryItem} from '../src/features/inventory/inventoryRepository';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockBarcodeValue = 'PN-0042';
let mockCameraGranted = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({push: mockPush, back: mockBack}),
  useLocalSearchParams: () => ({userId: '7'}),
}));

jest.mock('expo-camera', () => {
  const React = jest.requireActual('react');
  const {Pressable, Text} = jest.requireActual('react-native');
  return {
    CameraView: ({onBarcodeScanned}: {onBarcodeScanned: (result: {data: string; type: string}) => void}) =>
      React.createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Simulate camera scan',
        onPress: () => onBarcodeScanned({data: mockBarcodeValue, type: 'qr'}),
      }, React.createElement(Text, null, 'Camera preview')),
    useCameraPermissions: () => {
      const [permission, setPermission] = React.useState({granted: mockCameraGranted, canAskAgain: true});
      const requestPermission = async () => {
        setPermission({granted: true, canAskAgain: true});
        return {granted: true, canAskAgain: true};
      };
      return [permission, requestPermission];
    },
  };
});

jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    getActiveUserId: async () => 7,
    loadInventorySnapshot: async () => null,
    list: async () => [],
  },
}));

const item = (id: number, storeName: string): InventoryItem => ({
  id,
  partId: 12,
  storeId: id,
  partNumber: 'PN-0042',
  description: 'Replacement valve',
  storeName,
  storeType: 'central',
  storeOwner: null,
  quantity: 8,
  minThreshold: 2,
  isAllocated: false,
  workOrder: null,
});

describe('inventory scanner screen', () => {
  beforeEach(() => {
    clearInventorySnapshot();
    mockPush.mockClear();
    mockBack.mockClear();
    mockBarcodeValue = 'PN-0042';
    mockCameraGranted = true;
  });

  it('asks for camera permission before rendering the scanner', async () => {
    mockCameraGranted = false;
    setInventorySnapshot([item(42, 'Central store')]);
    const screen = await render(<InventoryScanScreen />);

    expect(screen.queryByText('Camera preview')).toBeNull();
    await fireEvent.press(screen.getByRole('button', {name: 'Allow camera'}));
    await waitFor(() => expect(screen.getByText('Camera preview')).toBeTruthy());
  });

  it('shows all exact part matches and navigates only after a row is selected', async () => {
    setInventorySnapshot([item(42, 'Central store'), item(43, 'Field van')]);
    const screen = await render(<InventoryScanScreen />);

    await fireEvent.press(screen.getByRole('button', {name: 'Simulate camera scan'}));
    expect(screen.getByText('Stock found in 2 locations')).toBeTruthy();
    expect(screen.getByText('Choose the store you’re checking.')).toBeTruthy();
    expect(screen.getByText('Central store')).toBeTruthy();
    expect(screen.getByText('Field van')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', {name: 'View PN-0042 at Field van, 8 units'}));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/inventory/[itemId]',
      params: {itemId: '43', userId: '7'},
    });
  });

  it('shows the decoded value when the scanned code does not match inventory', async () => {
    setInventorySnapshot([item(42, 'Central store')]);
    mockBarcodeValue = 'UNKNOWN-99';
    const screen = await render(<InventoryScanScreen />);

    await fireEvent.press(screen.getByRole('button', {name: 'Simulate camera scan'}));
    expect(screen.getByText('No matching part number')).toBeTruthy();
    expect(screen.getByText('UNKNOWN-99')).toBeTruthy();
    expect(screen.getByText(/exact part numbers in the inventory saved on this device/)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Scan again'})).toBeTruthy();
  });

  it('offers a return path if no inventory snapshot is available', async () => {
    const screen = await render(<InventoryScanScreen />);

    await waitFor(() => expect(screen.getByText('Inventory is not loaded yet.')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Back to inventory'}));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
