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
import {useRouter} from 'expo-router';
import * as Network from 'expo-network';
import {api, isMockMode} from '../api/runtime';
import {ApiError, type InventoryRow, type NativeUser} from '../api/client';
import {clearInventorySnapshot, setInventorySnapshot} from '../features/inventory/inventorySnapshot';
import {sortInventory, type InventorySort} from '../features/inventory/inventorySort';
import {inventoryRowAccessibilityLabel} from '../features/inventory/inventoryAccessibility';
import {applyQueuedStockCounts, syncQueuedStock} from '../features/inventory/offlineStockQueue';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import DesktopPairing from '../features/auth/DesktopPairing';
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

type InventoryFilter = 'all' | 'outOfStock' | 'lowStock' | 'available' | 'allocated';
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
  {value: 'outOfStock', label: 'Out of stock'},
  {value: 'lowStock', label: 'Low stock'},
  {value: 'available', label: 'Available'},
  {value: 'allocated', label: 'Allocated'},
];

const inventorySortOptions: {value: InventorySort; label: string}[] = [
  {value: 'default', label: 'Default'},
  {value: 'partNumber', label: 'Part number'},
  {value: 'lowestStock', label: 'Lowest stock'},
];

export default function InventoryScreen() {
  const router = useRouter();
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
  const [search, setSearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const [inventorySort, setInventorySort] = useState<InventorySort>('default');
  const [filterSortVisible, setFilterSortVisible] = useState(false);
  const [draftInventoryFilter, setDraftInventoryFilter] = useState<InventoryFilter>('all');
  const [draftInventorySort, setDraftInventorySort] = useState<InventorySort>('default');

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
    let active = true;
    void Promise.resolve().then(async () => {
      if (active) await restoreSession();
    });
    return () => { active = false; };
  }, [restoreSession]);

  useEffect(() => {
    if (!hasSession || !user) return;
    let active = true;
    let listenerReportedState = false;
    void Network.getNetworkStateAsync().then(state => {
      if (active && !listenerReportedState) {
        setNetworkConnected(state.isConnected === true && state.isInternetReachable !== false);
      }
    }).catch(() => undefined);
    const subscription = Network.addNetworkStateListener(state => {
      listenerReportedState = true;
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      setNetworkConnected(connected);
      if (connected) {
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

  async function pairWithDesktop(qrData: string, onApprovalRequired: () => void) {
    setError('');
    setLoading(true);
    let issuedSession = false;
    pairingCancelledRef.current = false;
    clearInventorySnapshot();
    try {
      const deviceName = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web preview';
      const claim = await api.claimMobilePairing(qrData, deviceName);
      onApprovalRequired();
      while (!pairingCancelledRef.current) {
        if (Date.parse(claim.expiresAt) <= Date.now()) {
          throw new ApiError('This pairing request expired. Generate a new QR code from desktop and try again.', 410);
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
      setSearch('');
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        await offlineStockStore.setActiveUserId(null);
        clearInventorySnapshot();
        setPendingSignOutCount(null);
        setHasSession(false);
        setUser(null);
        setInventory([]);
        setSearch('');
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
      `${row.partNumber} ${row.description} ${row.storeName} ${row.storeType} ${row.workOrder ?? ''}`,
    ),
  })), [inventory]);

  const queryTerms = useMemo(() => normalizeInventorySearchText(search.trim()).split(' ').filter(Boolean), [search]);

  const getVisibleInventory = useCallback((filter: InventoryFilter) => {
    const query = search.trim();
    const filtered = searchableInventory
      .filter(({row, searchableText}) => {
        const matchesSearch = !query || (queryTerms.length > 0 && queryTerms.every(term => searchableText.includes(term)));
        const matchesFilter = filter === 'all' ||
          (filter === 'outOfStock' && row.quantity === 0) ||
          (filter === 'lowStock' && row.quantity > 0 && row.quantity <= row.minThreshold) ||
          (filter === 'available' && !row.isAllocated) ||
          (filter === 'allocated' && row.isAllocated);
        return matchesSearch && matchesFilter;
      })
      .map(({row}) => row);
    return sortInventory(filtered, inventorySort);
  }, [searchableInventory, search, queryTerms, inventorySort]);

  const visibleInventory = useMemo(() => getVisibleInventory(inventoryFilter), [getVisibleInventory, inventoryFilter]);

  const hasInventoryCriteria = search.trim().length > 0 || inventoryFilter !== 'all';
  const isOffline = usingCachedInventory || networkConnected === false;
  const connectionStatusTitle = isOffline
    ? snapshotStatus.savedAt === null
      ? 'Offline · No stock saved on this device'
      : 'Offline · Showing the last saved stock'
    : snapshotStatus.savedAt === null
      ? 'Checking connection…'
      : `Online · ${formatSnapshotTime(snapshotStatus.savedAt)}`;
  const connectionStatusDetail = isOffline && snapshotStatus.savedAt !== null
    ? 'Changes sync when you’re back online.'
    : '';

  const inventoryFilterCounts = useMemo(() => inventory.reduce((counts, row) => {
    counts.all += 1;
    if (row.quantity === 0) counts.outOfStock += 1;
    else if (row.quantity <= row.minThreshold) counts.lowStock += 1;
    if (row.isAllocated) counts.allocated += 1;
    else counts.available += 1;
    return counts;
  }, {all: 0, outOfStock: 0, lowStock: 0, available: 0, allocated: 0}), [inventory]);

  function clearInventoryCriteria() {
    Keyboard.dismiss();
    setSearch('');
    setInventoryFilter('all');
    setInventorySort('default');
  }

  function openFilterSort() {
    setDraftInventoryFilter(inventoryFilter);
    setDraftInventorySort(inventorySort);
    setFilterSortVisible(true);
  }

  function applyFilterSort() {
    if (draftInventoryFilter !== inventoryFilter) {
      const nextVisibleInventory = getVisibleInventory(draftInventoryFilter);
      announceInventoryResultCount(nextVisibleInventory.length, inventory.length, search, draftInventoryFilter);
    }
    setInventoryFilter(draftInventoryFilter);
    setInventorySort(draftInventorySort);
    setFilterSortVisible(false);
  }

  const activeFilterSortLabels = [
    inventoryFilter !== 'all' ? inventoryFilterOptions.find(option => option.value === inventoryFilter)?.label : undefined,
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
          <View style={styles.topBar}>
            <View style={styles.brandMark}><Image source={require('../../assets/icon.png')} style={styles.brandIcon} /></View>
            <View style={styles.brandCopy}>
              <Text style={styles.wordmark}>Spares Tracker</Text>
              <Text style={styles.pageTitle}>Inventory</Text>
            </View>
          </View>

          <View style={styles.welcomeRow}>
            <View>
              <Text style={styles.welcome}>Good to see you, {user.name.split(' ')[0]}</Text>
              <Text style={styles.muted}>{user.role.replaceAll('_', ' ')} · {isMockMode ? 'preview data' : 'live inventory'}</Text>
            </View>
            <View style={styles.totalBadge}>
              <Text style={styles.totalNumber}>{inventory.length}</Text>
              <Text style={styles.totalLabel}>ITEMS</Text>
            </View>
          </View>

          <View accessibilityRole="summary" style={styles.connectionStatus}>
            <View style={[styles.connectionDot, isOffline ? styles.connectionDotOffline : styles.connectionDotOnline]} />
            <View style={styles.connectionStatusCopy}>
              <Text style={[styles.connectionStatusText, isOffline && styles.connectionStatusTextOffline]}>{connectionStatusTitle}</Text>
              {!!connectionStatusDetail && <Text style={styles.connectionStatusDetail}>{connectionStatusDetail}</Text>}
            </View>
            {(snapshotStatus.queued > 0 || snapshotStatus.conflicts > 0) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Review offline changes"
                onPress={() => router.push('/offline-changes')}
                style={styles.syncPendingButton}
              >
                <Text style={styles.syncPending}>
                  {snapshotStatus.conflicts > 0 ? `${snapshotStatus.conflicts} need review` : `${snapshotStatus.queued} waiting`}
                </Text>
              </Pressable>
            )}
          </View>

          <View style={styles.searchBox}>
            <AppIcon name="search" color={palette.muted} size={20} />
            <TextInput
              accessibilityLabel="Search inventory"
              value={search}
              onChangeText={setSearch}
              placeholder="Search part, store, or work order"
              placeholderTextColor={palette.placeholder}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={() => {
                Keyboard.dismiss();
                announceInventoryResultCount(visibleInventory.length, inventory.length, search, inventoryFilter);
              }}
            />
            {search.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                accessibilityHint="Clears the inventory search"
                onPress={() => setSearch('')}
                style={styles.clearSearchButton}
                hitSlop={4}
              >
                <Text style={styles.clearSearchText}>×</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.controlsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Filter and sort inventory${activeFilterSortLabels.length ? `, active: ${activeFilterSortLabels.join(', ')}` : ''}`}
              onPress={openFilterSort}
              style={[styles.filterSortButton, activeFilterSortLabels.length > 0 && styles.filterSortButtonActive]}
            >
              <AppIcon name="filter" color={palette.navy} size={18} />
              <Text numberOfLines={1} style={styles.filterSortButtonText}>{filterSortButtonLabel}</Text>
            </Pressable>
            {activeFilterSortLabels.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset filters and sorting"
                onPress={() => {setInventoryFilter('all'); setInventorySort('default');}}
                style={styles.resetControlsButton}
              >
                <Text style={styles.resetControlsText}>Reset</Text>
              </Pressable>
            )}
          </View>

          {!!error && <ErrorNotice message={error} onRetry={refresh} />}

          <FlatList
            data={visibleInventory}
            keyExtractor={row => String(row.id)}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.navy} />}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={visibleInventory.length > 0 ? (
              <Text accessibilityRole="text" style={styles.resultsSummary}>
                {hasInventoryCriteria
                  ? `Showing ${visibleInventory.length} of ${inventory.length} ${inventory.length === 1 ? 'item' : 'items'}`
                  : `${inventory.length} ${inventory.length === 1 ? 'item' : 'items'} · ${formatSnapshotTime(snapshotStatus.savedAt)}`}
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
                  accessibilityLabel={inventoryRowAccessibilityLabel(row)}
                  accessibilityHint="Opens stock details"
                  onPress={() => {
                    Keyboard.dismiss();
                    router.push({pathname: '/inventory/[itemId]', params: {itemId: String(row.id), userId: String(user?.id ?? '')}});
                  }}
                  style={({pressed}) => [styles.stockCard, pressed && styles.stockCardPressed]}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.partNumber}>{row.partNumber}</Text>
                    <View style={[styles.quantityBadge, lowStock && styles.lowQuantityBadge, outOfStock && styles.outQuantityBadge]}>
                      <Text style={[styles.quantityValue, lowStock && styles.lowQuantityText, outOfStock && styles.outQuantityText]}>{row.quantity}</Text>
                      <Text style={[styles.quantityCaption, lowStock && styles.lowQuantityText, outOfStock && styles.outQuantityText]}>{outOfStock ? 'OUT OF STOCK' : lowStock ? 'LOW STOCK' : 'IN STOCK'}</Text>
                    </View>
                  </View>
                  <Text style={styles.description}>{row.description}</Text>
                  <View style={styles.statusRow}>
                    <Text style={[styles.locationText, row.isAllocated && styles.allocatedStatus]} numberOfLines={1}>
                      {row.storeName}{row.isAllocated ? ` · Allocated${row.workOrder ? ` · ${row.workOrder}` : ''}` : ''}
                    </Text>
                    <Text style={styles.threshold}>Min. {row.minThreshold}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <AppBottomNavigation
            active="inventory"
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
                  onPress={() => {setDraftInventoryFilter('all'); setDraftInventorySort('default');}}
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
              <Text style={styles.heroWordmark}>Spares Tracker</Text>
            </View>
            <Text style={styles.heroLabel}>INVENTORY MANAGEMENT</Text>
            <Text style={styles.heroTitle}>Everything in its place.</Text>
            <Text style={styles.heroSubtitle}>Keep track of your stock, wherever the work takes you.</Text>
          </View>
          {!!error && <ErrorNotice message={error} onRetry={hasSession ? restoreSession : undefined} />}
          <DesktopPairing mockMode={isMockMode} onPair={pairWithDesktop} onCancel={cancelPairing} />
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
  screen: {flex: 1, paddingHorizontal: 20},
  topBar: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: palette.border},
  brandMark: {width: 42, height: 42, borderRadius: 13, overflow: 'hidden'},
  brandIcon: {width: 42, height: 42},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.navy},
  pageTitle: {fontSize: 13, fontWeight: '600', color: palette.muted},
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
  welcomeRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 10},
  connectionStatus: {minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7},
  connectionDot: {width: 7, height: 7, borderRadius: 4},
  connectionDotOnline: {backgroundColor: '#287441'},
  connectionDotOffline: {backgroundColor: '#A16207'},
  connectionStatusCopy: {flex: 1},
  connectionStatusText: {fontSize: 11, lineHeight: 15, color: palette.muted},
  connectionStatusTextOffline: {fontWeight: '700', color: '#8A5A00'},
  connectionStatusDetail: {fontSize: 10, lineHeight: 14, color: palette.muted},
  syncPending: {fontSize: 10, fontWeight: '700', color: palette.navy, textAlign: 'right'},
  syncPendingButton: {minHeight: 32, justifyContent: 'center', paddingLeft: 6},
  welcome: {fontSize: 15, fontWeight: '700', color: palette.text},
  muted: {marginTop: 3, color: palette.muted, fontSize: 11},
  totalBadge: {minWidth: 62, alignItems: 'center', borderRadius: 10, backgroundColor: '#FEF3DF', paddingVertical: 5, paddingHorizontal: 8},
  totalNumber: {fontSize: 17, fontWeight: '800', color: palette.navy},
  totalLabel: {fontSize: 8, fontWeight: '800', letterSpacing: 0.9, color: palette.navy},
  searchBox: {height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, backgroundColor: palette.white, borderRadius: 13, borderWidth: 1, borderColor: palette.border},
  searchInput: {flex: 1, paddingVertical: 10, fontSize: 14, color: palette.text},
  clearSearchButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  clearSearchText: {fontSize: 25, lineHeight: 29, color: palette.muted},
  controlsRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8},
  filterSortButton: {flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: palette.border, borderRadius: 11, backgroundColor: palette.white},
  filterSortButtonActive: {borderColor: palette.amber, backgroundColor: '#FFF8EA'},
  filterSortButtonText: {flex: 1, fontSize: 13, fontWeight: '700', color: palette.navy},
  resetControlsButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 8},
  resetControlsText: {fontSize: 12, fontWeight: '700', color: palette.muted},
  filterSortBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21, 38, 59, 0.38)'},
  filterSortSheet: {maxHeight: '90%', paddingHorizontal: 20, paddingTop: 9, paddingBottom: 24, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: palette.white},
  sheetHandle: {alignSelf: 'center', width: 42, height: 4, marginBottom: 8, borderRadius: 2, backgroundColor: palette.border},
  filterSortHeader: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  filterSortTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  sheetCloseButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  filterSortOptions: {flexGrow: 0, flexShrink: 1, maxHeight: 480},
  filterSortSectionTitle: {marginTop: 9, marginBottom: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.3, color: palette.muted},
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
  listContent: {paddingTop: 8, paddingBottom: 10},
  resultsSummary: {paddingHorizontal: 2, paddingBottom: 2, fontSize: 12, fontWeight: '600', color: palette.muted},
  stockCard: {backgroundColor: 'transparent', borderBottomColor: '#E2E8F0', borderBottomWidth: 1, paddingHorizontal: 4, paddingVertical: 12},
  stockCardPressed: {opacity: 0.72},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10},
  partNumber: {flex: 1, marginTop: 2, fontSize: 15, fontWeight: '800', letterSpacing: 0.2, color: palette.navy},
  description: {marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '500', color: palette.text},
  quantityBadge: {minWidth: 67, alignItems: 'flex-end', paddingVertical: 2, paddingHorizontal: 2},
  quantityValue: {fontSize: 17, fontWeight: '800', color: '#287441'},
  quantityCaption: {fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: '#287441'},
  lowQuantityBadge: {backgroundColor: 'transparent'},
  lowQuantityText: {color: '#A54E1E'},
  outQuantityBadge: {backgroundColor: 'transparent'},
  outQuantityText: {color: palette.red},
  statusRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8},
  locationText: {flex: 1, fontSize: 12, fontWeight: '700', color: palette.muted},
  allocatedStatus: {color: palette.slate},
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
  heroMark: {width: 48, height: 48, borderRadius: 14, overflow: 'hidden'},
  heroBrandIcon: {width: 48, height: 48},
  heroWordmark: {fontSize: 23, fontWeight: '800', color: palette.white},
  heroLabel: {marginTop: 16, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: palette.amber},
  heroTitle: {marginTop: 9, fontSize: 30, lineHeight: 36, fontWeight: '800', color: palette.white},
  heroSubtitle: {marginTop: 8, fontSize: 15, lineHeight: 23, color: '#C1D0DF'},
  onboardingFootnote: {marginTop: 14, marginHorizontal: 14, textAlign: 'center', fontSize: 11, lineHeight: 17, color: palette.muted},
  errorNotice: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: palette.redTint},
  errorText: {flex: 1, fontSize: 12, lineHeight: 18, color: palette.red},
  retryText: {fontWeight: '800', color: palette.red},
  loadingScreen: {alignItems: 'center', justifyContent: 'center', gap: 12},
});
