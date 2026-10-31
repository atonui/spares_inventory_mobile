import {useCallback, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useRouter} from 'expo-router';
import {api} from '../api/runtime';
import {ApiError} from '../api/client';
import type {PendingTransfer} from '../api/transferContract';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {clearInventorySnapshot, setInventorySnapshot} from '../features/inventory/inventorySnapshot';

type Confirmation = {transfer: PendingTransfer; action: 'receive' | 'return'};

function isNetworkFailure(reason: unknown) {
  return reason instanceof TypeError || (reason instanceof ApiError && reason.status === 0);
}

function formatSavedAge(savedAt: number) {
  const minutes = Math.floor(Math.max(0, Date.now() - savedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export default function TransfersScreen() {
  const router = useRouter();
  const [transfers, setTransfers] = useState<PendingTransfer[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offlineSavedAt, setOfflineSavedAt] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(''); setOfflineSavedAt(null); setNotice('');
    try {
      const user = await api.getMe();
      const rows = await api.getPendingTransfers();
      try { await offlineStockStore.savePendingTransfers(user.id, rows); }
      catch { /* Cache failures must not block current transfers. */ }
      if (request === generation.current) {setUserId(user.id); setTransfers(rows);}
    } catch (reason) {
      if (request !== generation.current) return;
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession(); clearInventorySnapshot(); setTransfers([]); router.replace('/');
      } else if (isNetworkFailure(reason)) {
        try {
          const activeUserId = await offlineStockStore.getActiveUserId();
          const cached = activeUserId === null ? null : await offlineStockStore.loadPendingTransfers(activeUserId);
          if (request !== generation.current) return;
          if (activeUserId !== null && cached !== null) {
            setUserId(activeUserId);
            setTransfers(cached.rows);
            setOfflineSavedAt(cached.savedAt);
            setNotice(`Offline · Saved transfer list from ${formatSavedAge(cached.savedAt)}. Actions are disabled until you reconnect.${cached.rows.length === 500 ? ' Showing the 500 most recent transfers.' : ''}`);
          } else {
            setError('Could not reach the server, and no saved transfer list is available on this device.');
          }
        } catch {setError('Could not reach the server, and no saved transfer list is available on this device.');}
      } else setError(reason instanceof ApiError ? reason.message : 'Could not refresh transfers. Connect to the server and retry.');
    } finally {if (request === generation.current) setLoading(false);}
  }, [router]);

  useFocusEffect(useCallback(() => {void load(); return () => {generation.current++;};}, [load]));

  async function confirm() {
    if (!confirmation || locked.current || userId === null) return;
    locked.current = true; setSaving(true); setError(''); setNotice('');
    let sent = false;
    try {
      const user = await api.getMe();
      if (user.id !== userId) throw new Error('Account changed. Refresh transfers before continuing.');
      if ((await offlineStockStore.list(user.id)).length) throw new Error('Sync or resolve your offline counts before confirming a transfer.');
      const current = (await api.getPendingTransfers()).find(row => row.id === confirmation.transfer.id);
      const previous = confirmation.transfer;
      if (!current || current.quantity !== previous.quantity || current.fromStoreId !== previous.fromStoreId || current.toStoreId !== previous.toStoreId ||
        !(confirmation.action === 'receive' ? current.canReceive : current.canReturn)) throw new Error('This transfer changed or your permission was removed. Refresh transfers.');
      sent = true;
      await api.completeTransfer(current.id, confirmation.action);
      const remainingTransfers = transfers.filter(row => row.id !== current.id);
      setTransfers(remainingTransfers);
      try { await offlineStockStore.savePendingTransfers(user.id, remainingTransfers); }
      catch { /* The live action is confirmed even if the local view cannot be refreshed. */ }
      setConfirmation(null);
      setNotice(confirmation.action === 'receive' ? 'Receipt confirmed. Stock is available at the destination.' : 'Return confirmed. Stock is available at the source store.');
      try {
        const rows = await api.getInventory();
        await offlineStockStore.saveInventorySnapshot(user.id, rows);
        setInventorySnapshot(rows);
      } catch {clearInventorySnapshot(); setNotice('Transfer saved. Refresh inventory to see the updated stock.');}
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession(); clearInventorySnapshot(); setTransfers([]); setConfirmation(null); router.replace('/');
      } else {
        const uncertain = sent && (!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500);
        setError(uncertain ? 'The result could not be confirmed. Refresh transfers to check its status before trying again.' : reason instanceof TypeError ? 'Connect to the server and refresh transfers.' : reason instanceof Error ? reason.message : 'Could not confirm transfer. Refresh and try again.');
        setConfirmation(null);
      }
    } finally {locked.current = false; setSaving(false);}
  }

  return <SafeAreaView style={styles.safe}><View style={styles.screen}>
    <Text accessibilityRole="header" style={styles.title}>Transfers</Text>
    <Text style={styles.body}>In transit · confirm only after stock physically arrives or returns.</Text>
    {!!notice && <Text accessibilityRole="alert" style={styles.body}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={loading || saving} onPress={() => void load()} style={styles.button}><Text style={styles.label}>Refresh transfers</Text></Pressable>
    {loading && transfers.length === 0 ? <ActivityIndicator accessibilityLabel="Loading transfers" color="#15263B" /> : <FlatList
      data={transfers} keyExtractor={row => String(row.id)} contentContainerStyle={styles.list}
      refreshing={loading} onRefresh={() => {if (!saving) void load();}}
      ListEmptyComponent={!error && !loading ? <View style={styles.card}><Text style={styles.label}>No pending transfers</Text><Text style={styles.body}>Open an item in Inventory to dispatch stock to another store.</Text></View> : undefined}
      renderItem={({item}) => <View style={styles.card}>
        <Text style={styles.label}>{item.partNumber} · {item.quantity} units</Text><Text style={styles.body}>{item.description}</Text>
        <Text style={styles.body}>From: {item.fromStoreName}</Text><Text style={styles.body}>To: {item.toStoreName}</Text>
        <Text style={styles.body}>{new Date(item.createdAt).toLocaleString()}</Text>
        <View style={styles.actions}>
          {!offlineSavedAt && item.canReceive && <Pressable accessibilityRole="button" accessibilityLabel={`Receive transfer ${item.id}`} disabled={loading || saving || !!error} style={styles.button} onPress={() => setConfirmation({transfer: item, action: 'receive'})}><Text style={styles.label}>Receive</Text></Pressable>}
          {!offlineSavedAt && item.canReturn && <Pressable accessibilityRole="button" accessibilityLabel={`Return transfer ${item.id}`} disabled={loading || saving || !!error} style={styles.button} onPress={() => setConfirmation({transfer: item, action: 'return'})}><Text style={styles.label}>Return to source</Text></Pressable>}
          {offlineSavedAt !== null && <Text style={styles.body}>Reconnect to confirm receipt or return.</Text>}
          {!offlineSavedAt && !item.canReceive && !item.canReturn && <Text style={styles.body}>Awaiting confirmation by an authorized user.</Text>}
        </View>
      </View>} />}
    <AppBottomNavigation active="more" />
    <Modal transparent visible={confirmation !== null} animationType="fade" onRequestClose={() => {if (!saving) setConfirmation(null);}}>
      <View style={styles.backdrop}><View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>{confirmation?.action === 'receive' ? 'Confirm receipt' : 'Confirm return'}</Text>
        <Text style={styles.label}>{confirmation?.transfer.partNumber} · {confirmation?.transfer.quantity} units</Text>
        <Text style={styles.body}>From: {confirmation?.transfer.fromStoreName}</Text><Text style={styles.body}>To: {confirmation?.transfer.toStoreName}</Text>
        <Text style={styles.body}>{confirmation?.action === 'receive' ? `Confirm these units physically arrived at ${confirmation.transfer.toStoreName}.` : `Confirm these units physically returned to ${confirmation?.transfer.fromStoreName}.`}</Text>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => void confirm()} style={styles.primary}><Text style={styles.label}>{saving ? 'Saving…' : 'Confirm physical stock'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => setConfirmation(null)} style={styles.button}><Text style={styles.label}>Cancel</Text></Pressable>
      </View></View>
    </Modal>
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F5F7FA'}, screen: {flex: 1, paddingHorizontal: 16, gap: 12},
  title: {fontSize: 24, lineHeight: 30, color: '#15263B', fontWeight: '700', marginTop: 8},
  body: {fontSize: 14, lineHeight: 21, color: '#64748B'}, label: {fontSize: 16, lineHeight: 24, color: '#15263B', fontWeight: '600'},
  error: {fontSize: 14, lineHeight: 21, color: '#A13A32'}, list: {gap: 12, paddingBottom: 24},
  card: {backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1', padding: 16, gap: 10},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  button: {minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center'},
  primary: {minHeight: 48, padding: 12, borderRadius: 10, backgroundColor: '#E9A23B', alignItems: 'center'},
  backdrop: {flex: 1, justifyContent: 'center', backgroundColor: 'rgba(21,38,59,0.4)', padding: 20},
});
