import {useEffect} from 'react';
import {AppState} from 'react-native';
import {Stack, useRouter} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {ApiError} from '../api/client';
import {api} from '../api/runtime';
import {clearInventorySnapshot} from '../features/inventory/inventorySnapshot';

function SessionRevocationWatcher() {
  const router = useRouter();

  useEffect(() => {
    let checking = false;
    let disposed = false;

    const checkSession = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        if (!(await api.getSession())) return;
        await api.getMe();
      } catch (reason) {
        if (disposed || !(reason instanceof ApiError) || ![401, 403].includes(reason.status)) return;
        await api.clearSession();
        clearInventorySnapshot();
        router.replace('/');
      } finally {
        checking = false;
      }
    };

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void checkSession();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void checkSession();
    }, 30_000);

    return () => {
      disposed = true;
      subscription.remove();
      clearInterval(interval);
    };
  }, [router]);

  return null;
}

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <SessionRevocationWatcher />
      <Stack screenOptions={{headerShown: false, animation: 'fade'}} />
    </>
  );
}
