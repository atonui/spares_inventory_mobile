export type ConnectivityStatus = 'checking' | 'online' | 'offline';

export function getConnectivityStatus(
  isConnected?: boolean | null,
  isInternetReachable?: boolean | null,
): ConnectivityStatus {
  if (isConnected === false || isInternetReachable === false) return 'offline';
  if (isConnected === true && isInternetReachable === true) return 'online';
  return 'checking';
}
