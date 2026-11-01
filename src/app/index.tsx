import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useLocalSearchParams, useRouter} from 'expo-router';
import * as Network from 'expo-network';
import {api, isMockMode} from '../api/runtime';
import {ApiError, type InventoryRow, type MobilePairingCredential, type NativeUser} from '../api/client';
import type {PartRecord} from '../api/transferContract';
import {clearInventorySnapshot, getInventorySnapshot, setInventorySnapshot} from '../features/inventory/inventorySnapshot';
import {sortInventory, type InventorySort} from '../features/inventory/inventorySort';
import {inventoryRowAccessibilityLabel} from '../features/inventory/inventoryAccessibility';
import {applyQueuedStockCounts, syncQueuedStock} from '../features/inventory/offlineStockQueue';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {getConnectivityStatus} from '../features/network/connectivity';
import DesktopPairing from '../features/auth/DesktopPairing';
import {StoresDirectory, summarizeStores} from '../features/inventory/StoresDirectory';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {AppIcon} from '../features/navigation/AppIcon';

function responseMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isMockMode && error instanceof Error) return error.message;
  return 'Could not reach the server. Check your connection and try again.';
}

function normalizeInventorySearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

type InventoryFilter = 'all' | 'needsAttention' | 'outOfStock' | 'lowStock' | 'available' | 'allocated';
type SnapshotStatus = {savedAt: number | null; queued: number; conflicts: number};

function announceInventoryResultCount(count: number, total: number, query: string, filter: InventoryFilter) {
  if (Platform.OS === 'web') return;
  const activeFilter = inventoryFilterOptions.find(option => option.value === filter)?.label;
  const context = [query.trim() ? 'Search results' : '', filter !== 'all' ? `${activeFilter} filter` : '']
    .filter(Boolean)
    .join(' · ');
  AccessibilityInfo.announceForAccessibility(`${context || 'Inventory'}: ${count} of ${total} items.`);
}

function formatSnapshotTime(savedAt: number | null): string {
  if (savedAt === null) return 'No saved refresh yet';
  const minutes = Math.max(0, Math.floor((Date.now() - savedAt) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr${hours === 1 ? '' : 's'} ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(savedAt))}`;
}

const inventoryFilterOptions: {value: InventoryFilter; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'needsAttention', label: 'Needs attention'},
  {value: 'outOfStock', label: 'Out of stock'},
  {value: 'lowStock', label: 'Low stock'},
  {value: 'available', label: 'Available'},
  {value: 'allocated', label: 'Allocated'},
];

function parseInventoryFilter(value: string | undefined): InventoryFilter {
  return inventoryFilterOptions.some(option => option.value === value)
    ? value as InventoryFilter
    : 'all';
}

const inventorySortOptions: {value: InventorySort; label: string}[] = [
  {value: 'default', label: 'Default'},
  {value: 'partNumber', label: 'Part number'},
  {value: 'lowestStock', label: 'Lowest stock'},
];

export default function InventoryScreen() {
  const router = useRouter();
  const [pairingPhase, setPairingPhase] = useState<'welcome' | 'scan' | 'code' | 'pending'>('welcome');
  const routeParams = useLocalSearchParams<{filter?: string | string[]; query?: string | string[]; view?: string; storeId?: string}>();
  const showingStores = routeParams.view === 'stores';
  const selectedStoreId = routeParams.storeId ? Number(routeParams.storeId) : null;
  const routeFilterValue = Array.isArray(routeParams.filter) ? routeParams.filter[0] : routeParams.filter;
  const routeQueryValue = Array.isArray(routeParams.query) ? routeParams.query[0] : routeParams.query;
  const search = routeQueryValue ?? '';
  const [hasSession, setHasSession] = useState(false);
  const [user, setUser] = useState<NativeUser | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus>({savedAt: null, queued: 0, conflicts: 0});
  const [usingCachedInventory, setUsingCachedInventory] = useState(false);
  const [networkConnected, setNetworkConnected] = useState<boolean | null>(null);
  const [pendingSignOutCount, setPendingSignOutCount] = useState<number | null>(null);
  const [checkingSignOut, setCheckingSignOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const pairingCancelledRef = useRef(false);
  const syncInFlightRef = useRef<Promise<unknown> | null>(null);
  const inventoryFilter = parseInventoryFilter(routeFilterValue);
  const [inventorySort, setInventorySort] = useState<InventorySort>('default');
  const [filterSortVisible, setFilterSortVisible] = useState(false);
  const [draftInventoryFilter, setDraftInventoryFilter] = useState<InventoryFilter>('all');
  const [draftInventorySort, setDraftInventorySort] = useState<InventorySort>('default');
  const [draftStoreId, setDraftStoreId] = useState<number | null>(null);
  const [partCategories, setPartCategories] = useState<Map<number, string>>(new Map());
  const [partCategoriesLoading, setPartCategoriesLoading] = useState(false);
  const [usingSavedPartCategories, setUsingSavedPartCategories] = useState(false);
  const [selectedPartCategory, setSelectedPartCategory] = useState<string | null>(null);
  const [draftPartCategory, setDraftPartCategory] = useState<string | null>(null);
  const stores = useMemo(() => summarizeStores(inventory), [inventory]);
  const totalParts = useMemo(() => new Set(inventory
    .filter(row => selectedStoreId === null || row.storeId === selectedStoreId)
    .map(row => row.partNumber)).size, [inventory, selectedStoreId]);

  const loadInventory = useCallback(async (userId: number) => {
    if (!syncInFlightRef.current) {
      syncInFlightRef.current = syncQueuedStock(offlineStockStore, userId, api.adjustStock)
        .finally(() => { syncInFlightRef.current = null; });
    }
    await syncInFlightRef.current;
    let baseRows: InventoryRow[];
    try {
      baseRows = await api.getInventory();
      await offlineStockStore.saveInventorySnapshot(userId, baseRows);
      setUsingCachedInventory(false);
      setError(current => current.startsWith('Offline mode ·') ? '' : current);
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) throw reason;
      const cachedRows = await offlineStockStore.loadInventorySnapshot(userId);
      if (!cachedRows) throw reason;
      baseRows = cachedRows;
      setUsingCachedInventory(true);
      setError('Offline mode · showing the last saved inventory. Stock changes stay on this device until synced.');
    }
    const queue = await offlineStockStore.list(userId);
    const rows = applyQueuedStockCounts(baseRows, queue);
    setInventory(rows);
    setInventorySnapshot(rows);
    setSnapshotStatus({savedAt: await offlineStockStore.getInventorySnapshotSavedAt(userId),
      queued: queue.filter(item => item.status === 'queued').length,
      conflicts: queue.filter(item => item.status === 'conflict').length});
  }, []);

  const restoreSession = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const savedSession = await api.getSession();
      if (!savedSession) {
        clearInventorySnapshot();
        setHasSession(false);
        setUser(null);
        return;
      }
      setHasSession(true);
      let currentUser: NativeUser;
      try {
        currentUser = await api.getMe();
        await offlineStockStore.saveProfile(currentUser);
      } catch (reason) {
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) throw reason;
        const activeUserId = await offlineStockStore.getActiveUserId();
        const savedProfile = activeUserId === null ? null : await offlineStockStore.loadProfile(activeUserId);
        if (!savedProfile) throw reason;
        currentUser = savedProfile;
        setError('Offline mode · showing the last saved inventory. Stock changes stay on this device until synced.');
      }
      setUser(currentUser);
      await loadInventory(currentUser.id);
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        clearInventorySnapshot();
        setHasSession(false);
        setUser(null);
        setInventory([]);
        setError(reason.status === 401
          ? 'Your session expired. Please sign in again.'
          : 'This account does not have an active company membership.');
      } else {
        setError(responseMessage(reason));
      }
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }, [loadInventory]);

  useEffect(() => {
    if (!hasSession || !user) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setPartCategoriesLoading(true);
      let cachedParts: PartRecord[] | null = null;
      try { cachedParts = await offlineStockStore.loadPartCatalog(user.id); }
      catch { /* A fresh catalog request can still succeed if local storage is unavailable. */ }
      try {
        const parts = await api.getParts();
        try { await offlineStockStore.savePartCatalog(user.id, parts); }
        catch { /* Category filtering remains available for the current session. */ }
        if (!active) return;
        const categories = new Map(parts.filter(part => part.category.trim()).map(part => [part.id, part.category.trim()]));
        setPartCategories(categories);
        setUsingSavedPartCategories(false);
        setSelectedPartCategory(current => current && ![...categories.values()].includes(current) ? null : current);
      } catch (reason) {
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
          if (active) {
            setPartCategories(new Map());
            setUsingSavedPartCategories(false);
            setSelectedPartCategory(null);
          }
          if (active) void restoreSession();
        } else if (reason instanceof TypeError || (reason instanceof ApiError && reason.status === 0)) {
          if (active) {
            const categories = new Map((cachedParts ?? []).filter(part => part.category.trim()).map(part => [part.id, part.category.trim()]));
            setPartCategories(categories);
            setUsingSavedPartCategories(cachedParts !== null);
            setSelectedPartCategory(current => current && ![...categories.values()].includes(current) ? null : current);
          }
        } else if (active) {
          setPartCategories(new Map());
          setUsingSavedPartCategories(false);
          setSelectedPartCategory(null);
        }
      } finally {
        if (active) setPartCategoriesLoading(false);
      }
    });
    return () => {active = false;};
  }, [hasSession, user, restoreSession]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (active) await restoreSession();
    });
    return () => { active = false; };
  }, [restoreSession]);

  useFocusEffect(useCallback(() => {
    if (!hasSession || user === null) return;
    const latestSnapshot = getInventorySnapshot();
    if (latestSnapshot !== null) setInventory(latestSnapshot);
  }, [hasSession, user]));

  useEffect(() => {
    if (!hasSession || !user) return;
    let active = true;
    let listenerReportedState = false;
    void Network.getNetworkStateAsync().then(state => {
      if (active && !listenerReportedState) {
        const status = getConnectivityStatus(state.isConnected, state.isInternetReachable);
        setNetworkConnected(status === 'checking' ? null : status === 'online');
      }
    }).catch(() => undefined);
    const subscription = Network.addNetworkStateListener(state => {
      listenerReportedState = true;
      const status = getConnectivityStatus(state.isConnected, state.isInternetReachable);
      const connected = status === 'checking' ? null : status === 'online';
      setNetworkConnected(connected);
      if (status === 'online') {
        void loadInventory(user.id).catch(reason => {
          if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
            void restoreSession();
          } else {
            setError(responseMessage(reason));
          }
        });
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [hasSession, user, loadInventory, restoreSession]);

  useEffect(() => {
    if (!user) return;
    const updateQueuedCount = async () => {
      const queue = await offlineStockStore.list(user.id);
      setSnapshotStatus(current => ({...current,
        queued: queue.filter(item => item.status === 'queued').length,
        conflicts: queue.filter(item => item.status === 'conflict').length}));
    };
    return offlineStockStore.subscribeQueueChanges(() => { void updateQueuedCount(); });
  }, [user]);

  async function pairWithDesktop(credential: MobilePairingCredential, onApprovalRequired: () => void) {
    setError('');
    setLoading(true);
    let issuedSession = false;
    pairingCancelledRef.current = false;
    clearInventorySnapshot();
    try {
      const deviceName = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web preview';
      const claim = await api.claimMobilePairing(credential, deviceName);
      onApprovalRequired();
      while (!pairingCancelledRef.current) {
        if (Date.parse(claim.expiresAt) <= Date.now()) {
          throw new ApiError('This pairing request expired. Generate a new QR code or pairing code from desktop and try again.', 410);
        }
        const result = await api.completeMobilePairing(claim.claimToken);
        if (result.status === 'approved') {
          await api.saveSession(result.session);
          issuedSession = true;
          setHasSession(true);
          const currentUser = await api.getMe();
          setUser(currentUser);
          await offlineStockStore.saveProfile(currentUser);
          await loadInventory(currentUser.id);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (reason) {
      if (issuedSession && reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        clearInventorySnapshot();
        setHasSession(false);
        setUser(null);
      }
      if (issuedSession) setError(responseMessage(reason));
      throw new Error(responseMessage(reason));
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }

  function cancelPairing() {
    pairingCancelledRef.current = true;
  }

  async function signOut() {
    if (!hasSession) return;
    setError('');
    setLoading(true);
    try {
      const result = await api.logout();
      if (!result.success) throw new ApiError('The server could not confirm sign out.', 0);
      await offlineStockStore.setActiveUserId(null);
      clearInventorySnapshot();
      setPendingSignOutCount(null);
      setHasSession(false);
      setUser(null);
      setInventory([]);
      router.setParams({filter: undefined, query: undefined});
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        await offlineStockStore.setActiveUserId(null);
        clearInventorySnapshot();
        setPendingSignOutCount(null);
        setHasSession(false);
        setUser(null);
        setInventory([]);
        router.setParams({filter: undefined, query: undefined});
      }
      const message = `Sign out failed: ${responseMessage(reason)}`;
      setSignOutError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function requestSignOut() {
    if (!user || loading || checkingSignOut) return;
    setCheckingSignOut(true);
    setSignOutError('');
    try {
      const pending = await offlineStockStore.list(user.id);
      if (pending.length > 0) {
        setPendingSignOutCount(pending.length);
      } else {
        await signOut();
      }
    } catch {
      setError('Could not check saved stock changes. Try again before signing out.');
    } finally {
      setCheckingSignOut(false);
    }
  }

  async function refresh() {
    if (!hasSession) return;
    setRefreshing(true);
    setError('');
    try {
      if (!user) return;
      await loadInventory(user.id);
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        clearInventorySnapshot();
        setHasSession(false);
        setUser(null);
        setInventory([]);
        setError(reason.status === 401
          ? 'Your session expired. Please sign in again.'
          : 'This account does not have an active company membership.');
      } else {
        setError(responseMessage(reason));
      }
    } finally {
      setRefreshing(false);
    }
  }

  const searchableInventory = useMemo(() => inventory.map(row => ({
    row,
    searchableText: normalizeInventorySearchText(
      `${row.partNumber} ${row.description} ${partCategories.get(row.partId) ?? ''} ${row.storeName} ${row.storeType} ${row.workOrder ?? ''}`,
    ),
  })), [inventory, partCategories]);

  const queryTerms = useMemo(() => normalizeInventorySearchText(search.trim()).split(' ').filter(Boolean), [search]);

  const inventoryPartCategories = useMemo(() => [...new Set(inventory
    .map(row => partCategories.get(row.partId))
    .filter((category): category is string => Boolean(category)))].sort((first, second) =>
    first.localeCompare(second, undefined, {numeric: true, sensitivity: 'base'})), [inventory, partCategories]);

  const getVisibleInventory = useCallback((filter: InventoryFilter, category = selectedPartCategory, storeId = selectedStoreId) => {
    const query = search.trim();
    const filtered = searchableInventory
      .filter(({row, searchableText}) => {
        const matchesSearch = !query || (queryTerms.length > 0 && queryTerms.every(term => searchableText.includes(term)));
        const matchesFilter = filter === 'all' ||
          (filter === 'needsAttention' && (row.quantity === 0 || row.quantity <= row.minThreshold)) ||
          (filter === 'outOfStock' && row.quantity === 0) ||
          (filter === 'lowStock' && row.quantity > 0 && row.quantity <= row.minThreshold) ||
          (filter === 'available' && !row.isAllocated) ||
          (filter === 'allocated' && row.isAllocated);
        const matchesCategory = category === null || partCategories.get(row.partId) === category;
        return matchesSearch && matchesFilter && matchesCategory && (storeId === null || row.storeId === storeId);
      })
      .map(({row}) => row);
    return sortInventory(filtered, inventorySort);
  }, [searchableInventory, search, queryTerms, inventorySort, selectedStoreId, partCategories, selectedPartCategory]);

  const visibleInventory = useMemo(() => getVisibleInventory(inventoryFilter), [getVisibleInventory, inventoryFilter]);
  const categoryFilterScope = useMemo(() => getVisibleInventory(draftInventoryFilter, null, draftStoreId),
    [getVisibleInventory, draftInventoryFilter, draftStoreId]);
  const storeItemCount = inventory.filter(row => selectedStoreId === null || row.storeId === selectedStoreId).length;

  const hasInventoryCriteria = search.trim().length > 0 || inventoryFilter !== 'all' || selectedPartCategory !== null;
  const isOffline = usingCachedInventory || networkConnected === false;
  const connectionUnknown = !usingCachedInventory && networkConnected === null;
  const connectionStatusTitle = isOffline
    ? snapshotStatus.savedAt === null
      ? 'Offline · No stock saved on this device'
      : 'Offline · Showing the last saved stock'
    : connectionUnknown
      ? 'Checking connection…'
      : snapshotStatus.savedAt === null
        ? 'Online · Stock refresh time unavailable'
        : `Online · ${formatSnapshotTime(snapshotStatus.savedAt)}`;
  const connectionStatusDetail = isOffline && snapshotStatus.savedAt !== null
    ? 'Changes sync when you’re back online.'
    : '';

  const inventoryFilterCounts = useMemo(() => getVisibleInventory('all', draftPartCategory, draftStoreId).reduce((counts, row) => {
    counts.all += 1;
    if (row.quantity === 0 || row.quantity <= row.minThreshold) counts.needsAttention += 1;
    if (row.quantity === 0) counts.outOfStock += 1;
    else if (row.quantity <= row.minThreshold) counts.lowStock += 1;
    if (row.isAllocated) counts.allocated += 1;
    else counts.available += 1;
    return counts;
  }, {all: 0, needsAttention: 0, outOfStock: 0, lowStock: 0, available: 0, allocated: 0}),
  [getVisibleInventory, draftPartCategory, draftStoreId]);

  function clearInventoryCriteria() {
    Keyboard.dismiss();
    router.setParams({filter: undefined, query: undefined});
    setInventorySort('default');
    setSelectedPartCategory(null);
  }

  function openFilterSort() {
    setDraftStoreId(selectedStoreId);
    setDraftInventoryFilter(inventoryFilter);
    setDraftInventorySort(inventorySort);
    setDraftPartCategory(selectedPartCategory);
    setFilterSortVisible(true);
  }

  function applyFilterSort() {
    router.setParams({storeId: draftStoreId === null ? undefined : String(draftStoreId)});
    if (draftInventoryFilter !== inventoryFilter || draftPartCategory !== selectedPartCategory) {
      const nextVisibleInventory = getVisibleInventory(draftInventoryFilter, draftPartCategory);
      announceInventoryResultCount(nextVisibleInventory.length, inventory.length, search, draftInventoryFilter);
    }
    router.setParams({filter: draftInventoryFilter === 'all' ? undefined : draftInventoryFilter});
    setInventorySort(draftInventorySort);
    setSelectedPartCategory(draftPartCategory);
    setFilterSortVisible(false);
  }

  const activeFilterSortLabels = [
    selectedStoreId !== null ? stores.find(store => store.id === selectedStoreId)?.name ?? 'Selected store' : undefined,
    inventoryFilter !== 'all' ? inventoryFilterOptions.find(option => option.value === inventoryFilter)?.label : undefined,
    selectedPartCategory ? `Category: ${selectedPartCategory}` : undefined,
    inventorySort !== 'default' ? inventorySortOptions.find(option => option.value === inventorySort)?.label : undefined,
  ].filter((label): label is string => Boolean(label));
  const filterSortButtonLabel = activeFilterSortLabels.length > 0
    ? activeFilterSortLabels.join(' · ')
    : 'Filter & sort';

  if ((!isReady && !user) || (loading && !user && hasSession)) {
    return <LoadingScreen message="Checking your session…" />;
  }

  if (user && hasSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View style={styles.inventoryHeader}>
            <View style={styles.topBar}>
              <View style={styles.brandMark}><Image source={require('../../assets/icon.png')} style={styles.brandIcon} /></View>
              <View style={styles.brandCopy}>
                <Text style={styles.wordmark}>Spares Tracker</Text>
                <Text accessibilityRole="header" style={styles.pageTitle}>{showingStores ? 'Stores' : selectedStoreId !== null ? inventory.find(row => row.storeId === selectedStoreId)?.storeName ?? 'Store inventory' : 'Inventory'}</Text>
              </View>
              <View style={[styles.connectionPill, isOffline && styles.connectionPillOffline,
                connectionUnknown && styles.connectionPillChecking]}>
                <View style={[styles.connectionDot, isOffline && styles.connectionDotOffline,
                  connectionUnknown && styles.connectionDotChecking]} />
                <Text style={[styles.connectionStatusText, isOffline && styles.connectionStatusTextOffline,
                  connectionUnknown && styles.connectionStatusTextChecking]}>
                  {isOffline ? 'Offline snapshot' : connectionUnknown ? 'Checking' : 'Online'}
                </Text>
              </View>
            </View>

            <View style={styles.welcomeRow}>
              <View>
                <Text style={styles.welcome}>{showingStores ? 'Find a store' : 'Stock on hand'}</Text>
                <Text style={styles.headerSubline}>{showingStores
                  ? `${user.role.replaceAll('_', ' ')} · ${isMockMode ? 'preview data' : 'live inventory'}`
                  : `${totalParts} total parts · ${user.role.replaceAll('_', ' ')} · ${isMockMode ? 'preview data' : 'live inventory'}`}</Text>
              </View>
              <View style={styles.totalBadge}>
                <Text style={styles.totalNumber}>{showingStores ? new Set(inventory.map(row => row.storeId)).size : inventory.filter(row => selectedStoreId === null || row.storeId === selectedStoreId).length}</Text>
                <Text style={styles.totalLabel}>{showingStores ? 'STORES' : 'STOCK ENTRIES'}</Text>
              </View>
            </View>

            <View accessibilityRole="summary" style={styles.connectionStatus}>
              <View style={[styles.connectionDot, isOffline ? styles.connectionDotOffline
                : connectionUnknown ? styles.connectionDotChecking : styles.connectionDotOnline]} />
              <View style={styles.connectionStatusCopy}>
                <Text style={[styles.connectionStatusText, isOffline && styles.connectionStatusTextOffline,
                  connectionUnknown && styles.connectionStatusTextChecking]}>{connectionStatusTitle}</Text>
                {!!connectionStatusDetail && <Text style={styles.connectionStatusDetail}>{connectionStatusDetail}</Text>}
              </View>
              {(snapshotStatus.queued > 0 || snapshotStatus.conflicts > 0) && (
                <Pressable accessibilityRole="button" accessibilityLabel="Review offline changes"
                  onPress={() => router.push('/offline-changes')} style={styles.syncPendingButton}>
                  <Text style={styles.syncPending}>{snapshotStatus.conflicts > 0 ? `${snapshotStatus.conflicts} need review` : `${snapshotStatus.queued} waiting`}</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.searchBox}>
              <AppIcon name="search" color={palette.muted} size={19} />
              <TextInput accessibilityLabel={showingStores ? 'Search stores' : 'Search inventory'} value={search}
                onChangeText={value => router.setParams({query: value || undefined})}
                placeholder={showingStores ? 'Search store name or type' : 'Part, category, store, or work order'} placeholderTextColor={palette.placeholder}
                accessibilityHint={showingStores
                  ? 'Searches store names and types.'
                  : 'Searches part numbers, descriptions, categories, store names and types, and work-order numbers.'}
                autoCapitalize="none" autoCorrect={false}
                style={styles.searchInput} returnKeyType="search"
                onSubmitEditing={() => {Keyboard.dismiss(); announceInventoryResultCount(visibleInventory.length, inventory.length, search, inventoryFilter);}} />
              {search.length > 0 && (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" accessibilityHint="Clears the inventory search"
                  onPress={() => router.setParams({query: undefined})} style={styles.clearSearchButton} hitSlop={4}>
                  <Text style={styles.clearSearchText}>×</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.controlsRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Browse stores" style={styles.filterSortButton}
                onPress={() => router.setParams({view: showingStores ? undefined : 'stores', storeId: undefined, query: undefined, filter: undefined})}>
                <AppIcon name="inventory" color={palette.white} size={18} />
                <Text style={styles.filterSortButtonText}>{showingStores ? 'All inventory' : `Stores (${stores.length})`}</Text>
              </Pressable>
            </View>

            {selectedStoreId !== null && <Pressable accessibilityRole="button" onPress={() => router.setParams({view: 'stores', storeId: undefined, query: undefined, filter: undefined})} style={styles.resetControlsButton}><Text style={styles.resetControlsText}>All stores</Text></Pressable>}
            {!showingStores && <View style={styles.controlsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Filter and sort inventory${activeFilterSortLabels.length ? `, active: ${activeFilterSortLabels.join(', ')}` : ''}`}
              onPress={openFilterSort}
              style={[styles.filterSortButton, activeFilterSortLabels.length > 0 && styles.filterSortButtonActive]}
            >
              <AppIcon name="filter" color={palette.white} size={18} />
              <Text numberOfLines={1} style={styles.filterSortButtonText}>{filterSortButtonLabel}</Text>
            </Pressable>
            {activeFilterSortLabels.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset filters and sorting"
                onPress={() => {router.setParams({filter: undefined, storeId: undefined}); setInventorySort('default'); setSelectedPartCategory(null);}}
                style={styles.resetControlsButton}
              >
                <Text style={styles.resetControlsText}>Reset</Text>
              </Pressable>
            )}
            </View>}
          </View>

          {!!error && <ErrorNotice message={error} onRetry={refresh} />}

          {showingStores ? <StoresDirectory items={inventory} search={search} refreshing={refreshing} onRefresh={refresh}
            onSelect={id => router.setParams({view: undefined, storeId: String(id), query: undefined, filter: undefined})} /> : <FlatList
            data={visibleInventory}
            keyExtractor={row => String(row.id)}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.navy} />}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={visibleInventory.length > 0 ? (
              <Text accessibilityRole="text" style={styles.resultsSummary}>
                {hasInventoryCriteria
                  ? `Showing ${visibleInventory.length} of ${storeItemCount} ${storeItemCount === 1 ? 'item' : 'items'}`
                  : `${storeItemCount} ${storeItemCount === 1 ? 'item' : 'items'} · ${formatSnapshotTime(snapshotStatus.savedAt)}`}
              </Text>
            ) : undefined}
            ListEmptyComponent={loading && !error ? <InventorySkeleton /> : error ? <></> : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{hasInventoryCriteria ? 'No matching stock' : 'No stock to show'}</Text>
                <Text style={styles.muted}>
                  {hasInventoryCriteria
                    ? 'Try changing your search or filter.'
                    : 'Pull down to refresh your inventory.'}
                </Text>
                {hasInventoryCriteria && inventory.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search and filters"
                    accessibilityHint="Clears the search, shows all stock, and restores the default sort"
                    onPress={clearInventoryCriteria}
                    style={styles.emptyResetButton}
                  >
                    <Text style={styles.emptyResetText}>Clear search and filters</Text>
                  </Pressable>
                )}
              </View>
            )}
            renderItem={({item: row}) => {
              const outOfStock = row.quantity === 0;
              const lowStock = row.quantity <= row.minThreshold;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={inventoryRowAccessibilityLabel(row, partCategories.get(row.partId))}
                  accessibilityHint="Opens stock details"
                  onPress={() => {
                    Keyboard.dismiss();
                    router.push({pathname: '/inventory/[itemId]', params: {itemId: String(row.id), userId: String(user?.id ?? '')}});
                  }}
                  style={({pressed}) => [styles.stockCard, pressed && styles.stockCardPressed]}
                >
                  <View style={styles.itemMark}><AppIcon name="inventory" color={palette.navy} size={19} /></View>
                  <View style={styles.itemCopy}>
                    <View style={styles.itemTitleRow}>
                      <Text style={styles.partNumber} numberOfLines={1}>{row.partNumber}</Text>
                      <View style={[styles.quantityBadge, lowStock && styles.lowQuantityBadge, outOfStock && styles.outQuantityBadge]}>
                        <View style={[styles.statusDot, lowStock && styles.lowStatusDot, outOfStock && styles.outStatusDot]} />
                        <Text style={[styles.quantityValue, lowStock && styles.lowQuantityText, outOfStock && styles.outQuantityText]}>{row.quantity}</Text>
                        <Text style={[styles.quantityCaption, lowStock && styles.lowQuantityText, outOfStock && styles.outQuantityText]}>{outOfStock ? 'Out' : lowStock ? 'Low' : 'Healthy'}</Text>
                      </View>
                    </View>
                    <View style={styles.descriptionRow}>
                      <Text style={styles.description} numberOfLines={1}>{row.description}</Text>
                      {!!partCategories.get(row.partId) && (
                        <Text numberOfLines={1} style={styles.categoryTag}>Category · {partCategories.get(row.partId)}</Text>
                      )}
                    </View>
                    <View style={styles.statusRow}>
                      <Text style={styles.locationText} numberOfLines={1}>{row.storeName}</Text>
                      <Text style={styles.threshold}>Min. {row.minThreshold}</Text>
                    </View>
                    {row.isAllocated && (
                      <Text style={styles.allocatedStatus} numberOfLines={1}>
                        Allocated{row.workOrder ? ` · Work order ${row.workOrder}` : ''}
                      </Text>
                    )}
                  </View>
                  <AppIcon name="chevronRight" color={palette.slate} size={17} />
                </Pressable>
              );
            }}
          />
          }
          <AppBottomNavigation
            active={showingStores ? 'more' : 'inventory'}
            queuedCount={snapshotStatus.queued}
            conflictCount={snapshotStatus.conflicts}
            onSignOut={() => void requestSignOut()}
          />
        </View>
        <Modal
          transparent
          visible={filterSortVisible}
          animationType="slide"
          onRequestClose={() => setFilterSortVisible(false)}
        >
          <View style={styles.filterSortBackdrop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close filter and sort options"
              onPress={() => setFilterSortVisible(false)}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.filterSortSheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.filterSortHeader}>
                <Text accessibilityRole="header" style={styles.filterSortTitle}>Filter & sort</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close filter and sort options"
                  onPress={() => setFilterSortVisible(false)}
                  style={styles.sheetCloseButton}
                >
                  <AppIcon name="close" color={palette.muted} size={20} />
                </Pressable>
              </View>
              <ScrollView style={styles.filterSortOptions} showsVerticalScrollIndicator={false}>
                <Text accessibilityRole="header" style={styles.filterSortSectionTitle}>Store</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Filter by store">
                  {[{id: null, name: 'All stores'}, ...stores].map(store => (
                    <Pressable key={String(store.id)} accessibilityRole="radio" accessibilityLabel={store.name}
                      accessibilityState={{checked: draftStoreId === store.id}} onPress={() => setDraftStoreId(store.id)}
                      style={[styles.filterSortOption, draftStoreId === store.id && styles.filterSortOptionSelected]}>
                      <View style={styles.optionRadio}>{draftStoreId === store.id && <View style={styles.optionRadioSelected} />}</View>
                      <Text style={styles.filterSortOptionText}>{store.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text accessibilityRole="header" style={styles.filterSortSectionTitle}>Part category</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Filter by part category">
                  <Pressable accessibilityRole="radio" accessibilityLabel={`All categories, ${categoryFilterScope.length} ${categoryFilterScope.length === 1 ? 'item' : 'items'}`}
                    accessibilityState={{checked: draftPartCategory === null}} onPress={() => setDraftPartCategory(null)}
                    style={[styles.filterSortOption, draftPartCategory === null && styles.filterSortOptionSelected]}>
                    <View style={styles.optionRadio}>{draftPartCategory === null && <View style={styles.optionRadioSelected} />}</View>
                    <Text style={[styles.filterSortOptionText, draftPartCategory === null && styles.filterSortOptionTextSelected]}>All categories</Text>
                    <Text style={styles.filterSortOptionCount}>{categoryFilterScope.length}</Text>
                  </Pressable>
                  {inventoryPartCategories.map(category => {
                    const selected = draftPartCategory === category;
                    const count = categoryFilterScope.filter(row => partCategories.get(row.partId) === category).length;
                    return <Pressable key={category} accessibilityRole="radio" accessibilityLabel={`${category}, ${count} ${count === 1 ? 'item' : 'items'}`}
                      accessibilityState={{checked: selected}} onPress={() => setDraftPartCategory(category)}
                      style={[styles.filterSortOption, selected && styles.filterSortOptionSelected]}>
                      <View style={styles.optionRadio}>{selected && <View style={styles.optionRadioSelected} />}</View>
                      <Text style={[styles.filterSortOptionText, selected && styles.filterSortOptionTextSelected]}>{category}</Text>
                      <Text style={styles.filterSortOptionCount}>{count}</Text>
                    </Pressable>;
                  })}
                </View>
                {usingSavedPartCategories && <Text style={styles.filterSortHelp}>Offline · using categories from the saved parts catalog.</Text>}
                {!usingSavedPartCategories && partCategoriesLoading && <Text style={styles.filterSortHelp}>Loading part categories…</Text>}
                {!usingSavedPartCategories && !partCategoriesLoading && inventoryPartCategories.length === 0 && <Text style={styles.filterSortHelp}>No categories are available for these items.</Text>}
                <Text accessibilityRole="header" style={styles.filterSortSectionTitle}>Stock status</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Filter inventory">
                  {inventoryFilterOptions.map(option => {
                    const selected = draftInventoryFilter === option.value;
                    const count = inventoryFilterCounts[option.value];
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityHint={`${count} ${count === 1 ? 'item' : 'items'}`}
                        accessibilityState={{checked: selected}}
                        onPress={() => setDraftInventoryFilter(option.value)}
                        style={[styles.filterSortOption, selected && styles.filterSortOptionSelected]}
                      >
                        <View style={styles.optionRadio}>{selected && <View style={styles.optionRadioSelected} />}</View>
                        <Text style={[styles.filterSortOptionText, selected && styles.filterSortOptionTextSelected]}>{option.label}</Text>
                        <Text style={styles.filterSortOptionCount}>{count}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text accessibilityRole="header" style={[styles.filterSortSectionTitle, styles.sortSectionTitle]}>Sort by</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Sort inventory">
                  {inventorySortOptions.map(option => {
                    const selected = draftInventorySort === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{checked: selected}}
                        onPress={() => setDraftInventorySort(option.value)}
                        style={[styles.filterSortOption, selected && styles.filterSortOptionSelected]}
                      >
                        <View style={styles.optionRadio}>{selected && <View style={styles.optionRadioSelected} />}</View>
                        <Text style={[styles.filterSortOptionText, selected && styles.filterSortOptionTextSelected]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={styles.filterSortActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset filters and sorting"
                  onPress={() => {setDraftInventoryFilter('all'); setDraftInventorySort('default'); setDraftStoreId(null); setDraftPartCategory(null);}}
                  style={styles.filterSortResetButton}
                >
                  <Text style={styles.filterSortResetText}>Reset</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={applyFilterSort} style={styles.filterSortApplyButton}>
                  <Text style={styles.filterSortApplyText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          visible={pendingSignOutCount !== null}
          animationType="fade"
          onRequestClose={() => {if (!loading) {setPendingSignOutCount(null); setSignOutError('');}}}
        >
          <View style={styles.signOutBackdrop}>
            <View accessibilityRole="alert" style={styles.signOutCard}>
              <Text accessibilityRole="header" style={styles.signOutTitle}>Keep your offline changes?</Text>
              <Text style={styles.signOutMessage}>
                {pendingSignOutCount} unsynced stock change{pendingSignOutCount === 1 ? ' is' : 's are'} saved on this device. They will remain tied to this account and be available when you sign in again.
              </Text>
              {!!signOutError && <Text accessibilityRole="alert" style={styles.signOutError}>{signOutError}</Text>}
              <View style={styles.signOutActions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Stay signed in" disabled={loading}
                  onPress={() => {setPendingSignOutCount(null); setSignOutError('');}} style={styles.signOutKeepButton}>
                  <Text style={styles.signOutKeepText}>Stay signed in</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Sign out and keep changes" disabled={loading}
                  onPress={() => void signOut()} style={styles.signOutConfirmButton}>
                  <Text style={styles.signOutConfirmText}>{loading ? 'Signing out…' : 'Sign out'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.onboardingContent} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.heroBrandRow}>
              <View style={styles.heroMark}><Image source={require('../../assets/icon.png')} style={styles.heroBrandIcon} /></View>
              <View style={styles.heroBrandCopy}>
                <Text style={styles.heroWordmark}>Spares Tracker</Text>
                <Text style={styles.heroTagline}>Warehouse inventory, made thumb-fast</Text>
              </View>
            </View>
            <View style={styles.pairingProgressLabel}>
              <Text style={styles.heroLabel}>{pairingPhase === 'welcome' ? 'STEP 1 OF 3' : pairingPhase === 'pending' ? 'STEP 3 OF 3' : 'STEP 2 OF 3'}</Text>
              <Text style={styles.heroStep}>{pairingPhase === 'welcome' ? 'Pair this device' : pairingPhase === 'scan' ? 'Scan desktop QR' : pairingPhase === 'code' ? 'Enter pairing code' : 'Approve this device'}</Text>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, pairingPhase === 'scan' && styles.progressFillScan, pairingPhase === 'pending' && styles.progressFillPending]} /></View>
          </View>
          {!!error && <ErrorNotice message={error} onRetry={hasSession ? restoreSession : undefined} />}
          <DesktopPairing mockMode={isMockMode} onPair={pairWithDesktop} onCancel={cancelPairing} onPhaseChange={setPairingPhase} />
          <Text style={styles.onboardingFootnote}>Mobile access is managed by your organisation. Your desktop profile is used to approve this device.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function LoadingScreen({message}: {message: string}) {
  return (
    <SafeAreaView style={[styles.safeArea, styles.loadingScreen]}>
      <ActivityIndicator size="large" color={palette.navy} />
      <Text style={styles.muted}>{message}</Text>
    </SafeAreaView>
  );
}

function ErrorNotice({message, onRetry}: {message: string; onRetry?: () => void}) {
  return (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={() => void onRetry()}><Text style={styles.retryText}>Retry</Text></Pressable>}
    </View>
  );
}

function InventorySkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading inventory" style={styles.skeletonList}>
      {[0, 1, 2, 3].map(index => (
        <View key={index} style={styles.skeletonCard}>
          <View style={styles.skeletonTopRow}>
            <View style={[styles.skeletonLine, styles.skeletonPartNumber]} />
            <View style={styles.skeletonQuantity} />
          </View>
          <View style={[styles.skeletonLine, styles.skeletonDescription]} />
          <View style={[styles.skeletonLine, styles.skeletonLocation]} />
        </View>
      ))}
    </View>
  );
}

const palette = {
  navy: '#15263B',
  amber: '#E9A23B',
  slate: '#64748B',
  background: '#F5F7FA',
  white: '#FFFFFF',
  text: '#15263B',
  muted: '#475569',
  placeholder: '#64748B',
  border: '#CBD5E1',
  red: '#A13A32',
  redTint: '#FFF0EE',
};

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 16},
  inventoryHeader: {marginHorizontal: -16, paddingHorizontal: 16, paddingBottom: 12, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, backgroundColor: palette.navy},
  topBar: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#34475C'},
  brandMark: {width: 42, height: 42, borderRadius: 13, overflow: 'hidden'},
  brandIcon: {width: 42, height: 42},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 16, fontWeight: '800', color: palette.white},
  pageTitle: {fontSize: 11, fontWeight: '600', color: '#C4D0DC'},
  connectionPill: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: '#26394E'},
  connectionPillOffline: {backgroundColor: '#423722'},
  connectionPillChecking: {backgroundColor: '#304357'},
  headerSubline: {marginTop: 3, color: '#C4D0DC', fontSize: 10},
  signOutBackdrop: {flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(21, 38, 59, 0.48)'},
  signOutCard: {padding: 20, borderRadius: 16, backgroundColor: palette.white},
  signOutTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  signOutMessage: {marginTop: 9, fontSize: 14, lineHeight: 21, color: palette.muted},
  signOutError: {marginTop: 9, fontSize: 13, lineHeight: 19, color: palette.red},
  signOutActions: {flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 18},
  signOutKeepButton: {flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  signOutKeepText: {fontSize: 13, fontWeight: '700', color: palette.navy},
  signOutConfirmButton: {flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11, backgroundColor: palette.navy},
  signOutConfirmText: {fontSize: 13, fontWeight: '800', color: palette.white},
  welcomeRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, paddingBottom: 8},
  connectionStatus: {minHeight: 33, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#22364B'},
  connectionDot: {width: 7, height: 7, borderRadius: 4},
  connectionDotOnline: {backgroundColor: '#52B788'},
  connectionDotOffline: {backgroundColor: palette.amber},
  connectionDotChecking: {backgroundColor: '#CBD5E1'},
  connectionStatusCopy: {flex: 1},
  connectionStatusText: {fontSize: 11, lineHeight: 15, color: '#E7EDF3'},
  connectionStatusTextOffline: {fontWeight: '700', color: '#FFE4A3'},
  connectionStatusTextChecking: {color: '#D5DEE8'},
  connectionStatusDetail: {fontSize: 10, lineHeight: 14, color: '#C4D0DC'},
  syncPending: {fontSize: 10, fontWeight: '700', color: palette.white, textAlign: 'right'},
  syncPendingButton: {minHeight: 32, justifyContent: 'center', paddingLeft: 6},
  welcome: {fontSize: 17, fontWeight: '800', color: palette.white},
  muted: {marginTop: 3, color: palette.muted, fontSize: 11},
  totalBadge: {minWidth: 62, alignItems: 'center', borderRadius: 10, backgroundColor: '#26394E', paddingVertical: 5, paddingHorizontal: 8},
  totalNumber: {fontSize: 17, fontWeight: '800', color: palette.white},
  totalLabel: {fontSize: 8, fontWeight: '800', letterSpacing: 0.9, color: '#C4D0DC'},
  searchBox: {height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, paddingHorizontal: 12, backgroundColor: palette.white, borderRadius: 12, borderWidth: 1, borderColor: '#D7E0E9'},
  searchInput: {flex: 1, paddingVertical: 10, fontSize: 14, color: palette.text},
  clearSearchButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  clearSearchText: {fontSize: 25, lineHeight: 29, color: palette.muted},
  controlsRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7},
  filterSortButton: {flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderWidth: 1, borderColor: '#44586E', borderRadius: 10, backgroundColor: '#22364B'},
  filterSortButtonActive: {borderColor: palette.amber, backgroundColor: '#3D3528'},
  filterSortButtonText: {flex: 1, fontSize: 12, fontWeight: '700', color: palette.white},
  resetControlsButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 8},
  resetControlsText: {fontSize: 12, fontWeight: '700', color: '#E7EDF3'},
  filterSortBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21, 38, 59, 0.38)'},
  filterSortSheet: {maxHeight: '90%', paddingHorizontal: 20, paddingTop: 9, paddingBottom: 24, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: palette.white},
  sheetHandle: {alignSelf: 'center', width: 42, height: 4, marginBottom: 8, borderRadius: 2, backgroundColor: palette.border},
  filterSortHeader: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  filterSortTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  sheetCloseButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  filterSortOptions: {flexGrow: 0, flexShrink: 1, maxHeight: 480},
  filterSortSectionTitle: {marginTop: 9, marginBottom: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.3, color: palette.muted},
  filterSortHelp: {marginHorizontal: 10, marginTop: 3, marginBottom: 4, fontSize: 12, lineHeight: 17, color: palette.muted},
  filterSortOption: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: 9},
  filterSortOptionSelected: {backgroundColor: '#FFF8EA'},
  optionRadio: {width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: palette.slate, borderRadius: 10},
  optionRadioSelected: {width: 10, height: 10, borderRadius: 5, backgroundColor: palette.amber},
  filterSortOptionText: {flex: 1, fontSize: 14, fontWeight: '600', color: palette.text},
  filterSortOptionTextSelected: {fontWeight: '800', color: palette.navy},
  filterSortOptionCount: {minWidth: 24, fontSize: 12, textAlign: 'right', color: palette.muted},
  sortSectionTitle: {marginTop: 14},
  filterSortActions: {flexDirection: 'row', gap: 10, paddingTop: 12},
  filterSortResetButton: {minHeight: 46, minWidth: 100, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: palette.border, borderRadius: 10, backgroundColor: palette.white},
  filterSortResetText: {fontSize: 13, fontWeight: '700', color: palette.navy},
  filterSortApplyButton: {flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: palette.amber},
  filterSortApplyText: {fontSize: 13, fontWeight: '800', color: palette.navy},
  listContent: {paddingTop: 9, paddingBottom: 10},
  resultsSummary: {paddingHorizontal: 2, paddingBottom: 2, fontSize: 12, fontWeight: '600', color: palette.muted},
  stockCard: {minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 7, paddingHorizontal: 9, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: '#E3E9EF', backgroundColor: palette.white},
  stockCardPressed: {opacity: 0.72},
  itemMark: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#F0F3F6'},
  itemCopy: {flex: 1, minWidth: 0},
  itemTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  partNumber: {flex: 1, minWidth: 0, fontSize: 13, fontWeight: '800', letterSpacing: 0.1, color: palette.navy},
  descriptionRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3},
  description: {flex: 1, minWidth: 0, fontSize: 11, lineHeight: 15, fontWeight: '500', color: palette.text},
  categoryTag: {maxWidth: 128, overflow: 'hidden', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#F0F3F6', fontSize: 9, lineHeight: 12, fontWeight: '700', color: palette.slate},
  quantityBadge: {minWidth: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 4, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#E3F3E8'},
  quantityValue: {fontSize: 12, fontWeight: '800', color: '#21653A'},
  quantityCaption: {width: '100%', marginTop: 1, fontSize: 7, textAlign: 'center', fontWeight: '800', letterSpacing: 0.2, color: '#21653A'},
  statusDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#287441'},
  lowStatusDot: {backgroundColor: '#E9A23B'},
  outStatusDot: {backgroundColor: '#D92D20'},
  lowQuantityBadge: {backgroundColor: '#FFF2D0'},
  lowQuantityText: {color: '#8A4B08'},
  outQuantityBadge: {backgroundColor: '#FCE8E6'},
  outQuantityText: {color: palette.red},
  statusRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3},
  locationText: {flex: 1, fontSize: 10, fontWeight: '600', color: palette.muted},
  allocatedStatus: {marginTop: 3, fontSize: 10, fontWeight: '700', color: palette.slate},
  threshold: {fontSize: 11, color: palette.muted},
  skeletonList: {gap: 8},
  skeletonCard: {paddingHorizontal: 13, paddingVertical: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 13, backgroundColor: palette.white},
  skeletonTopRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  skeletonLine: {borderRadius: 6, backgroundColor: '#E8EDF2'},
  skeletonPartNumber: {width: '48%', height: 17},
  skeletonQuantity: {width: 62, height: 39, borderRadius: 10, backgroundColor: '#E8EDF2'},
  skeletonDescription: {width: '76%', height: 14, marginTop: 9},
  skeletonLocation: {width: '57%', height: 12, marginTop: 12},
  emptyState: {alignItems: 'center', paddingHorizontal: 24, paddingTop: 70},
  emptyTitle: {fontSize: 17, fontWeight: '800', color: palette.text},
  emptyResetButton: {minHeight: 44, justifyContent: 'center', marginTop: 15, paddingHorizontal: 16, borderWidth: 1, borderColor: palette.amber, borderRadius: 22, backgroundColor: palette.white},
  emptyResetText: {fontSize: 13, fontWeight: '800', color: palette.navy},
  onboardingContent: {flexGrow: 1, padding: 18, justifyContent: 'center'},
  hero: {paddingHorizontal: 22, paddingTop: 26, paddingBottom: 30, backgroundColor: palette.navy, borderTopLeftRadius: 24, borderTopRightRadius: 24},
  heroBrandRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  heroMark: {width: 40, height: 40, borderRadius: 12, overflow: 'hidden'},
  heroBrandIcon: {width: 40, height: 40},
  heroBrandCopy: {flex: 1},
  heroWordmark: {fontSize: 18, fontWeight: '800', color: palette.white},
  heroTagline: {marginTop: 2, fontSize: 10, color: '#C1D0DF'},
  pairingProgressLabel: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24},
  heroLabel: {fontSize: 10, fontWeight: '800', letterSpacing: 1, color: palette.amber},
  heroStep: {fontSize: 12, fontWeight: '700', color: palette.white},
  progressTrack: {height: 4, marginTop: 9, borderRadius: 2, backgroundColor: '#3D5065'},
  progressFill: {width: '34%', height: 4, borderRadius: 2, backgroundColor: palette.amber},
  progressFillScan: {width: '67%'},
  progressFillPending: {width: '100%'},
  onboardingFootnote: {marginTop: 14, marginHorizontal: 14, textAlign: 'center', fontSize: 11, lineHeight: 17, color: palette.muted},
  errorNotice: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: palette.redTint},
  errorText: {flex: 1, fontSize: 12, lineHeight: 18, color: palette.red},
  retryText: {fontWeight: '800', color: palette.red},
  loadingScreen: {alignItems: 'center', justifyContent: 'center', gap: 12},
});
