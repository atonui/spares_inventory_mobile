import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {Platform} from 'react-native';
import InventoryScanScreen from '../src/app/scan';
import {clearInventorySnapshot, setInventorySnapshot} from '../src/features/inventory/inventorySnapshot';
import type {InventoryItem} from '../src/features/inventory/inventoryRepository';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockPerformAndroidHapticsAsync = jest.fn(async () => undefined);
const mockNotificationAsync = jest.fn(async () => undefined);
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

jest.mock('expo-haptics', () => ({
  AndroidHaptics: {Confirm: 'confirm', Reject: 'reject'},
  NotificationFeedbackType: {Success: 'success', Error: 'error'},
  performAndroidHapticsAsync: (...args: unknown[]) => mockPerformAndroidHapticsAsync(...args),
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
}));

jest.mock('../src/features/inventory/offlineStockStore', () => ({
  offlineStockStore: {
    getActiveUserId: async () => 7,
    getScanHapticsEnabled: async () => true,
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
    mockPerformAndroidHapticsAsync.mockClear();
    mockNotificationAsync.mockClear();
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
    expect(screen.getByText('2 locations found')).toBeTruthy();
    if (Platform.OS === 'android') {
      await waitFor(() => expect(mockPerformAndroidHapticsAsync).toHaveBeenCalledWith('confirm'));
    } else {
      await waitFor(() => expect(mockNotificationAsync).toHaveBeenCalledWith('success'));
    }
    expect(screen.getByText('Choose the location you’re checking.')).toBeTruthy();
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
    expect(screen.getByText('No matching part found')).toBeTruthy();
    if (Platform.OS === 'android') {
      await waitFor(() => expect(mockPerformAndroidHapticsAsync).toHaveBeenCalledWith('reject'));
    } else {
      await waitFor(() => expect(mockNotificationAsync).toHaveBeenCalledWith('error'));
    }
    expect(screen.getAllByText('UNKNOWN-99')).toHaveLength(2);
    expect(screen.getByText('Check the code or try a manual search.')).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Scan again'})).toBeTruthy();
  });

  it('offers a return path if no inventory snapshot is available', async () => {
    const screen = await render(<InventoryScanScreen />);

    await waitFor(() => expect(screen.getByText('Inventory is not loaded yet.')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', {name: 'Back to inventory'}));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
