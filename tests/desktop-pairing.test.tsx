import {fireEvent, render, waitFor} from '@testing-library/react-native';
import DesktopPairing from '../src/features/auth/DesktopPairing';

describe('desktop pairing onboarding', () => {
  it('explains that pairing starts from the signed-in desktop account', async () => {
    const screen = await render(<DesktopPairing mockMode={false} onPair={jest.fn()} />);

    expect(screen.getByText('Sign in through your desktop account')).toBeTruthy();
    expect(screen.getByText(/In Profile, choose Connect mobile app/i)).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Scan QR code'})).toBeTruthy();
    expect(screen.queryByLabelText('Email address')).toBeNull();
  });

  it('offers a clearly marked mock pairing path only in preview mode', async () => {
    const onPair = jest.fn(async (_qrData, onApprovalRequired) => {onApprovalRequired();});
    const screen = await render(<DesktopPairing mockMode onPair={onPair} />);

    await fireEvent.press(screen.getByRole('button', {name: 'Try preview pairing'}));

    expect(screen.getByText('Waiting for desktop approval')).toBeTruthy();
    await waitFor(() => expect(onPair).toHaveBeenCalledWith(
      'sparesflow://pair?token=preview-pairing-token', expect.any(Function),
    ));
  });

  it('does not offer mock pairing in live mode', async () => {
    const screen = await render(<DesktopPairing mockMode={false} onPair={jest.fn()} />);
    expect(screen.queryByRole('button', {name: 'Try preview pairing'})).toBeNull();
  });
});
