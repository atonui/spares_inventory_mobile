import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import * as Network from 'expo-network';
import {api} from '../../api/runtime';
import type {InventoryRow} from '../../api/client';
import {saveStockCount, syncQueuedStock, type QueuedStockAdjustment} from './offlineStockQueue';
import {offlineStockStore} from './offlineStockStore';

type Mode = 'add' | 'count';
type UndoableCount = {adjustment: QueuedStockAdjustment; previousQuantity: number};

export function StockAdjustmentControls({item, userId, onQuantityChange, onRefresh}: {
  item: InventoryRow;
  userId: number;
  onQuantityChange: (quantity: number) => void;
  onRefresh: () => Promise<number>;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [value, setValue] = useState('');
  const [zeroCountConfirmationVisible, setZeroCountConfirmationVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [hasConflict, setHasConflict] = useState(false);
  const [confirmDiscardVisible, setConfirmDiscardVisible] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [quantityRefreshed, setQuantityRefreshed] = useState(false);
  const [undoableCount, setUndoableCount] = useState<UndoableCount | null>(null);
  const [undoing, setUndoing] = useState(false);
  const syncInFlight = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
  }, []);

  async function refreshPending() {
    const entries = await offlineStockStore.list(userId);
    const itemEntries = entries.filter(entry => entry.inventoryId === item.id);
    setPendingCount(itemEntries.length);
    setHasConflict(itemEntries.some(entry => entry.status === 'conflict'));
    if (itemEntries.some(entry => entry.status === 'conflict')) setQuantityRefreshed(false);
  }

  useEffect(() => {
    let active = true;
    void offlineStockStore.list(userId).then(entries => {
      if (!active) return;
      const itemEntries = entries.filter(entry => entry.inventoryId === item.id);
      setPendingCount(itemEntries.length);
      setHasConflict(itemEntries.some(entry => entry.status === 'conflict'));
      if (itemEntries.some(entry => entry.status === 'conflict')) setQuantityRefreshed(false);
    });
    return () => { active = false; };
  }, [userId, item.id]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener(state => {
      if (!state.isConnected || state.isInternetReachable === false || syncInFlight.current) return;
      syncInFlight.current = true;
      void (async () => {
        const before = await offlineStockStore.list(userId);
        if (!before.some(entry => entry.inventoryId === item.id && entry.status === 'queued')) return;
        await syncQueuedStock(offlineStockStore, userId, api.adjustStock);
        const remaining = await offlineStockStore.list(userId);
        const itemEntries = remaining.filter(entry => entry.inventoryId === item.id);
        setPendingCount(itemEntries.length);
        setHasConflict(itemEntries.some(entry => entry.status === 'conflict'));
        if (itemEntries.some(entry => entry.status === 'conflict')) setQuantityRefreshed(false);
        const latest = (await api.getInventory()).find(row => row.id === item.id);
        if (latest) onQuantityChange(latest.quantity);
        if (itemEntries.some(entry => entry.status === 'conflict')) {
          setNotice('Stock changed before this count synced. Review the current quantity and edit it again.');
        } else if (!remaining.some(entry => entry.inventoryId === item.id)) {
          setNotice('Offline stock changes synced.');
        }
      })().catch(() => undefined).finally(() => { syncInFlight.current = false; });
    });
    return () => subscription.remove();
  }, [userId, item.id, onQuantityChange]);

  async function save(confirmZeroCount = false) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0 || (mode === 'add' && amount < 1)) {
      setNotice(mode === 'add' ? 'Enter a whole number greater than zero.' : 'Enter a whole number of zero or more.');
      return;
    }
    const nextQuantity = mode === 'add' ? item.quantity + amount : amount;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 2147483647) {
      setNotice('Quantity is too large.');
      return;
    }
    if (nextQuantity === item.quantity) {
      setNotice('The count matches the current quantity.');
      return;
    }
    if (mode === 'count' && item.quantity > 0 && amount === 0 && !confirmZeroCount) {
      setNotice('');
      setZeroCountConfirmationVisible(true);
      return;
    }

    setSaving(true);
    setNotice('');
    try {
      const adjustment = await saveStockCount(offlineStockStore, {
        userId,
        inventoryId: item.id,
        expectedQuantity: item.quantity,
        newQuantity: nextQuantity,
      });
      setUndoableCount({adjustment, previousQuantity: adjustment.expectedQuantity});
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoableCount(null), 8000);
      onQuantityChange(nextQuantity);
      setMode(null);
      setValue('');
      setZeroCountConfirmationVisible(false);
      const sync = await syncQueuedStock(offlineStockStore, userId, api.adjustStock);
      const entries = await offlineStockStore.list(userId);
      const itemEntries = entries.filter(entry => entry.inventoryId === item.id);
      setPendingCount(itemEntries.length);
      setHasConflict(itemEntries.some(entry => entry.status === 'conflict'));
      if (itemEntries.some(entry => entry.status === 'conflict')) setQuantityRefreshed(false);
      if (itemEntries.some(entry => entry.status === 'conflict')) {
        setUndoableCount(null);
        setNotice('Stock changed before this count synced. Refresh and review the current quantity.');
        try {
          const latest = (await api.getInventory()).find(row => row.id === item.id);
          if (latest) onQuantityChange(latest.quantity);
        } catch { /* Keep the saved offline count visible until a refresh is possible. */ }
      } else if (sync.blocked || itemEntries.length > 0) {
        setNotice('Saved on this device. It will sync when you’re back online.');
      } else {
        setNotice('Stock updated.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this stock change.');
    } finally {
      setSaving(false);
    }
  }

  async function undoSavedCount() {
    const undo = undoableCount;
    if (!undo || undoing) return;
    setUndoing(true);
    setNotice('');
    try {
      const entries = await offlineStockStore.list(userId);
      const queued = entries.find(entry => entry.operationId === undo.adjustment.operationId && entry.status === 'queued');
      if (queued) {
        await offlineStockStore.remove(queued.operationId);
        const remaining = await offlineStockStore.list(userId);
        const itemEntries = remaining.filter(entry => entry.inventoryId === item.id);
        setPendingCount(itemEntries.length);
        setHasConflict(itemEntries.some(entry => entry.status === 'conflict'));
        onQuantityChange(undo.previousQuantity);
        setNotice('Stock change undone.');
      } else {
        await saveStockCount(offlineStockStore, {
          userId,
          inventoryId: item.id,
          expectedQuantity: undo.adjustment.newQuantity,
          newQuantity: undo.previousQuantity,
        });
        onQuantityChange(undo.previousQuantity);
        const sync = await syncQueuedStock(offlineStockStore, userId, api.adjustStock);
        const remaining = await offlineStockStore.list(userId);
        const itemEntries = remaining.filter(entry => entry.inventoryId === item.id);
        setPendingCount(itemEntries.length);
        setHasConflict(itemEntries.some(entry => entry.status === 'conflict'));
        if (itemEntries.some(entry => entry.status === 'conflict')) {
          setQuantityRefreshed(false);
          try {
            const latest = (await api.getInventory()).find(row => row.id === item.id);
            if (latest) onQuantityChange(latest.quantity);
          } catch { /* Keep the queued undo visible until the current quantity can be refreshed. */ }
          setNotice('Could not undo because stock changed on the server. Review the current quantity.');
        } else if (sync.blocked || itemEntries.length > 0) {
          setNotice('Undo saved on this device. It will sync when you’re back online.');
        } else {
          setNotice('Stock change undone.');
        }
      }
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
      setUndoableCount(null);
    } catch (error) {
      setNotice(error instanceof Error ? `Could not undo this stock change: ${error.message}` : 'Could not undo this stock change.');
    } finally {
      setUndoing(false);
    }
  }

  async function discardOutdatedChanges() {
    if (discarding) return;
    setDiscarding(true);
    setDiscardError('');
    try {
      const entries = await offlineStockStore.list(userId);
      for (const entry of entries) {
        if (entry.inventoryId === item.id && entry.status === 'conflict') await offlineStockStore.remove(entry.operationId);
      }
      await refreshPending();
      setNotice('Outdated offline changes removed. The displayed quantity is ready for a new count.');
      setConfirmDiscardVisible(false);
    } catch {
      setDiscardError('Could not remove these changes. Try again.');
    } finally {
      setDiscarding(false);
    }
  }

  async function refreshCurrentQuantity() {
    if (refreshing || discarding) return;
    setRefreshing(true);
    setNotice('');
    try {
      const quantity = await onRefresh();
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Invalid stock quantity');
      onQuantityChange(quantity);
      setQuantityRefreshed(true);
      setNotice('Current server quantity refreshed. Review it before discarding this change.');
    } catch {
      setNotice('Could not refresh the server quantity. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View>
      {!item.isAllocated && (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={hasConflict} onPress={() => {setMode('add'); setValue(''); setNotice(''); setZeroCountConfirmationVisible(false);}} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Add stock</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={hasConflict} onPress={() => {setMode('count'); setValue(String(item.quantity)); setNotice(''); setZeroCountConfirmationVisible(false);}} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Edit count</Text>
          </Pressable>
        </View>
      )}
      {pendingCount > 0 && <Text accessibilityRole="text" style={styles.pending}>{hasConflict ? 'Stock changes need review' : `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync`}</Text>}
      {undoableCount && !hasConflict && (
        <View accessibilityRole="summary" style={styles.undoNotice}>
          <Text accessibilityRole="status" style={styles.undoText}>Stock quantity changed.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Undo stock change" disabled={undoing}
            onPress={() => void undoSavedCount()} style={styles.undoButton}>
            <Text style={styles.undoButtonText}>{undoing ? 'Undoing…' : 'Undo'}</Text>
          </Pressable>
        </View>
      )}
      {hasConflict && (
        <View style={styles.conflictActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh current quantity" disabled={refreshing || discarding}
            onPress={() => void refreshCurrentQuantity()} style={styles.refreshButton}>
            {refreshing ? <ActivityIndicator size="small" color={palette.navy} /> : <Text style={styles.refreshText}>Refresh current quantity</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityHint="Refresh the current server quantity first."
            disabled={refreshing || !quantityRefreshed} onPress={() => {setDiscardError(''); setConfirmDiscardVisible(true);}}
            style={[styles.discardButton, (!quantityRefreshed || refreshing) && styles.disabledAction]}>
            <Text style={styles.discardText}>Discard outdated changes</Text>
          </Pressable>
        </View>
      )}
      {!!notice && <Text accessibilityRole="status" style={styles.notice}>{notice}</Text>}
      <Modal visible={confirmDiscardVisible} animationType="fade" transparent onRequestClose={() => {if (!discarding) setConfirmDiscardVisible(false);}}>
        <View style={styles.confirmBackdrop}>
          <View accessibilityRole="alert" style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Discard these outdated stock changes?</Text>
            <Text style={styles.helper}>
              The conflicted count for {item.partNumber} will be removed from this device. Refresh the item before entering a new count.
            </Text>
            {!!discardError && <Text accessibilityRole="alert" style={styles.discardError}>{discardError}</Text>}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Keep outdated changes" disabled={discarding}
                onPress={() => setConfirmDiscardVisible(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Keep changes</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Confirm discard outdated changes" disabled={discarding}
                onPress={() => void discardOutdatedChanges()} style={styles.dangerButton}>
                <Text style={styles.dangerButtonText}>{discarding ? 'Discarding…' : 'Discard'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={mode !== null} animationType="slide" transparent onRequestClose={() => {
        if (saving) return;
        if (zeroCountConfirmationVisible) setZeroCountConfirmationVisible(false);
        else setMode(null);
      }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {zeroCountConfirmationVisible ? (
              <View accessibilityRole="alert">
                <Text accessibilityRole="header" style={styles.title}>Set this item to zero?</Text>
                <Text style={styles.helper}>
                  Confirm the physical count for {item.partNumber} from {item.quantity} units to 0. This change will be recorded.
                </Text>
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Keep editing count" disabled={saving}
                    onPress={() => setZeroCountConfirmationVisible(false)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Keep editing</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Confirm zero count" disabled={saving}
                    onPress={() => {setZeroCountConfirmationVisible(false); void save(true);}} style={styles.primaryButton}>
                    {saving ? <ActivityIndicator color={palette.navy} /> : <Text style={styles.primaryButtonText}>Confirm zero count</Text>}
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Text accessibilityRole="header" style={styles.title}>{mode === 'add' ? 'Add stock' : 'Edit stock count'}</Text>
                <Text style={styles.helper}>
                  {mode === 'add' ? `Current quantity: ${item.quantity}. Enter units received.` : `Current quantity: ${item.quantity}. Enter the new counted total.`}
                </Text>
                <TextInput
                  accessibilityLabel={mode === 'add' ? 'Quantity to add' : 'New stock quantity'}
                  value={value}
                  onChangeText={setValue}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  selectTextOnFocus
                  editable={!saving}
                  style={styles.input}
                />
                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" disabled={saving} onPress={() => setMode(null)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={styles.primaryButton}>
                    {saving ? <ActivityIndicator color={palette.navy} /> : <Text style={styles.primaryButtonText}>Save change</Text>}
                  </Pressable>
                </View>
              </>
            )}
            {!!notice && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', white: '#FFFFFF', line: '#CBD5E1', pale: '#F5F7FA'};
const styles = StyleSheet.create({
  actions: {flexDirection: 'row', gap: 10, marginTop: 14},
  conflictActions: {alignItems: 'flex-start', gap: 2},
  refreshButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 10},
  refreshText: {fontSize: 13, fontWeight: '700', color: palette.navy, textDecorationLine: 'underline'},
  primaryButton: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.amber, paddingHorizontal: 12},
  primaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  secondaryButton: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white, paddingHorizontal: 12},
  secondaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  pending: {marginTop: 10, fontSize: 12, fontWeight: '700', color: palette.slate},
  undoNotice: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, paddingLeft: 12, borderRadius: 11, backgroundColor: palette.navy},
  undoText: {flex: 1, fontSize: 13, fontWeight: '600', color: palette.white},
  undoButton: {minWidth: 60, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14},
  undoButtonText: {fontSize: 14, fontWeight: '800', color: palette.amber},
  discardButton: {alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 8, paddingHorizontal: 10},
  disabledAction: {opacity: 0.5},
  discardText: {fontSize: 12, fontWeight: '700', color: palette.navy, textDecorationLine: 'underline'},
  notice: {marginTop: 8, fontSize: 13, lineHeight: 19, color: palette.slate},
  modalBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008'},
  modalCard: {padding: 22, paddingBottom: 32, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: palette.white},
  title: {fontSize: 20, fontWeight: '800', color: palette.navy},
  helper: {marginTop: 8, fontSize: 14, lineHeight: 20, color: palette.slate},
  input: {minHeight: 54, marginTop: 18, borderWidth: 1, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 20, fontWeight: '700', color: palette.navy},
  confirmBackdrop: {flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#15263B80'},
  confirmCard: {padding: 20, borderRadius: 16, backgroundColor: palette.white},
  confirmTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  dangerButton: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#A13A32', paddingHorizontal: 12},
  dangerButtonText: {fontSize: 14, fontWeight: '800', color: palette.white},
  discardError: {marginTop: 8, fontSize: 13, color: '#A13A32'},
});
