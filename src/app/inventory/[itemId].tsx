import {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {api} from '../../api/runtime';
import type {InventoryRow, NativeUser} from '../../api/client';
import {getCachedInventoryItem, setInventorySnapshot, updateInventorySnapshotItem} from '../../features/inventory/inventorySnapshot';
import {InventoryItemDetails} from '../../features/inventory/InventoryItemDetails';
import {applyQueuedStockCounts} from '../../features/inventory/offlineStockQueue';
import {offlineStockStore} from '../../features/inventory/offlineStockStore';

type DetailStatus = 'loading' | 'ready' | 'error' | 'not-found';

export default function InventoryItemDetailScreen() {
  const {itemId, userId: userIdParam} = useLocalSearchParams<{itemId: string; userId?: string}>();
  const router = useRouter();
  const [item, setItem] = useState<InventoryRow | null>(null);
  const [status, setStatus] = useState<DetailStatus>('loading');
  const [userId, setUserId] = useState<number | null>(null);
  const [user, setUser] = useState<NativeUser | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const loadItem = async () => {
      if (!/^\d+$/.test(itemId) || Number(itemId) < 1) {
        if (active) {
          setItem(null);
          setStatus('not-found');
        }
        return;
      }

      const requestedUserId = /^\d+$/.test(userIdParam ?? '') ? Number(userIdParam) : null;
      let storedActiveUserId: number | null = null;
      try { storedActiveUserId = await offlineStockStore.getActiveUserId(); }
      catch { storedActiveUserId = null; }
      let currentUserId = storedActiveUserId ?? requestedUserId;
      if (currentUserId !== null && active) setUserId(currentUserId);
      let savedProfile: NativeUser | null = null;
      if (currentUserId !== null) {
        try { savedProfile = await offlineStockStore.loadProfile(currentUserId); }
        catch { savedProfile = null; }
      }
      if (savedProfile?.id !== currentUserId) savedProfile = null;
      if (savedProfile && active) setUser(savedProfile);
      const cachedItem = getCachedInventoryItem(Number(itemId));
      if (cachedItem !== undefined && currentUserId !== null) {
        if (active) {
          setItem(cachedItem);
          setStatus(cachedItem ? 'ready' : 'not-found');
        }
        if (!savedProfile) {
          try {
            const currentUser = await api.getMe();
            if (currentUser.id === currentUserId && active) {
              setUser(currentUser);
              await offlineStockStore.saveProfile(currentUser);
            }
          } catch { /* Keep the stock details available offline; controls stay hidden without a profile. */ }
        }
        return;
      }

      try {
        if (currentUserId === null) {
          const currentUser = await api.getMe();
          currentUserId = currentUser.id;
          savedProfile = currentUser;
          await offlineStockStore.saveProfile(currentUser);
          if (active) setUser(currentUser);
          if (active) setUserId(currentUserId);
        }
        const activeUserId = currentUserId;
        const serverRows = await api.getInventory();
        if (!savedProfile) {
          try {
            const currentUser = await api.getMe();
            if (currentUser.id === activeUserId) {
              savedProfile = currentUser;
              await offlineStockStore.saveProfile(currentUser);
              if (active) setUser(currentUser);
            }
          } catch { /* Stock details still work offline without exposing adjustment controls. */ }
        }
        const rows = applyQueuedStockCounts(serverRows, await offlineStockStore.list(activeUserId));
        if (!active) return;
        setInventorySnapshot(rows);
        const found = rows.find(row => row.id === Number(itemId)) ?? null;
        setItem(found);
        setStatus(found ? 'ready' : 'not-found');
      } catch {
        if (!active) return;
        setItem(null);
        setStatus('error');
      }
    };
    void Promise.resolve().then(loadItem);
    return () => { active = false; };
  }, [itemId, userIdParam, attempt]);

  async function refreshCurrentQuantity(): Promise<number> {
    if (userId === null) throw new Error('No active account');
    const serverRows = await api.getInventory();
    const queue = await offlineStockStore.list(userId);
    const rows = applyQueuedStockCounts(serverRows, queue);
    await offlineStockStore.saveInventorySnapshot(userId, serverRows);
    setInventorySnapshot(rows);
    const current = rows.find(row => row.id === Number(itemId));
    if (!current) throw new Error('Stock item is no longer available');
    setItem(current);
    return current.quantity;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to inventory"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <Image source={require('../../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
          <View>
            <Text style={styles.wordmark}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.pageTitle}>Stock details</Text>
          </View>
        </View>

        {status === 'loading' && (
          <View style={styles.messageState}>
            <ActivityIndicator size="large" color={palette.navy} />
            <Text style={styles.messageText}>Loading stock details…</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.messageState}>
            <Text style={styles.messageTitle}>Could not load stock details</Text>
            <Text style={styles.messageText}>Check your connection and try again.</Text>
            <Pressable accessibilityRole="button" onPress={() => { setStatus('loading'); setAttempt(value => value + 1); }} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {status === 'not-found' && (
          <View style={styles.messageState}>
            <Text style={styles.messageTitle}>Stock item not found</Text>
            <Text style={styles.messageText}>This item may have been removed from the inventory.</Text>
          </View>
        )}

        {status === 'ready' && item && userId !== null && (
          <InventoryItemDetails
            item={item}
            user={user}
            userId={userId}
            onRefresh={refreshCurrentQuantity}
            onQuantityChange={quantity => {
              setItem(current => {
                if (!current) return current;
                const updated = {...current, quantity};
                updateInventorySnapshotItem(updated);
                return updated;
              });
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const palette = {
  navy: '#15263B',
  muted: '#475569',
  background: '#F5F7FA',
  amber: '#E9A23B',
  white: '#FFFFFF',
};

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 20},
  topBar: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#CBD5E1'},
  brandIcon: {width: 40, height: 40, borderRadius: 12},
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  backButtonText: {fontSize: 30, lineHeight: 33, color: palette.navy},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.navy},
  pageTitle: {fontSize: 13, fontWeight: '600', color: palette.muted},
  messageState: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  messageTitle: {fontSize: 17, fontWeight: '800', color: palette.navy, textAlign: 'center'},
  messageText: {marginTop: 8, fontSize: 14, lineHeight: 20, color: palette.muted, textAlign: 'center'},
  retryButton: {minHeight: 48, minWidth: 120, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.amber},
  retryText: {fontSize: 14, fontWeight: '800', color: palette.navy},
});
