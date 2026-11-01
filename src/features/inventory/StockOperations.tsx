import {useRef, useState} from 'react';
import {KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {api} from '../../api/runtime';
import {ApiError, type InventoryRow} from '../../api/client';
import {offlineStockStore} from './offlineStockStore';
import type {StoreDestination} from '../../api/transferContract';

type Operation = 'receive' | 'issue' | 'transfer';

export function StockOperations({item, userId, onRefresh}: {item: InventoryRow; userId: number; onRefresh: () => Promise<number>}) {
  const [mode, setMode] = useState<Operation | null>(null);
  const [quantity, setQuantity] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [notes, setNotes] = useState('');
  const [recentWorkOrders, setRecentWorkOrders] = useState<string[]>([]);
  const [reviewedQuantity, setReviewedQuantity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [finished, setFinished] = useState(false);
  const locked = useRef(false);
  const units = Number(quantity);
  const [stores, setStores] = useState<StoreDestination[]>([]);
  const [destination, setDestination] = useState<StoreDestination | null>(null);
  const [storeSearch, setStoreSearch] = useState('');
  const [loadingStores, setLoadingStores] = useState(false);
  const storeRequest = useRef(0);

  async function loadStores() {
    const request = ++storeRequest.current;
    setLoadingStores(true); setError('');
    try {
      const rows = await api.getStores();
      if (request === storeRequest.current) setStores(rows.filter(store => store.id !== item.storeId).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {if (request === storeRequest.current) setError('Could not load destinations. Check your connection and retry.');}
    finally {if (request === storeRequest.current) setLoadingStores(false);}
  }

  function open(operation: Operation) {
    setMode(operation); setQuantity(''); setWorkOrder(''); setNotes('');
    setReviewedQuantity(null); setFinished(false); setError(''); setNotice('');
    setDestination(null); setStoreSearch(''); setStores([]);
    storeRequest.current++;
    if (operation === 'transfer') void loadStores();
    if (operation === 'issue') {
      void offlineStockStore.loadRecentWorkOrders(userId).then(setRecentWorkOrders).catch(() => setRecentWorkOrders([]));
    }
  }

  async function checkStock() {
    const user = await api.getMe();
    if (user.id !== userId) throw new Error('The active account changed. Return to inventory.');
    const queue = await offlineStockStore.list(userId);
    if (queue.some(change => change.inventoryId === item.id)) throw new Error('Sync or resolve this item’s offline counts before continuing.');
    const rows = await api.getInventory();
    const current = rows.find(row => row.id === item.id);
    if (!current || current.isAllocated) throw new Error('This stock is no longer available for this action. Return to inventory.');
    if (mode !== 'receive' && units > current.quantity) throw new Error(`Only ${current.quantity} units are available. Enter a smaller quantity.`);
    if (mode === 'transfer') {
      const currentStores = await api.getStores();
      if (!destination || destination.id === item.storeId || !currentStores.some(store => store.id === destination.id)) throw new Error('Choose an active destination store.');
    }
    return current.quantity;
  }

  async function proceed() {
    if (locked.current || finished) return;
    if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(units) || units < 1 || units > 2147483647) {
      setError('Enter a whole quantity greater than zero.'); return;
    }
    if (mode === 'issue' && !workOrder.trim()) {setError('Enter the work order for this stock consumption.'); return;}
    if (mode === 'transfer' && !destination) {setError('Choose a destination store.'); return;}
    locked.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      const currentQuantity = await checkStock();
      if (reviewedQuantity === null) {setReviewedQuantity(currentQuantity); return;}
      if (currentQuantity !== reviewedQuantity) {
        setReviewedQuantity(null); setError('Stock changed. Review the current quantity before confirming.'); return;
      }
      sent = true;
      if (mode === 'receive') await api.receiveStock({partId: item.partId, storeId: item.storeId, quantity: units});
      else if (mode === 'transfer') await api.dispatchStock({inventoryId: item.id, toStoreId: destination!.id, quantity: units});
      else await api.issueStock({inventoryId: item.id, quantity: units, workOrder, notes});
      if (mode === 'issue') {
        try { setRecentWorkOrders(await offlineStockStore.saveRecentWorkOrder(userId, workOrder.trim())); }
        catch { /* The confirmed issue remains successful if recent suggestions cannot be saved. */ }
      }
      setFinished(true);
      setNotice(mode === 'transfer' ? 'Stock dispatched. The destination must confirm receipt before it becomes available there.' : mode === 'receive' ? 'Stock received successfully.' : 'Stock consumed successfully.');
      try {await onRefresh();}
      catch {setNotice('Stock saved. Refresh inventory to see the current balance. Do not submit it again.');}
    } catch (reason) {
      const uncertain = sent && (!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500);
      if (uncertain) {
        setFinished(true);
        setError('The result could not be confirmed. Check inventory and movement history on your desktop before trying again.');
      } else {
        setReviewedQuantity(null);
        setError(reason instanceof TypeError ? 'Connect to the server to review stock and try again.' : reason instanceof Error ? reason.message : 'Could not check stock. Connect to the server and try again.');
      }
    } finally {locked.current = false; setBusy(false);}
  }

  return <View style={styles.card}>
    <Text style={styles.title}>Stock movements</Text>
    <Text style={styles.body}>Receive stock, consume it against a work order, or transfer it to another store. Connection required.</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => open('receive')} style={styles.secondary}><Text style={styles.label}>Receive stock</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Consume stock" disabled={item.quantity === 0} onPress={() => open('issue')} style={[styles.secondary, item.quantity === 0 && styles.disabled]}><Text style={styles.label}>Consume stock</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={item.quantity === 0} onPress={() => open('transfer')} style={[styles.secondary, item.quantity === 0 && styles.disabled]}><Text style={styles.label}>Transfer stock</Text></Pressable>
    </View>
    <Modal visible={mode !== null} animationType="slide" onRequestClose={() => {if (!busy) setMode(null);}}>
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>{mode === 'transfer' ? 'Transfer stock' : mode === 'receive' ? 'Receive stock' : 'Consume stock'}</Text>
          <Text style={styles.label}>{item.partNumber} · {item.storeName}</Text>
          <Text style={styles.body}>{item.description}</Text>
          {!finished && reviewedQuantity === null && <>
            <Text style={styles.label}>Quantity</Text>
            <TextInput accessibilityLabel="Movement quantity" style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" autoFocus editable={!busy} />
            {mode === 'transfer' && <>
              <Text style={styles.label}>Destination{destination ? `: ${destination.name}` : ''}</Text>
              <TextInput accessibilityLabel="Search destination stores" placeholder="Search stores" value={storeSearch} onChangeText={setStoreSearch} style={styles.input} autoCorrect={false} editable={!busy} />
              {loadingStores ? <Text style={styles.body}>Loading destinations…</Text> : <>
                {stores.filter(store => store.name.toLocaleLowerCase().includes(storeSearch.trim().toLocaleLowerCase())).slice(0, 20).map(store => <Pressable key={store.id} accessibilityRole="radio" accessibilityLabel={store.name} accessibilityState={{checked: destination?.id === store.id}} disabled={busy} onPress={() => setDestination(store)} style={styles.secondary}><Text style={styles.label}>{destination?.id === store.id ? 'Selected: ' : ''}{store.name}</Text></Pressable>)}
                {stores.filter(store => store.name.toLocaleLowerCase().includes(storeSearch.trim().toLocaleLowerCase())).length > 20 && <Text style={styles.body}>Showing the first 20 matches. Refine your search to find another store.</Text>}
                {stores.length === 0 && <Text style={styles.body}>No other stores are available.</Text>}
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void loadStores()} style={styles.secondary}><Text style={styles.label}>Reload destinations</Text></Pressable>
              </>}
            </>}
            {mode === 'issue' && <>
              <Text style={styles.label}>Work order (required)</Text>
              <TextInput accessibilityLabel="Work order" placeholder="Enter work order reference" style={styles.input} value={workOrder} onChangeText={setWorkOrder} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
              {recentWorkOrders.length > 0 && <View style={styles.recentWorkOrders}>
                <Text style={styles.body}>Recent work orders</Text>
                <View style={styles.recentWorkOrderList}>{recentWorkOrders.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Use work order ${value}`} disabled={busy} onPress={() => setWorkOrder(value)} style={styles.recentWorkOrder}>
                  <Text style={styles.recentWorkOrderText}>{value}</Text>
                </Pressable>)}</View>
              </View>}
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput accessibilityLabel="Consumption notes" style={styles.input} value={notes} onChangeText={setNotes} maxLength={1000} editable={!busy} />
            </>}
          </>}
          {!finished && reviewedQuantity !== null && <View style={styles.card}>
            <Text style={styles.label}>{mode === 'transfer' ? 'Dispatch' : mode === 'receive' ? 'Receive' : 'Consume'} {units} units</Text>
            {mode === 'transfer' && <><Text style={styles.body}>From: {item.storeName}</Text><Text style={styles.body}>To: {destination?.name}</Text><Text style={styles.body}>Destination stock stays unavailable until receipt is confirmed.</Text></>}
            {mode === 'issue' && <Text style={styles.body}>Work order: {workOrder.trim()}</Text>}
            {mode === 'issue' && !!notes.trim() && <Text style={styles.body}>Notes: {notes.trim()}</Text>}
            <Text style={styles.body}>On hand: {reviewedQuantity} → {reviewedQuantity + (mode === 'receive' ? units : -units)}</Text>
            <Text style={styles.body}>This movement will be recorded immediately.</Text>
          </View>}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!!notice && <Text accessibilityRole="alert" style={styles.label}>{notice}</Text>}
          {!finished && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void proceed()} style={[styles.primary, busy && styles.disabled]}><Text style={styles.label}>{busy ? 'Checking…' : reviewedQuantity === null ? 'Review movement' : 'Confirm movement'}</Text></Pressable>}
          {!finished && reviewedQuantity !== null && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setReviewedQuantity(null)} style={styles.secondary}><Text style={styles.label}>Edit details</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setMode(null)} style={styles.secondary}><Text style={styles.label}>{finished ? 'Done' : 'Cancel'}</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: {padding: 16, gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 14},
  title: {fontSize: 20, fontWeight: '700', color: '#15263B'},
  body: {fontSize: 16, lineHeight: 24, color: '#64748B'},
  label: {fontSize: 16, lineHeight: 24, fontWeight: '600', color: '#15263B'},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  secondary: {minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, alignItems: 'center'},
  primary: {minHeight: 48, padding: 12, backgroundColor: '#E9A23B', borderRadius: 10, alignItems: 'center'},
  disabled: {opacity: 0.5},
  modal: {flex: 1, backgroundColor: '#F5F7FA'},
  content: {padding: 24, paddingTop: 64, paddingBottom: 48, gap: 16},
  input: {minHeight: 48, borderWidth: 1, borderColor: '#64748B', borderRadius: 10, padding: 12, backgroundColor: '#FFFFFF', fontSize: 16, color: '#15263B'},
  error: {fontSize: 16, lineHeight: 24, color: '#A13A32'},
  recentWorkOrders: {gap: 7},
  recentWorkOrderList: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  recentWorkOrder: {minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 19, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF'},
  recentWorkOrderText: {fontSize: 13, fontWeight: '700', color: '#15263B'},
});
