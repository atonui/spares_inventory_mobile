import {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {ApiError, type InventoryRow, type StockMovement} from '../../api/client';
import {api, isMockMode} from '../../api/runtime';

const palette = {navy: '#15263B', slate: '#64748B', border: '#CBD5E1', white: '#FFFFFF', background: '#F5F7FA', red: '#A13A32'};
const HISTORY_LIMIT = 20;

function movementLabel(value: string): string {
  const labels: Record<string, string> = {
    add: 'Stock received', remove: 'Stock count reduced', consume: 'Stock issued', transfer: 'Transfer',
    return: 'Transfer returned', adjustment: 'Stock count changed',
  };
  return labels[value] ?? value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toLocaleUpperCase());
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
}

function transferLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toLocaleUpperCase());
}

export function StockMovementHistory({item, refreshKey = 0}: {item: InventoryRow; refreshKey?: number}) {
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.getMovements({partId: item.partId, storeId: item.storeId, limit: HISTORY_LIMIT});
      if (request === requestId.current) setRows(result);
    } catch (reason) {
      if (request === requestId.current) {
        if (reason instanceof ApiError || (isMockMode && reason instanceof Error)) setError(reason.message);
        else setError('Connect to the server to load recent activity.');
      }
    } finally { if (request === requestId.current) setLoading(false); }
  }, [item.partId, item.storeId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? load() : undefined);
    return () => { active = false; };
  }, [load, refreshKey]);

  return <View style={styles.card}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text accessibilityRole="header" style={styles.title}>Recent activity</Text>
        <Text style={styles.caption}>Last {HISTORY_LIMIT} movements for this part at this store</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh recent activity" disabled={loading} onPress={() => void load()} style={styles.refresh}>
        <Text style={styles.refreshText}>{loading ? 'Loading' : 'Refresh'}</Text>
      </Pressable>
    </View>
    {loading && rows.length === 0 ? <Text style={styles.body}>Loading activity…</Text> : null}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!loading && !error && rows.length === 0 && <Text style={styles.body}>No stock movements recorded for this item and store yet.</Text>}
    {rows.map((movement, index) => <View key={movement.id} style={[styles.entry, index === 0 && styles.firstEntry]}>
      <View style={styles.entryHeading}>
        <Text style={styles.entryTitle}>{movementLabel(movement.movementType)}</Text>
        <Text style={styles.quantity}>{movement.quantity} {movement.quantity === 1 ? 'unit' : 'units'}</Text>
      </View>
      <Text style={styles.body}>{displayDate(movement.createdAt)} · {movement.createdByName}</Text>
      {(movement.fromStoreName || movement.toStoreName) && <Text style={styles.body}>
        {movement.fromStoreName ? `From ${movement.fromStoreName}` : ''}{movement.fromStoreName && movement.toStoreName ? '  ·  ' : ''}{movement.toStoreName ? `To ${movement.toStoreName}` : ''}
      </Text>}
      {movement.workOrder && <Text style={styles.body}>Work order · {movement.workOrder}</Text>}
      {movement.transferStatus && <Text style={styles.status}>{transferLabel(movement.transferStatus)}{movement.completedByName ? ` · ${movement.completedByName}` : ''}{movement.completedAt ? ` · ${displayDate(movement.completedAt)}` : ''}</Text>}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: {padding: 16, gap: 10, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12}, headerCopy: {flex: 1},
  title: {fontSize: 15, fontWeight: '800', color: palette.navy}, caption: {marginTop: 3, fontSize: 12, lineHeight: 17, color: palette.slate},
  refresh: {minHeight: 40, minWidth: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 9},
  refreshText: {fontSize: 13, fontWeight: '700', color: palette.navy},
  entry: {paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E8EDF2', gap: 4}, firstEntry: {marginTop: 2},
  entryHeading: {flexDirection: 'row', justifyContent: 'space-between', gap: 10}, entryTitle: {flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700', color: palette.navy},
  quantity: {fontSize: 14, lineHeight: 20, fontWeight: '800', color: palette.navy},
  body: {fontSize: 12, lineHeight: 17, color: palette.slate}, status: {fontSize: 12, lineHeight: 17, fontWeight: '700', color: palette.navy},
  error: {fontSize: 13, lineHeight: 19, color: palette.red},
});
