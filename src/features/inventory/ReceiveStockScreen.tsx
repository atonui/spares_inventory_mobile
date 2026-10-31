import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {api, isMockMode} from '../../api/runtime';
import {ApiError, type NativeUser} from '../../api/client';
import type {PartRecord, StoreDestination} from '../../api/transferContract';
import {canAdjustStock} from '../auth/roleCapabilities';
import {offlineStockStore} from './offlineStockStore';
import {applyQueuedStockCounts} from './offlineStockQueue';
import {clearInventorySnapshot, setInventorySnapshot} from './inventorySnapshot';
import {AppBottomNavigation} from '../navigation/AppBottomNavigation';

const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', background: '#F5F7FA', white: '#FFFFFF', border: '#CBD5E1', red: '#A13A32', green: '#28734A'};
const MAX_RESULTS = 20;

function messageFor(error: unknown): string {
  if (error instanceof ApiError || (isMockMode && error instanceof Error)) return error.message;
  return 'Could not reach the server. Connect and try again.';
}

function normalized(value: string) {
  return value.toLocaleLowerCase().trim();
}

export function ReceiveStockScreen() {
  const router = useRouter();
  const [user, setUser] = useState<NativeUser | null>(null);
  const [parts, setParts] = useState<PartRecord[]>([]);
  const [stores, setStores] = useState<StoreDestination[]>([]);
  const [selectedPart, setSelectedPart] = useState<PartRecord | null>(null);
  const [selectedStore, setSelectedStore] = useState<StoreDestination | null>(null);
  const [partQuery, setPartQuery] = useState('');
  const [storeQuery, setStoreQuery] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reviewedQuantity, setReviewedQuantity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const units = Number(quantity);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const currentUser = await api.getMe();
      const [partRows, storeRows] = await Promise.all([api.getParts(), api.getStores()]);
      setUser(currentUser);
      setParts(partRows.sort((a, b) => a.partNumber.localeCompare(b.partNumber)));
      setStores(storeRows.sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedPart(current => current ? partRows.find(part => part.id === current.id) ?? null : null);
      setSelectedStore(current => current ? storeRows.find(store => store.id === current.id) ?? null : null);
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        clearInventorySnapshot();
        router.replace('/');
      } else setError(messageFor(reason));
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? loadData() : undefined);
    return () => { active = false; };
  }, [loadData]);

  const availableStores = useMemo(() => stores.filter(store => user !== null && canAdjustStock(user, {
    storeType: store.type,
    storeOwner: store.assignedUserId ?? null,
    isAllocated: false,
  })), [stores, user]);
  const matchingParts = useMemo(() => {
    const query = normalized(partQuery);
    return parts.filter(part => !query || `${part.partNumber} ${part.description} ${part.category}`.toLocaleLowerCase().includes(query));
  }, [parts, partQuery]);
  const matchingStores = useMemo(() => {
    const query = normalized(storeQuery);
    return availableStores.filter(store => !query || `${store.name} ${store.location ?? ''} ${store.type}`.toLocaleLowerCase().includes(query));
  }, [availableStores, storeQuery]);

  async function checkCurrentSelection() {
    if (!selectedPart || !selectedStore || !user) throw new Error('Choose a part and an accessible store.');
    const [currentUser, currentParts, currentStores, currentInventory] = await Promise.all([
      api.getMe(), api.getParts(), api.getStores(), api.getInventory(),
    ]);
    if (currentUser.id !== user.id) throw new Error('The active account changed. Return to inventory and try again.');
    if (!currentParts.some(part => part.id === selectedPart.id)) throw new Error('This part is no longer available. Refresh and choose another part.');
    const currentStore = currentStores.find(store => store.id === selectedStore.id);
    if (!currentStore || !canAdjustStock(currentUser, {storeType: currentStore.type, storeOwner: currentStore.assignedUserId ?? null, isAllocated: false})) {
      throw new Error('This store is no longer available for receiving stock. Refresh and choose another store.');
    }
    const currentLine = currentInventory.find(row => row.partId === selectedPart.id && row.storeId === selectedStore.id && !row.isAllocated && row.workOrder === null);
    if (currentLine) {
      const queue = await offlineStockStore.list(user.id);
      if (queue.some(change => change.inventoryId === currentLine.id)) throw new Error('Sync or resolve this item’s offline counts before receiving stock.');
    }
    return {currentUser, currentParts, currentStores, currentInventory, currentLine, currentQuantity: currentLine?.quantity ?? 0};
  }

  async function continueFlow() {
    if (locked.current || finished) return;
    if (!selectedPart || !selectedStore) { setError('Choose a part and a store first.'); return; }
    if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(units) || units < 1 || units > 2147483647) {
      setError('Enter a whole quantity greater than zero.'); return;
    }
    locked.current = true; setSaving(true); setError('');
    let sent = false;
    try {
      const current = await checkCurrentSelection();
      if (reviewedQuantity === null) {
        setParts(current.currentParts);
        setStores(current.currentStores);
        setReviewedQuantity(current.currentQuantity);
        return;
      }
      if (current.currentQuantity !== reviewedQuantity) {
        setReviewedQuantity(null);
        setError('The on-hand quantity changed. Review the updated amount before confirming.');
        return;
      }
      sent = true;
      await api.receiveStock({partId: selectedPart.id, storeId: selectedStore.id, quantity: units});
      setFinished(true);
      setNotice('Stock received.');
      try {
        const refreshed = await api.getInventory();
        await offlineStockStore.saveInventorySnapshot(user!.id, refreshed);
        const queue = await offlineStockStore.list(user!.id);
        setInventorySnapshot(applyQueuedStockCounts(refreshed, queue));
      } catch {
        setNotice('Stock was saved. Refresh inventory to see the current balance. Do not submit it again.');
      }
    } catch (reason) {
      const uncertain = sent && (!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500);
      if (uncertain) {
        setFinished(true);
        setError('The result could not be confirmed. Check inventory before trying again.');
      } else {
        setReviewedQuantity(null);
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
          await api.clearSession();
          clearInventorySnapshot();
          router.replace('/');
        } else setError(reason instanceof TypeError ? 'Connect to the server to review and receive stock.' : messageFor(reason));
      }
    } finally { locked.current = false; setSaving(false); }
  }

  function openInventory() {
    if (!selectedPart || !selectedStore) { router.replace('/'); return; }
    router.replace({pathname: '/', params: {storeId: String(selectedStore.id), query: selectedPart.partNumber}});
  }

  const visibleParts = matchingParts.slice(0, MAX_RESULTS);
  const visibleStores = matchingStores.slice(0, MAX_RESULTS);

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>Receive stock</Text>
        <Text style={styles.body}>Add a part to a store, including a new stock line. Connection required.</Text>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!!notice && <Text accessibilityRole="alert" style={styles.success}>{notice}</Text>}
        {loading ? <View style={styles.loading}><ActivityIndicator color={palette.navy} /><Text style={styles.body}>Loading parts and stores…</Text></View> : finished ? <View style={styles.card}>
          <Text style={styles.heading}>{error ? 'Check before retrying' : 'Receipt complete'}</Text>
          <Text style={styles.body}>{selectedPart?.partNumber} · {selectedPart?.description}</Text>
          <Text style={styles.body}>{selectedStore?.name} · {quantity} units</Text>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" onPress={openInventory} style={styles.primary}><Text style={styles.primaryText}>View inventory</Text></Pressable>
        </View> : <>
          {reviewedQuantity === null ? <>
            <View style={styles.section}>
              <Text style={styles.label}>1 · Find part</Text>
              <TextInput accessibilityLabel="Search parts" placeholder="Part number or description" value={selectedPart ? `${selectedPart.partNumber} · ${selectedPart.description}` : partQuery}
                onFocus={() => {if (selectedPart) {setSelectedPart(null); setPartQuery('');}}} onChangeText={value => {setSelectedPart(null); setPartQuery(value);}}
                style={styles.input} autoCorrect={false} editable={!saving} />
              {!selectedPart && <>
                {visibleParts.map(part => <Pressable key={part.id} accessibilityRole="radio" accessibilityLabel={`${part.partNumber}, ${part.description}`} accessibilityState={{checked: false}} disabled={saving} onPress={() => {setSelectedPart(part); setPartQuery('');}}
                  style={styles.option}><Text style={styles.optionTitle}>{part.partNumber}</Text><Text style={styles.optionBody} numberOfLines={2}>{part.description}</Text></Pressable>)}
                {matchingParts.length > MAX_RESULTS && <Text style={styles.hint}>Showing 20 matches. Add more detail to narrow the list.</Text>}
                {matchingParts.length === 0 && <Text style={styles.hint}>No matching parts.</Text>}
              </>}
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>2 · Choose store</Text>
              <TextInput accessibilityLabel="Search accessible stores" placeholder="Store name or location" value={selectedStore ? selectedStore.name : storeQuery}
                onFocus={() => {if (selectedStore) {setSelectedStore(null); setStoreQuery('');}}} onChangeText={value => {setSelectedStore(null); setStoreQuery(value);}}
                style={styles.input} autoCorrect={false} editable={!saving} />
              {!selectedStore && <>
                {visibleStores.map(store => <Pressable key={store.id} accessibilityRole="radio" accessibilityLabel={store.name} accessibilityState={{checked: false}} disabled={saving} onPress={() => {setSelectedStore(store); setStoreQuery('');}}
                  style={styles.option}><Text style={styles.optionTitle}>{store.name}</Text>{!!store.location && <Text style={styles.optionBody}>{store.location}</Text>}</Pressable>)}
                {matchingStores.length > MAX_RESULTS && <Text style={styles.hint}>Showing 20 matches. Add more detail to narrow the list.</Text>}
                {availableStores.length === 0 && <Text style={styles.hint}>No stores are available to your account for stock receiving.</Text>}
                {availableStores.length > 0 && matchingStores.length === 0 && <Text style={styles.hint}>No matching stores.</Text>}
              </>}
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>3 · Quantity to receive</Text>
              <TextInput accessibilityLabel="Quantity to receive" placeholder="0" value={quantity} onChangeText={value => {setQuantity(value.replace(/[^\d]/g, '')); setError('');}}
                style={[styles.input, styles.quantity]} keyboardType="number-pad" editable={!saving} />
              <Text style={styles.hint}>Whole units only. The current balance is checked before confirmation.</Text>
            </View>
          </> : <View style={styles.card}>
            <Text style={styles.heading}>Review receipt</Text>
            <Text style={styles.label}>{selectedPart?.partNumber}</Text>
            <Text style={styles.body}>{selectedPart?.description}</Text>
            <Text style={styles.label}>Store</Text><Text style={styles.body}>{selectedStore?.name}</Text>
            <Text style={styles.label}>New receipt</Text><Text style={styles.body}>+{units} units</Text>
            <Text style={styles.label}>On hand</Text><Text style={styles.balance}>{reviewedQuantity} → {reviewedQuantity + units}</Text>
            <Text style={styles.hint}>Confirm only after checking the part, destination and physical quantity.</Text>
          </View>}
          <Pressable accessibilityRole="button" disabled={saving || !selectedPart || !selectedStore} onPress={() => void continueFlow()} style={[styles.primary, (saving || !selectedPart || !selectedStore) && styles.disabled]}>
            <Text style={styles.primaryText}>{saving ? 'Checking…' : reviewedQuantity === null ? 'Review receipt' : 'Confirm receipt'}</Text>
          </Pressable>
          {reviewedQuantity !== null && <Pressable accessibilityRole="button" disabled={saving} onPress={() => setReviewedQuantity(null)} style={styles.secondary}><Text style={styles.secondaryText}>Edit details</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => router.back()} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        </>}
      </ScrollView>
      <AppBottomNavigation active="more" />
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: palette.background}, screen: {flex: 1}, content: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 12},
  title: {fontSize: 25, lineHeight: 32, fontWeight: '800', color: palette.navy}, heading: {fontSize: 19, lineHeight: 25, fontWeight: '800', color: palette.navy},
  body: {fontSize: 14, lineHeight: 20, color: palette.slate}, label: {fontSize: 15, lineHeight: 21, fontWeight: '700', color: palette.navy},
  section: {gap: 9, padding: 14, backgroundColor: palette.white, borderColor: palette.border, borderWidth: 1, borderRadius: 14},
  input: {minHeight: 50, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: palette.white, borderColor: palette.border, borderWidth: 1, borderRadius: 10, color: palette.navy, fontSize: 16},
  quantity: {fontSize: 24, fontWeight: '700'}, option: {minHeight: 54, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: palette.background, gap: 2},
  optionTitle: {fontSize: 14, fontWeight: '700', color: palette.navy}, optionBody: {fontSize: 13, lineHeight: 18, color: palette.slate},
  hint: {fontSize: 12, lineHeight: 17, color: palette.slate}, loading: {minHeight: 160, justifyContent: 'center', alignItems: 'center', gap: 10},
  card: {padding: 16, gap: 10, backgroundColor: palette.white, borderColor: palette.border, borderWidth: 1, borderRadius: 14},
  primary: {minHeight: 52, justifyContent: 'center', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: palette.amber}, primaryText: {fontSize: 16, fontWeight: '800', color: palette.navy},
  secondary: {minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 11, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white}, secondaryText: {fontSize: 15, fontWeight: '700', color: palette.navy},
  balance: {fontSize: 22, lineHeight: 29, fontWeight: '800', color: palette.navy}, error: {fontSize: 14, lineHeight: 20, fontWeight: '600', color: palette.red}, success: {fontSize: 14, lineHeight: 20, fontWeight: '700', color: palette.green},
  disabled: {opacity: 0.55},
});
