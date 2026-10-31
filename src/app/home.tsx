import {useCallback, useState} from 'react';
import {Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useRouter} from 'expo-router';
import {useNetworkState} from 'expo-network';
import {api, isMockMode} from '../api/runtime';
import {ApiError} from '../api/client';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {getConnectivityStatus} from '../features/network/connectivity';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {AppIcon} from '../features/navigation/AppIcon';

const palette = {
  navy: '#15263B', amber: '#E9A23B', slate: '#64748B', muted: '#475569',
  background: '#F5F7FA', white: '#FFFFFF', border: '#D6DEE8',
  warning: '#8A5A0A', warningBackground: '#FFF4DB', error: '#A13A32', errorBackground: '#FCE8E6',
};

type DashboardStats = {totalParts: number; activeStores: number; myEquipment: number; myParts: number};
type QueueStatus = {queued: number; conflicts: number; hasSnapshot: boolean};
type MetricKey = keyof DashboardStats;
const emptyQueue: QueueStatus = {queued: 0, conflicts: 0, hasSnapshot: false};

const metrics: {key: MetricKey; label: string; route: '/parts' | '/stores' | '/equipment' | '/my-parts'; icon: 'inventory' | 'store' | 'equipment' | 'profile'}[] = [
  {key: 'totalParts', label: 'Total parts', route: '/parts', icon: 'inventory'},
  {key: 'activeStores', label: 'Active stores', route: '/stores', icon: 'store'},
  {key: 'myEquipment', label: 'My equipment', route: '/equipment', icon: 'equipment'},
  {key: 'myParts', label: 'My parts', route: '/my-parts', icon: 'profile'},
];

export default function HomeScreen() {
  const router = useRouter();
  const network = useNetworkState();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState(emptyQueue);
  const connectivity = getConnectivityStatus(network.isConnected, network.isInternetReachable);
  const offline = connectivity === 'offline';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStats(await api.getOverviewStats());
    } catch (reason) {
      setError(reason instanceof ApiError || (isMockMode && reason instanceof Error)
        ? reason.message : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    const loadQueue = async () => {
      try {
        const userId = await offlineStockStore.getActiveUserId();
        if (userId === null) {
          if (active) setQueue(emptyQueue);
          return;
        }
        const [entries, savedInventory] = await Promise.all([
          offlineStockStore.list(userId), offlineStockStore.loadInventorySnapshot(userId),
        ]);
        if (active) setQueue({
          queued: entries.filter(entry => entry.status === 'queued').length,
          conflicts: entries.filter(entry => entry.status === 'conflict').length,
          hasSnapshot: savedInventory !== null,
        });
      } catch {
        // Keep the last displayed offline queue status if local storage is unavailable.
      }
    };
    void refresh();
    void loadQueue();
    const unsubscribe = offlineStockStore.subscribeQueueChanges(() => { void loadQueue(); });
    return () => { active = false; unsubscribe(); };
  }, [refresh]));

  const pendingCount = queue.queued + queue.conflicts;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Image source={require('../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
          <View style={styles.brandCopy}>
            <Text style={styles.wordmark}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.pageTitle}>Overview</Text>
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

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headingBlock}>
            <Text style={styles.heading}>Your workspace</Text>
            <Text style={styles.subheading}>A quick look at your parts, stores, and equipment.</Text>
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
                placeholder="Search parts, stores, or work orders"
                placeholderTextColor={palette.slate}
                accessibilityHint="Searches part numbers, descriptions, store locations, and work-order numbers."
                autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.searchInput}
              />
              {search.length > 0 && (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear home search" onPress={() => setSearch('')} style={styles.clearSearchButton}>
                  <AppIcon name="close" color={palette.slate} size={17} />
                </Pressable>
              )}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Scan stock" onPress={() => router.push('/scan')} style={styles.scanButton}>
              <AppIcon name="scan" color={palette.navy} size={21} />
            </Pressable>
          </View>

          {offline && (
            <View accessibilityRole="summary" style={styles.offlineBanner}>
              <View style={styles.offlineDot} />
              <View style={styles.bannerCopy}>
                <Text style={styles.offlineTitle}>Offline</Text>
                <Text style={styles.offlineText}>{queue.hasSnapshot
                  ? 'Your saved inventory is available. Overview totals update when you reconnect.'
                  : 'Overview totals need a connection. Changes will sync when you’re back online.'}</Text>
              </View>
            </View>
          )}

          {pendingCount > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Review ${pendingCount} offline changes`}
              onPress={() => router.push('/offline-changes')} style={styles.pendingBanner}>
              <View style={[styles.pendingDot, queue.conflicts > 0 && styles.pendingDotConflict]} />
              <View style={styles.bannerCopy}>
                <Text style={styles.pendingTitle}>{formatPendingSummary(queue.queued, queue.conflicts)}</Text>
                <Text style={styles.pendingText}>Review offline changes</Text>
              </View>
              <AppIcon name="chevronRight" color={palette.slate} size={18} />
            </Pressable>
          )}

          <View accessibilityLabel="Inventory overview" style={styles.metricsGrid}>
            {metrics.map(metric => (
              <MetricCard key={metric.key} label={metric.label} icon={metric.icon}
                value={stats?.[metric.key] ?? null} loading={loading && stats === null}
                onPress={() => router.push(metric.route)} />
            ))}
          </View>

          {!!error && (
            <View accessibilityRole="alert" style={styles.errorNotice}>
              <AppIcon name="warning" color={palette.error} size={18} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Retry overview totals" onPress={() => {void refresh();}} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.sectionHeading}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Quick actions</Text>
          </View>
          <View style={styles.quickActions}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/scan')} style={({pressed}) => [styles.quickAction, pressed && styles.pressed]}>
              <View style={styles.quickIcon}><AppIcon name="scan" color={palette.navy} size={19} /></View>
              <View style={styles.quickCopy}><Text style={styles.quickTitle}>Scan item</Text><Text style={styles.quickSubtitle}>Find a part by barcode</Text></View>
              <AppIcon name="chevronRight" color={palette.slate} size={17} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push({pathname: '/', params: {filter: undefined, query: undefined, storeId: undefined, view: undefined}})} style={({pressed}) => [styles.quickAction, pressed && styles.pressed]}>
              <View style={styles.quickIcon}><AppIcon name="inventory" color={palette.navy} size={19} /></View>
              <View style={styles.quickCopy}><Text style={styles.quickTitle}>Browse inventory</Text><Text style={styles.quickSubtitle}>Search stock across stores</Text></View>
              <AppIcon name="chevronRight" color={palette.slate} size={17} />
            </Pressable>
          </View>
        </ScrollView>
      </View>
      <AppBottomNavigation active="home" queuedCount={queue.queued} conflictCount={queue.conflicts} />
    </SafeAreaView>
  );
}

function MetricCard({label, value, loading, icon, onPress}: {
  label: string; value: number | null; loading: boolean; icon: 'inventory' | 'store' | 'equipment' | 'profile'; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value === null ? `${label}. Open records.` : `${value} ${label.toLocaleLowerCase()}. Open records.`}
      accessibilityHint={`Opens ${label.toLocaleLowerCase()} records`} onPress={onPress}
      style={({pressed}) => [styles.metricCard, pressed && styles.pressed]}>
      <View style={styles.metricIcon}><AppIcon name={icon} color={palette.navy} size={17} /></View>
      {loading ? <View accessibilityLabel={`Loading ${label.toLocaleLowerCase()}`} style={styles.metricSkeleton} />
        : <Text style={styles.metricCount}>{value ?? '—'}</Text>}
      <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricArrow}><AppIcon name="chevronRight" color={palette.slate} size={15} /></View>
    </Pressable>
  );
}

function formatPendingSummary(queued: number, conflicts: number): string {
  return [queued > 0 ? `${queued} waiting to sync` : '', conflicts > 0 ? `${conflicts} to review` : ''].filter(Boolean).join(' · ');
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 16},
  topBar: {minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: -16, paddingHorizontal: 16, backgroundColor: palette.navy},
  brandIcon: {width: 38, height: 38, borderRadius: 11}, brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.white}, pageTitle: {fontSize: 12, fontWeight: '600', color: '#D5DEE8'},
  connectionPill: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: '#26394E'},
  connectionPillOffline: {backgroundColor: '#3B3528'}, connectionDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#52B788'},
  connectionDotOffline: {backgroundColor: palette.amber}, connectionDotChecking: {backgroundColor: '#CBD5E1'},
  connectionText: {fontSize: 11, fontWeight: '700', color: palette.white}, connectionTextOffline: {color: '#FFE4A3'}, connectionTextChecking: {color: '#D5DEE8'},
  content: {flexGrow: 1, paddingTop: 20, paddingBottom: 18},
  headingBlock: {marginBottom: 15}, heading: {fontSize: 23, lineHeight: 29, fontWeight: '800', color: palette.navy},
  subheading: {marginTop: 4, fontSize: 14, lineHeight: 20, color: palette.muted},
  searchRow: {flexDirection: 'row', gap: 9, marginBottom: 16},
  searchBox: {flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  searchInput: {flex: 1, paddingVertical: 8, fontSize: 14, color: palette.navy},
  clearSearchButton: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10},
  scanButton: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: palette.amber},
  offlineBanner: {flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12, padding: 13, borderRadius: 12, backgroundColor: palette.warningBackground},
  offlineDot: {width: 9, height: 9, marginTop: 4, borderRadius: 5, backgroundColor: palette.amber}, bannerCopy: {flex: 1},
  offlineTitle: {fontSize: 13, fontWeight: '800', color: palette.warning}, offlineText: {marginTop: 3, fontSize: 12, lineHeight: 17, color: palette.muted},
  pendingBanner: {minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  pendingDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: palette.amber}, pendingDotConflict: {backgroundColor: palette.error},
  pendingTitle: {fontSize: 13, fontWeight: '700', color: palette.navy}, pendingText: {marginTop: 2, fontSize: 12, color: palette.muted},
  metricsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  metricCard: {width: '48%', minHeight: 128, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  metricIcon: {position: 'absolute', top: 11, left: 12, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F0F3F7'},
  metricCount: {fontSize: 28, lineHeight: 35, fontWeight: '800', color: palette.navy, fontVariant: ['tabular-nums']},
  metricLabel: {maxWidth: '90%', marginTop: 1, fontSize: 13, lineHeight: 18, textAlign: 'center', fontWeight: '600', color: palette.muted},
  metricArrow: {position: 'absolute', top: 14, right: 10}, metricSkeleton: {width: 48, height: 30, marginTop: 5, marginBottom: 1, borderRadius: 7, backgroundColor: '#E9EEF4'},
  errorNotice: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: palette.errorBackground},
  errorText: {flex: 1, fontSize: 12, lineHeight: 17, color: palette.error}, retryButton: {minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10}, retryText: {fontSize: 12, fontWeight: '800', color: palette.error},
  sectionHeading: {marginTop: 23, marginBottom: 8}, sectionTitle: {fontSize: 15, fontWeight: '800', color: palette.navy},
  quickActions: {overflow: 'hidden', borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  quickAction: {minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E8EDF2'},
  quickIcon: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#F0F3F7'},
  quickCopy: {flex: 1}, quickTitle: {fontSize: 13, fontWeight: '700', color: palette.navy}, quickSubtitle: {marginTop: 3, fontSize: 11, color: palette.slate},
  pressed: {opacity: 0.72},
});
