import {fireEvent, render, waitFor} from '@testing-library/react-native';
import appConfig from '../app.json';
import DesktopPairing from '../src/features/auth/DesktopPairing';

describe('desktop pairing onboarding', () => {
  it('declares both camera use cases in the native permission prompt', () => {
    const cameraPlugin = appConfig.expo.plugins.find((plugin: string | [string, {cameraPermission?: string}]) =>
      Array.isArray(plugin) && plugin[0] === 'expo-camera',
    );

    expect(Array.isArray(cameraPlugin)).toBe(true);
    if (!Array.isArray(cameraPlugin)) throw new Error('expo-camera config plugin is missing');
    expect(cameraPlugin[1].cameraPermission).toMatch(/pair this phone/i);
    expect(cameraPlugin[1].cameraPermission).toMatch(/look up stock/i);
    expect(cameraPlugin[1].cameraPermission).toMatch(/barcode or QR code/i);
  });

  it('explains that pairing starts from the signed-in desktop account', async () => {
    const screen = await render(<DesktopPairing mockMode={false} onPair={jest.fn()} />);

    expect(screen.getByText('Pair with your desktop')).toBeTruthy();
    expect(screen.getByText(/Go to Profile → Connect mobile app/i)).toBeTruthy();
    expect(screen.getByText(/The Scan screen also reads stock barcodes and QR codes/i)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Scan pairing QR'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Enter pairing code'})).toBeTruthy();
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });


  it('allows manual pairing when the camera cannot scan', async () => {
    const onPair = jest.fn(async (_credential, onApprovalRequired) => {onApprovalRequired();});
    const screen = await render(<DesktopPairing mockMode={false} onPair={onPair} />);

    await fireEvent.press(screen.getByRole('button', {name: 'Enter pairing code'}));
    await fireEvent.changeText(screen.getByLabelText('Pairing code'), 'abcde23456');
    await waitFor(() => expect(screen.getByRole('button', {name: 'Continue'}).props.disabled).toBe(false));
    await fireEvent.press(screen.getByRole('button', {name: 'Continue'}));

    await waitFor(() => expect(onPair).toHaveBeenCalledWith(
      {pairingCode: 'ABCDE-23456'}, expect.any(Function),
    ));
    expect(screen.getByText('Waiting for desktop approval')).toBeTruthy();
  });

  it('offers a clearly marked mock pairing path only in preview mode', async () => {
    const onPair = jest.fn(async (_qrData, onApprovalRequired) => {onApprovalRequired();});
    const screen = await render(<DesktopPairing mockMode onPair={onPair} />);

    await fireEvent.press(screen.getByRole('button', {name: 'Try preview pairing'}));

    expect(screen.getByText('Waiting for desktop approval')).toBeTruthy();
    await waitFor(() => expect(onPair).toHaveBeenCalledWith(
      {qrData: 'sparesflow://pair?token=preview-pairing-token'}, expect.any(Function),
    ));
  });

  it('does not offer mock pairing in live mode', async () => {
    const screen = await render(<DesktopPairing mockMode={false} onPair={jest.fn()} />);
    expect(screen.queryByRole('button', {name: 'Try preview pairing'})).toBeNull();
  });
});
