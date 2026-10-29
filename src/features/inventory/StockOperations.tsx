import {useRef, useState} from 'react';
import {KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {api} from '../../api/runtime';
import {ApiError, type InventoryRow} from '../../api/client';
import {offlineStockStore} from './offlineStockStore';

type Operation = 'receive' | 'issue';

export function StockOperations({item, userId, onRefresh}: {item: InventoryRow; userId: number; onRefresh: () => Promise<number>}) {
  const [mode, setMode] = useState<Operation | null>(null);
  const [quantity, setQuantity] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [notes, setNotes] = useState('');
  const [reviewedQuantity, setReviewedQuantity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [finished, setFinished] = useState(false);
  const locked = useRef(false);
  const units = Number(quantity);

  function open(operation: Operation) {
    setMode(operation); setQuantity(''); setWorkOrder(''); setNotes('');
    setReviewedQuantity(null); setFinished(false); setError(''); setNotice('');
  }

  async function checkStock() {
    const user = await api.getMe();
    if (user.id !== userId) throw new Error('The active account changed. Return to inventory.');
    const queue = await offlineStockStore.list(userId);
    if (queue.some(change => change.inventoryId === item.id)) throw new Error('Sync or resolve this item’s offline counts before continuing.');
    const rows = await api.getInventory();
    const current = rows.find(row => row.id === item.id);
    if (!current || current.isAllocated) throw new Error('This stock is no longer available for this action. Return to inventory.');
    if (mode === 'issue' && units > current.quantity) throw new Error(`Only ${current.quantity} units are available. Enter a smaller quantity.`);
    return current.quantity;
  }

  async function proceed() {
    if (locked.current || finished) return;
    if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(units) || units < 1 || units > 2147483647) {
      setError('Enter a whole quantity greater than zero.'); return;
    }
    if (mode === 'issue' && !workOrder.trim()) {setError('Enter the work order for this issue.'); return;}
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
      else await api.issueStock({inventoryId: item.id, quantity: units, workOrder, notes});
      setFinished(true);
      setNotice(mode === 'receive' ? 'Stock received successfully.' : 'Stock issued successfully.');
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
    <Text style={styles.body}>Receive deliveries or issue stock to a work order. Connection required.</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => open('receive')} style={styles.secondary}><Text style={styles.label}>Receive stock</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={item.quantity === 0} onPress={() => open('issue')} style={[styles.secondary, item.quantity === 0 && styles.disabled]}><Text style={styles.label}>Issue stock</Text></Pressable>
    </View>
    <Modal visible={mode !== null} animationType="slide" onRequestClose={() => {if (!busy) setMode(null);}}>
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>{mode === 'receive' ? 'Receive stock' : 'Issue stock'}</Text>
          <Text style={styles.label}>{item.partNumber} · {item.storeName}</Text>
          <Text style={styles.body}>{item.description}</Text>
          {!finished && reviewedQuantity === null && <>
            <Text style={styles.label}>Quantity</Text>
            <TextInput accessibilityLabel="Movement quantity" style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" autoFocus editable={!busy} />
            {mode === 'issue' && <>
              <Text style={styles.label}>Work order (required)</Text>
              <TextInput accessibilityLabel="Work order" style={styles.input} value={workOrder} onChangeText={setWorkOrder} autoCorrect={false} editable={!busy} />
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput accessibilityLabel="Issue notes" style={styles.input} value={notes} onChangeText={setNotes} maxLength={1000} editable={!busy} />
            </>}
          </>}
          {!finished && reviewedQuantity !== null && <View style={styles.card}>
            <Text style={styles.label}>{mode === 'receive' ? 'Receive' : 'Issue'} {units} units</Text>
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
});
