import {useCallback, useMemo, useState} from 'react';
import {Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useRouter} from 'expo-router';
import {useNetworkState} from 'expo-network';
import type {InventoryItem} from '../features/inventory/inventoryRepository';
import {applyQueuedStockCounts} from '../features/inventory/offlineStockQueue';
import {getInventorySnapshot, setInventorySnapshot} from '../features/inventory/inventorySnapshot';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {getConnectivityStatus} from '../features/network/connectivity';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {AppIcon} from '../features/navigation/AppIcon';

const palette = {
  navy: '#15263B', amber: '#E9A23B', slate: '#64748B', muted: '#475569',
  background: '#F5F7FA', white: '#FFFFFF', border: '#CBD5E1',
  warning: '#8A5A0A', warningBackground: '#FFF4DB',
  error: '#A13A32', errorBackground: '#FCE8E6',
};

type OverviewData = {
  inventory: InventoryItem[] | null;
  savedAt: number | null;
  queued: number;
  conflicts: number;
};

const emptyOverview: OverviewData = {inventory: null, savedAt: null, queued: 0, conflicts: 0};

export default function HomeScreen() {
  const router = useRouter();
  const network = useNetworkState();
  const [overview, setOverview] = useState<OverviewData>(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const pendingCount = overview.queued + overview.conflicts;
  const connectivity = getConnectivityStatus(network.isConnected, network.isInternetReachable);
  const offline = connectivity === 'offline';

  useFocusEffect(useCallback(() => {
    let active = true;
    const refreshPendingCounts = async () => {
      try {
        const userId = await offlineStockStore.getActiveUserId();
        if (userId === null) {
          if (active) setOverview(emptyOverview);
          return;
        }
        const queue = await offlineStockStore.list(userId);
        if (active) {
          setOverview(current => ({
            ...current,
            queued: queue.filter(change => change.status === 'queued').length,
            conflicts: queue.filter(change => change.status === 'conflict').length,
          }));
        }
      } catch {
        // Keep the last displayed queue status if the local store is temporarily unavailable.
      }
    };
    const loadOverview = async () => {
      setLoading(true);
      try {
        const userId = await offlineStockStore.getActiveUserId();
        if (userId === null) {
          if (active) setOverview(emptyOverview);
          return;
        }
        const [savedInventory, queue, savedAt] = await Promise.all([
          offlineStockStore.loadInventorySnapshot(userId),
          offlineStockStore.list(userId),
          offlineStockStore.getInventorySnapshotSavedAt(userId),
        ]);
        const baseInventory = getInventorySnapshot() ?? savedInventory;
        const inventory = baseInventory === null ? null : applyQueuedStockCounts(baseInventory, queue);
        if (active) {
          if (inventory !== null) setInventorySnapshot(inventory);
          setOverview({
            inventory,
            savedAt,
            queued: queue.filter(change => change.status === 'queued').length,
            conflicts: queue.filter(change => change.status === 'conflict').length,
          });
        }
      } catch {
        if (active) setOverview(emptyOverview);
      } finally {
        if (active) setLoading(false);
      }
    };
    const unsubscribe = offlineStockStore.subscribeQueueChanges(() => { void refreshPendingCounts(); });
    void loadOverview();
    return () => { active = false; unsubscribe(); };
  }, []));

  const inventory = overview.inventory;
  const {outOfStockCount, lowStockCount, attentionItems} = useMemo(() => {
    const alerts: InventoryItem[] = [];
    let outOfStock = 0;
    let lowStock = 0;
    for (const item of inventory ?? []) {
      if (item.quantity === 0) {
        outOfStock += 1;
        alerts.push(item);
      } else if (item.quantity <= item.minThreshold) {
        lowStock += 1;
        alerts.push(item);
      }
    }
    alerts.sort((left, right) => {
      if (left.quantity === 0) return right.quantity === 0 ? 0 : -1;
      if (right.quantity === 0) return 1;
      return left.quantity / left.minThreshold - right.quantity / right.minThreshold;
    });
    return {outOfStockCount: outOfStock, lowStockCount: lowStock, attentionItems: alerts};
  }, [inventory]);

  function openInventory(filter: 'needsAttention' | 'outOfStock' | 'lowStock' | 'all') {
    router.push({pathname: '/', params: {filter: filter === 'all' ? undefined : filter, query: undefined}});
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Image source={require('../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
          <View style={styles.brandCopy}>
            <Text style={styles.wordmark}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.pageTitle}>Stock overview</Text>
          </View>
          <View style={[styles.connectionPill, offline && styles.connectionPillOffline]}>
            <View style={[styles.connectionDot, offline && styles.connectionDotOffline,
              connectivity === 'checking' && styles.connectionDotChecking]} />
            <Text style={[styles.connectionText, offline && styles.connectionTextOffline,
              connectivity === 'checking' && styles.connectionTextChecking]}>
              {connectivity === 'checking' ? 'Checking' : offline ? 'Offline' : 'Online'}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headingBlock}>
            <Text style={styles.heading}>Good to see you</Text>
            <Text style={styles.subheading}>Here’s what needs attention today.</Text>
          </View>

          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <AppIcon name="search" color={palette.slate} size={19} />
              <TextInput
                accessibilityLabel="Search inventory from home"
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => {
                  Keyboard.dismiss();
                  router.push({pathname: '/', params: {query: search.trim() || undefined}});
                }}
                placeholder="Part, store, or work order"
                placeholderTextColor={palette.slate}
                accessibilityHint="Searches part numbers, descriptions, store locations, and work-order numbers."
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {search.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear home search"
                  accessibilityHint="Clears the search text"
                  onPress={() => setSearch('')}
                  style={styles.clearSearchButton}
                >
                  <AppIcon name="close" color={palette.slate} size={17} />
                </Pressable>
              )}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Scan stock" onPress={() => router.push('/scan')} style={styles.scanButton}>
              <AppIcon name="scan" color={palette.white} size={21} />
            </Pressable>
          </View>

          {offline && (
            <View accessibilityRole="summary" style={styles.offlineBanner}>
              <View style={styles.offlineDot} />
              <View style={styles.bannerCopy}>
                <Text style={styles.offlineTitle}>Offline</Text>
                <Text style={styles.offlineText}>
                  {inventory === null
                    ? 'No stock is saved on this device yet.'
                    : 'Showing the latest stock saved on this device. Changes will sync when you’re connected.'}
                </Text>
              </View>
            </View>
          )}

          {pendingCount > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Review ${pendingCount} offline changes`}
              onPress={() => router.push('/offline-changes')}
              style={styles.pendingBanner}
            >
              <View style={[styles.pendingDot, overview.conflicts > 0 && styles.pendingDotConflict]} />
              <View style={styles.bannerCopy}>
                <Text style={styles.pendingTitle}>{formatPendingSummary(overview.queued, overview.conflicts)}</Text>
                <Text style={styles.pendingText}>Review offline changes</Text>
              </View>
              <AppIcon name="chevronRight" color={palette.slate} size={18} />
            </Pressable>
          )}

          {loading && inventory === null ? (
            <View accessibilityLabel="Loading stock overview" style={styles.cardsRow}>
              <OverviewSkeleton />
              <OverviewSkeleton />
              <OverviewSkeleton />
            </View>
          ) : inventory === null ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Stock overview isn’t ready yet</Text>
              <Text style={styles.emptyText}>Open Inventory to connect your account and load the latest stock.</Text>
              <Pressable accessibilityRole="button" onPress={() => openInventory('all')} style={styles.openInventoryButton}>
                <Text style={styles.openInventoryText}>Open inventory</Text>
              </Pressable>
            </View>
          ) : inventory.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No stock items found</Text>
              <Text style={styles.emptyText}>Refresh Inventory to check for updates.</Text>
              <Pressable accessibilityRole="button" onPress={() => openInventory('all')} style={styles.openInventoryButton}>
                <Text style={styles.openInventoryText}>Open inventory</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.cardsRow}>
                <StatusCard label="Stock records" count={inventory.length} tone="neutral" onPress={() => openInventory('all')} />
                <StatusCard label="Low stock" count={lowStockCount} tone="warning" onPress={() => openInventory('lowStock')} />
                <StatusCard label="Out of stock" count={outOfStockCount} tone="error" onPress={() => openInventory('outOfStock')} />
              </View>
              <View style={styles.sectionHeading}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Needs attention</Text>
                <Pressable accessibilityRole="button"
                  accessibilityLabel={attentionItems.length > 0 ? 'View all stock alerts' : 'View inventory'}
                  onPress={() => openInventory(attentionItems.length > 0 ? 'needsAttention' : 'all')}>
                  <Text style={styles.viewAll}>{attentionItems.length > 0 ? 'View all alerts' : 'View inventory'}</Text>
                </Pressable>
              </View>
              {attentionItems.length === 0 ? (
                <View style={styles.allClearCard}>
                  <View style={styles.allClearDot} />
                  <Text style={styles.allClearText}>All stock is above its minimum level.</Text>
                </View>
              ) : attentionItems.slice(0, 3).map(item => (
                  <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={alertAccessibilityLabel(item)}
                    accessibilityHint="Opens stock details"
                    onPress={() => router.push({pathname: '/inventory/[itemId]', params: {itemId: String(item.id)}})} style={styles.attentionCard}>
                    <View style={[styles.attentionMark, item.quantity === 0 && styles.attentionMarkOut]}>
                      <AppIcon name="inventory" color={item.quantity === 0 ? palette.error : palette.warning} size={18} />
                    </View>
                    <View style={styles.attentionCopy}>
                      <Text style={styles.attentionPart} numberOfLines={1}>{item.partNumber}</Text>
                      <Text style={styles.attentionDetail} numberOfLines={1}>{item.quantity === 0 ? 'Out of stock' : 'Low stock'} · {item.storeName}</Text>
                    </View>
                    <View style={styles.attentionAction}>
                      <Text style={styles.attentionQuantity}>{item.quantity}</Text>
                      <Text style={styles.attentionActionText}>Review</Text>
                    </View>
                  </Pressable>
                ))}
              <View style={styles.quickWorkCard}>
                <Text style={styles.sectionTitle}>Quick work</Text>
                <View style={styles.quickWorkRow}>
                  <Pressable accessibilityRole="button" onPress={() => router.push('/scan')} style={styles.quickScanButton}>
                    <AppIcon name="scan" color={palette.white} size={19} /><Text style={styles.quickScanText}>Scan stock</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => openInventory('all')} style={styles.quickCountButton}>
                    <AppIcon name="inventory" color={palette.navy} size={18} /><Text style={styles.quickCountText}>Manual count</Text>
                  </Pressable>
                </View>
              </View>
            </>
          )}

          {inventory !== null && (
            <Text style={styles.updatedAt}>{formatSnapshotTime(overview.savedAt)}</Text>
          )}
        </ScrollView>
      </View>
      <AppBottomNavigation active="home" queuedCount={overview.queued} conflictCount={overview.conflicts} />
    </SafeAreaView>
  );
}

function StatusCard({label, count, tone, onPress}: {
  label: string;
  count: number;
  tone: 'neutral' | 'warning' | 'error';
  onPress: () => void;
}) {
  const color = tone === 'error' ? palette.error : tone === 'warning' ? palette.warning : palette.navy;
  const background = tone === 'error' ? palette.errorBackground : tone === 'warning' ? palette.warningBackground : '#E8EDF2';
  const countDescription = tone === 'neutral' ? `${count} stock records` : `${count} ${label.toLowerCase()} records`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${countDescription}. Open filtered inventory.`}
      accessibilityHint="Opens Inventory with this stock status selected"
      onPress={onPress}
      style={({pressed}) => [styles.statusCard, pressed && styles.statusCardPressed]}
    >
      <View style={styles.statusHeader}>
        <View style={[styles.statusDot, {backgroundColor: color}]} />
        <Text numberOfLines={2} style={styles.statusLabel}>{label}</Text>
      </View>
      <Text style={[styles.statusCount, {color}]}>{count}</Text>
      <Text style={styles.statusDetail}>{tone === 'neutral' ? 'In this inventory' : tone === 'warning' ? 'At or below minimum' : 'No units available'}</Text>
      <View style={[styles.cardAccent, {backgroundColor: background}]} />
    </Pressable>
  );
}

function OverviewSkeleton() {
  return (
    <View accessible={false} style={styles.skeletonCard}>
      <View style={styles.skeletonLabel} />
      <View style={styles.skeletonNumber} />
      <View style={styles.skeletonDetail} />
    </View>
  );
}

function formatSnapshotTime(savedAt: number | null): string {
  if (savedAt === null) return 'Stock refresh time unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - savedAt) / 60_000));
  if (minutes < 1) return 'Stock refreshed just now';
  if (minutes < 60) return `Stock refreshed ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Stock refreshed ${hours} hr${hours === 1 ? '' : 's'} ago`;
  return `Stock refreshed ${new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(savedAt))}`;
}

function formatPendingSummary(queued: number, conflicts: number): string {
  return [
    queued > 0 ? `${queued} waiting to sync` : '',
    conflicts > 0 ? `${conflicts} to review` : '',
  ].filter(Boolean).join(' · ');
}

function alertAccessibilityLabel(item: InventoryItem): string {
  const status = item.quantity === 0 ? 'out of stock' : 'low stock';
  const units = item.quantity === 1 ? 'unit' : 'units';
  return `Review ${item.partNumber}, ${item.description}. ${item.quantity} ${units}, ${status}, at ${item.storeName}.`;
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 16},
  topBar: {minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: -16, paddingHorizontal: 16, backgroundColor: palette.navy},
  brandIcon: {width: 38, height: 38, borderRadius: 11},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.white},
  pageTitle: {fontSize: 12, fontWeight: '600', color: '#D5DEE8'},
  connectionPill: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: '#26394E'},
  connectionPillOffline: {backgroundColor: '#3B3528'},
  connectionDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#52B788'},
  connectionDotOffline: {backgroundColor: palette.amber},
  connectionDotChecking: {backgroundColor: '#CBD5E1'},
  connectionText: {fontSize: 11, fontWeight: '700', color: palette.white},
  connectionTextOffline: {color: '#FFE4A3'},
  connectionTextChecking: {color: '#D5DEE8'},
  content: {flexGrow: 1, paddingTop: 17, paddingBottom: 18},
  headingBlock: {marginBottom: 14},
  heading: {fontSize: 23, lineHeight: 29, fontWeight: '800', color: palette.navy},
  subheading: {marginTop: 4, fontSize: 14, lineHeight: 20, color: palette.muted},
  searchRow: {flexDirection: 'row', gap: 9, marginBottom: 14},
  searchBox: {flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  searchInput: {flex: 1, paddingVertical: 8, fontSize: 14, color: palette.navy},
  clearSearchButton: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10},
  scanButton: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.navy},
  offlineBanner: {flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12, padding: 13, borderRadius: 12, backgroundColor: palette.warningBackground},
  offlineDot: {width: 9, height: 9, marginTop: 4, borderRadius: 5, backgroundColor: palette.amber},
  bannerCopy: {flex: 1},
  offlineTitle: {fontSize: 13, fontWeight: '800', color: palette.warning},
  offlineText: {marginTop: 3, fontSize: 12, lineHeight: 17, color: palette.muted},
  pendingBanner: {minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  pendingDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: palette.amber},
  pendingDotConflict: {backgroundColor: palette.error},
  pendingTitle: {fontSize: 13, fontWeight: '700', color: palette.navy},
  pendingText: {marginTop: 2, fontSize: 12, color: palette.muted},
  cardsRow: {flexDirection: 'row', gap: 8},
  statusCard: {flex: 1, minHeight: 110, overflow: 'hidden', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 9, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  statusCardPressed: {opacity: 0.76},
  statusHeader: {minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 7},
  statusDot: {width: 8, height: 8, borderRadius: 4},
  statusLabel: {flex: 1, fontSize: 11, lineHeight: 14, fontWeight: '700', color: palette.navy},
  statusCount: {marginTop: 3, fontSize: 28, lineHeight: 34, fontWeight: '800'},
  statusDetail: {marginTop: 1, fontSize: 9, lineHeight: 13, color: palette.muted},
  cardAccent: {position: 'absolute', left: 0, top: 0, bottom: 0, width: 4},
  sectionHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8},
  sectionTitle: {fontSize: 15, fontWeight: '800', color: palette.navy},
  viewAll: {fontSize: 12, fontWeight: '700', color: palette.slate},
  allClearCard: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#D6E8DC', backgroundColor: '#F1F8F3'},
  allClearDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#287441'},
  allClearText: {fontSize: 12, fontWeight: '600', color: '#21653A'},
  attentionCard: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, paddingHorizontal: 11, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  attentionMark: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.warningBackground},
  attentionMarkOut: {backgroundColor: palette.errorBackground},
  attentionCopy: {flex: 1},
  attentionPart: {fontSize: 12, fontWeight: '800', color: palette.navy},
  attentionDetail: {marginTop: 3, fontSize: 10, color: palette.muted},
  attentionAction: {alignItems: 'flex-end', minWidth: 48},
  attentionQuantity: {fontSize: 16, fontWeight: '800', color: palette.navy},
  attentionActionText: {fontSize: 9, fontWeight: '700', color: palette.slate},
  quickWorkCard: {marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  quickWorkRow: {flexDirection: 'row', gap: 8, marginTop: 9},
  quickScanButton: {flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11, backgroundColor: palette.navy},
  quickScanText: {fontSize: 12, fontWeight: '800', color: palette.white},
  quickCountButton: {flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  quickCountText: {fontSize: 12, fontWeight: '700', color: palette.navy},
  updatedAt: {marginTop: 15, fontSize: 12, textAlign: 'center', color: palette.slate},
  emptyCard: {alignItems: 'center', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  emptyTitle: {fontSize: 16, fontWeight: '800', textAlign: 'center', color: palette.navy},
  emptyText: {marginTop: 7, fontSize: 13, lineHeight: 19, textAlign: 'center', color: palette.muted},
  openInventoryButton: {minHeight: 46, justifyContent: 'center', alignItems: 'center', marginTop: 16, paddingHorizontal: 18, borderRadius: 10, backgroundColor: palette.navy},
  openInventoryText: {fontSize: 13, fontWeight: '700', color: palette.white},
  skeletonCard: {flex: 1, minHeight: 148, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  skeletonLabel: {width: '76%', height: 13, marginTop: 4, borderRadius: 6, backgroundColor: '#E8EDF2'},
  skeletonNumber: {width: 56, height: 35, marginTop: 16, borderRadius: 7, backgroundColor: '#E8EDF2'},
  skeletonDetail: {width: '88%', height: 11, marginTop: 10, borderRadius: 6, backgroundColor: '#E8EDF2'},
});
