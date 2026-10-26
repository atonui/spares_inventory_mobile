import {useCallback, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useRouter} from 'expo-router';
import {useNetworkState} from 'expo-network';
import type {InventoryItem} from '../features/inventory/inventoryRepository';
import {applyQueuedStockCounts} from '../features/inventory/offlineStockQueue';
import {setInventorySnapshot} from '../features/inventory/inventorySnapshot';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
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
  const offline = network.isConnected === false || network.isInternetReachable === false;

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
        const baseInventory = savedInventory;
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
  const outOfStockCount = inventory?.filter(item => item.quantity === 0).length ?? 0;
  const lowStockCount = inventory?.filter(item => item.quantity > 0 && item.quantity <= item.minThreshold).length ?? 0;

  function openInventory(filter: 'outOfStock' | 'lowStock' | 'all') {
    router.push({pathname: '/', params: {filter: filter === 'all' ? undefined : filter, query: undefined}});
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Image source={require('../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
          <View style={styles.brandCopy}>
            <Text style={styles.wordmark}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.pageTitle}>Home</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headingBlock}>
            <Text style={styles.heading}>Stock at a glance</Text>
            <Text style={styles.subheading}>Start with the items that need attention.</Text>
          </View>

          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <AppIcon name="search" color={palette.slate} size={19} />
              <TextInput
                accessibilityLabel="Search inventory from home"
                value={search}
                onChangeText={setSearch}
                onSubmitEditing={() => router.push({pathname: '/', params: {query: search.trim() || undefined}})}
                placeholder="Search part or description"
                placeholderTextColor={palette.slate}
                returnKeyType="search"
                style={styles.searchInput}
              />
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
                <StatusCard
                  label="Out of stock"
                  detail="No units available"
                  count={outOfStockCount}
                  tone="error"
                  onPress={() => openInventory('outOfStock')}
                />
                <StatusCard
                  label="Low stock"
                  detail="At or below minimum"
                  count={lowStockCount}
                  tone="warning"
                  onPress={() => openInventory('lowStock')}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View all ${inventory.length} inventory items`}
                onPress={() => openInventory('all')}
                style={styles.allStockLink}
              >
                <View style={styles.allStockCopy}>
                  <Text style={styles.allStockLabel}>All stock</Text>
                  <Text style={styles.allStockCount}>{inventory.length} items</Text>
                </View>
                <Text style={styles.allStockHint}>Browse inventory</Text>
                <AppIcon name="chevronRight" color={palette.slate} size={17} />
              </Pressable>
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

function StatusCard({label, detail, count, tone, onPress}: {
  label: string;
  detail: string;
  count: number;
  tone: 'warning' | 'error';
  onPress: () => void;
}) {
  const color = tone === 'error' ? palette.error : palette.warning;
  const background = tone === 'error' ? palette.errorBackground : palette.warningBackground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} ${label.toLowerCase()} items. ${detail}. Open filtered inventory.`}
      accessibilityHint="Opens Inventory with this stock status selected"
      onPress={onPress}
      style={({pressed}) => [styles.statusCard, pressed && styles.statusCardPressed]}
    >
      <View style={styles.statusHeader}>
        <View style={[styles.statusDot, {backgroundColor: color}]} />
        <Text numberOfLines={2} style={styles.statusLabel}>{label}</Text>
      </View>
      <Text style={[styles.statusCount, {color}]}>{count}</Text>
      <Text style={styles.statusDetail}>{detail}</Text>
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

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 16},
  topBar: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: palette.border},
  brandIcon: {width: 40, height: 40, borderRadius: 12},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.navy},
  pageTitle: {fontSize: 13, fontWeight: '600', color: palette.muted},
  content: {flexGrow: 1, paddingTop: 18, paddingBottom: 18},
  headingBlock: {marginBottom: 19},
  heading: {fontSize: 23, lineHeight: 29, fontWeight: '800', color: palette.navy},
  subheading: {marginTop: 4, fontSize: 14, lineHeight: 20, color: palette.muted},
  searchRow: {flexDirection: 'row', gap: 9, marginBottom: 14},
  searchBox: {flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  searchInput: {flex: 1, paddingVertical: 8, fontSize: 14, color: palette.navy},
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
  cardsRow: {flexDirection: 'row', gap: 11},
  statusCard: {flex: 1, minHeight: 132, overflow: 'hidden', paddingHorizontal: 13, paddingTop: 12, paddingBottom: 12, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  statusCardPressed: {opacity: 0.76},
  statusHeader: {minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7},
  statusDot: {width: 8, height: 8, borderRadius: 4},
  statusLabel: {flex: 1, fontSize: 13, lineHeight: 17, fontWeight: '700', color: palette.navy},
  statusCount: {marginTop: 5, fontSize: 34, lineHeight: 40, fontWeight: '800'},
  statusDetail: {marginTop: 1, fontSize: 11, lineHeight: 16, color: palette.muted},
  cardAccent: {position: 'absolute', left: 0, top: 0, bottom: 0, width: 4},
  allStockLink: {minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  allStockCopy: {flex: 1},
  allStockLabel: {fontSize: 14, fontWeight: '700', color: palette.navy},
  allStockCount: {marginTop: 2, fontSize: 12, color: palette.muted},
  allStockHint: {fontSize: 11, fontWeight: '600', color: palette.slate},
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
