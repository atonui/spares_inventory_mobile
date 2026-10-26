import {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {api} from '../api/runtime';
import type {InventoryItem} from '../features/inventory/inventoryRepository';
import {syncQueuedStock, type QueuedStockAdjustment} from '../features/inventory/offlineStockQueue';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';

type StockItemMap = Map<number, InventoryItem>;

export default function OfflineChangesScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [queue, setQueue] = useState<QueuedStockAdjustment[]>([]);
  const [items, setItems] = useState<StockItemMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<QueuedStockAdjustment | null>(null);

  const load = useCallback(async () => {
    try {
      const activeUserId = await offlineStockStore.getActiveUserId();
      setUserId(activeUserId);
      if (activeUserId === null) {
        setQueue([]);
        setItems(new Map());
        return;
      }
      const [pending, snapshot] = await Promise.all([
        offlineStockStore.list(activeUserId),
        offlineStockStore.loadInventorySnapshot(activeUserId),
      ]);
      setQueue(pending);
      setItems(new Map((snapshot ?? []).map(item => [item.id, item])));
      setError('');
    } catch {
      setError('Could not load saved changes. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    return offlineStockStore.subscribeQueueChanges(() => { void load(); });
  }, [load]);

  const queued = queue.filter(change => change.status === 'queued');
  const conflicts = queue.filter(change => change.status === 'conflict');

  async function syncNow() {
    if (userId === null || syncing) return;
    setSyncing(true);
    setError('');
    setSyncNotice('');
    try {
      const result = await syncQueuedStock(offlineStockStore, userId, api.adjustStock);
      if (result.blocked) setSyncNotice('No connection to the server. Your changes remain saved on this device.');
      await load();
    } catch {
      setError('Could not sync changes. Check your connection and try again.');
    } finally {
      setSyncing(false);
    }
  }

  function openItem(change: QueuedStockAdjustment) {
    router.push({pathname: '/inventory/[itemId]', params: {
      itemId: String(change.inventoryId), userId: String(change.userId),
    }});
  }

  function discardConflict(change: QueuedStockAdjustment) {
    setPendingDiscard(change);
  }

  async function confirmDiscard() {
    if (!pendingDiscard) return;
    try {
      await offlineStockStore.remove(pendingDiscard.operationId);
      setPendingDiscard(null);
      await load();
    } catch {
      setError('Could not discard this change. Try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to inventory" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.title}>Offline changes</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>Stock counts saved on this device appear here until they sync.</Text>
          <View style={styles.summaryRow}>
            <SummaryCard count={queued.length} label="Waiting to sync" tone="amber" />
            <SummaryCard count={conflicts.length} label="Need review" tone="red" />
          </View>

          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!!syncNotice && <Text accessibilityRole="status" style={styles.syncNotice}>{syncNotice}</Text>}

          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={palette.navy} /><Text style={styles.body}>Loading saved changes…</Text></View>
          ) : queue.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>You’re all caught up</Text>
              <Text style={styles.body}>New stock counts will show here if they need to wait for a connection.</Text>
            </View>
          ) : (
            <>
              {queued.length > 0 && (
                <>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Waiting to sync</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Sync changes now" disabled={syncing}
                      onPress={() => void syncNow()} style={[styles.syncButton, syncing && styles.disabledButton]}>
                      {syncing ? <ActivityIndicator size="small" color={palette.white} /> : <Text style={styles.syncButtonText}>Sync now</Text>}
                    </Pressable>
                  </View>
                  {queued.map(change => <ChangeCard key={change.operationId} change={change} item={items.get(change.inventoryId)} />)}
                </>
              )}
              {conflicts.length > 0 && (
                <View style={styles.conflictSection}>
                  <Text style={styles.sectionTitle}>Needs review</Text>
                  <Text style={styles.body}>The server changed before these counts could sync. Check the current quantity before trying again.</Text>
                  {conflicts.map(change => (
                    <ChangeCard key={change.operationId} change={change} item={items.get(change.inventoryId)} conflict
                      onReview={() => openItem(change)} onDiscard={() => discardConflict(change)} />
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
      <AppBottomNavigation active="changes" queuedCount={queued.length} conflictCount={conflicts.length} />
      <Modal transparent visible={pendingDiscard !== null} animationType="fade" onRequestClose={() => setPendingDiscard(null)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityRole="alert" style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Discard this stock change?</Text>
            <Text style={styles.body}>
              The offline count for {items.get(pendingDiscard?.inventoryId ?? -1)?.partNumber ?? 'this item'} will be removed from this device.
            </Text>
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Keep change" onPress={() => setPendingDiscard(null)} style={styles.discardButton}>
                <Text style={styles.discardButtonText}>Keep change</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Confirm discard" onPress={() => void confirmDiscard()} style={styles.dangerButton}>
                <Text style={styles.dangerButtonText}>Discard</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryCard({count, label, tone}: {count: number; label: string; tone: 'amber' | 'red'}) {
  return (
    <View style={[styles.summaryCard, tone === 'red' && styles.conflictSummary]}>
      <Text style={styles.summaryCount}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function ChangeCard({change, item, conflict = false, onReview, onDiscard}: {
  change: QueuedStockAdjustment;
  item?: InventoryItem;
  conflict?: boolean;
  onReview?: () => void;
  onDiscard?: () => void;
}) {
  const title = item?.partNumber ?? `Inventory item ${change.inventoryId}`;
  return (
    <View style={[styles.changeCard, conflict && styles.conflictCard]}>
      <View style={styles.cardTop}>
        <View style={styles.itemCopy}>
          <Text style={styles.partNumber}>{title}</Text>
          <Text style={styles.body}>{item?.description ?? 'Item details are not saved on this device.'}</Text>
          {item?.storeName && <Text style={styles.storeName}>Store: {item.storeName}</Text>}
        </View>
        <View style={[styles.statusPill, conflict && styles.conflictPill]}>
          <Text style={[styles.statusText, conflict && styles.conflictText]}>{conflict ? 'Review' : 'Queued'}</Text>
        </View>
      </View>
      <View style={styles.quantityRow}>
        <Text style={styles.quantityLabel}>Stock count</Text>
        <Text accessibilityLabel={`Stock count changes from ${change.expectedQuantity} to ${change.newQuantity}`}
          style={styles.quantity}>{change.expectedQuantity} → {change.newQuantity}</Text>
      </View>
      {conflict && !!change.error && <Text style={styles.conflictMessage}>{change.error}</Text>}
      {conflict && (
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Review ${title}`} onPress={onReview} style={styles.reviewButton}>
            <Text style={styles.reviewButtonText}>Open item</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Discard ${title} change`} onPress={onDiscard} style={styles.discardButton}>
            <Text style={styles.discardButtonText}>Discard change</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const palette = {
  navy: '#15263B', amber: '#E9A23B', slate: '#64748B', background: '#F5F7FA', white: '#FFFFFF',
  muted: '#475569', border: '#CBD5E1', amberTint: '#FEF3DF', red: '#A13A32', redTint: '#FFF0EE',
};

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 16},
  header: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: palette.border},
  backButton: {width: 44, height: 44, justifyContent: 'center'},
  backGlyph: {fontSize: 34, lineHeight: 38, color: palette.navy},
  headerCopy: {flex: 1},
  brand: {fontSize: 13, fontWeight: '700', color: palette.slate},
  title: {fontSize: 19, fontWeight: '800', color: palette.navy},
  content: {paddingTop: 18, paddingBottom: 32, gap: 12},
  intro: {fontSize: 14, lineHeight: 21, color: palette.muted},
  summaryRow: {flexDirection: 'row', gap: 10},
  summaryCard: {flex: 1, borderRadius: 13, padding: 13, backgroundColor: palette.amberTint},
  conflictSummary: {backgroundColor: palette.redTint},
  summaryCount: {fontSize: 22, fontWeight: '800', color: palette.navy},
  summaryLabel: {marginTop: 3, fontSize: 12, fontWeight: '700', color: palette.muted},
  loading: {minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 9},
  body: {fontSize: 13, lineHeight: 19, color: palette.muted},
  sectionHeader: {marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sectionTitle: {fontSize: 16, fontWeight: '800', color: palette.navy},
  syncButton: {minHeight: 44, minWidth: 90, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: palette.navy},
  disabledButton: {opacity: 0.6},
  syncButtonText: {fontSize: 13, fontWeight: '800', color: palette.white},
  changeCard: {padding: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  conflictSection: {gap: 10, marginTop: 8},
  conflictCard: {borderColor: '#E7B7B2'},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  itemCopy: {flex: 1},
  partNumber: {fontSize: 15, fontWeight: '800', color: palette.navy},
  storeName: {marginTop: 4, fontSize: 12, fontWeight: '700', color: palette.slate},
  statusPill: {paddingHorizontal: 9, paddingVertical: 5, borderRadius: 11, backgroundColor: palette.amberTint},
  conflictPill: {backgroundColor: palette.redTint},
  statusText: {fontSize: 10, fontWeight: '800', color: palette.navy},
  conflictText: {color: palette.red},
  quantityRow: {marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDF1F4', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  quantityLabel: {fontSize: 12, fontWeight: '600', color: palette.muted},
  quantity: {fontSize: 17, fontWeight: '800', color: palette.navy},
  conflictMessage: {marginTop: 9, fontSize: 12, lineHeight: 18, color: palette.red},
  actionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12},
  reviewButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 11, backgroundColor: palette.navy},
  reviewButtonText: {fontSize: 12, fontWeight: '800', color: palette.white},
  discardButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: palette.border},
  discardButtonText: {fontSize: 12, fontWeight: '700', color: palette.muted},
  emptyCard: {marginTop: 14, padding: 18, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border},
  emptyTitle: {marginBottom: 6, fontSize: 16, fontWeight: '800', color: palette.navy},
  error: {padding: 11, borderRadius: 10, backgroundColor: palette.redTint, color: palette.red, fontSize: 13},
  syncNotice: {padding: 11, borderRadius: 10, backgroundColor: palette.amberTint, color: palette.navy, fontSize: 13, lineHeight: 19},
  modalBackdrop: {flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(21, 38, 59, 0.48)'},
  confirmCard: {padding: 20, borderRadius: 16, backgroundColor: palette.white},
  confirmTitle: {marginBottom: 8, fontSize: 18, fontWeight: '800', color: palette.navy},
  dangerButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 11, backgroundColor: palette.red},
  dangerButtonText: {fontSize: 12, fontWeight: '800', color: palette.white},
});
