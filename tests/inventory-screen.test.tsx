import {fireEvent, render, waitFor} from '@testing-library/react-native';
import InventoryScreen from '../src/app/index';

describe('inventory sign-in flow', () => {
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
});
