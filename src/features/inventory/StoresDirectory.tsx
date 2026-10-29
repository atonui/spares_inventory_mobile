import {FlatList, Pressable, RefreshControl, StyleSheet, Text, View} from 'react-native';
import type {InventoryItem} from './inventoryRepository';
import {AppIcon} from '../navigation/AppIcon';

export function summarizeStores(items: InventoryItem[]) {
  const stores = new Map<number, {id: number; name: string; type: string; items: number; low: number; out: number}>();
  for (const item of items) {
    const store = stores.get(item.storeId) ?? {id: item.storeId, name: item.storeName, type: item.storeType, items: 0, low: 0, out: 0};
    store.items += 1;
    if (item.quantity === 0) store.out += 1;
    else if (item.quantity <= item.minThreshold) store.low += 1;
    stores.set(store.id, store);
  }
  return [...stores.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export function StoresDirectory({items, search, refreshing, onRefresh, onSelect}: {
  items: InventoryItem[]; search: string; refreshing: boolean; onRefresh: () => void; onSelect: (id: number) => void;
}) {
  const query = search.trim().toLocaleLowerCase();
  const stores = summarizeStores(items).filter(store => `${store.name} ${store.type}`.toLocaleLowerCase().includes(query));
  return <FlatList data={stores} keyExtractor={store => String(store.id)}
    contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#15263B" />}
    ListHeaderComponent={<Text style={styles.note}>Stores represented in your accessible inventory. Empty stores are not included.</Text>}
    ListEmptyComponent={<View style={styles.empty}><Text style={styles.title}>{query ? 'No matching stores' : 'No stores to show'}</Text><Text style={styles.note}>{query ? 'Try another store name.' : 'Pull down to refresh your accessible inventory.'}</Text></View>}
    renderItem={({item}) => <Pressable accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.items} stock lines, ${item.low} low stock, ${item.out} out of stock. Open store inventory.`}
      onPress={() => onSelect(item.id)} style={({pressed}) => [styles.card, pressed && {opacity: 0.7}]}>
      <View style={styles.heading}><View style={styles.copy}><Text style={styles.title}>{item.name}</Text><Text style={styles.note}>{item.type.replaceAll('_', ' ')} · {item.items} stock {item.items === 1 ? 'line' : 'lines'}</Text></View><AppIcon name="chevronRight" color="#64748B" size={20} /></View>
      <View style={styles.status}><Text style={item.low ? styles.warning : styles.note}>{item.low} low stock</Text><Text style={item.out ? styles.error : styles.note}>{item.out} out of stock</Text></View>
    </Pressable>} />;
}

const styles = StyleSheet.create({
  list: {paddingVertical: 16, gap: 12, paddingBottom: 24},
  card: {padding: 16, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, backgroundColor: '#FFFFFF', gap: 12, minHeight: 100},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 12},
  copy: {flex: 1, gap: 4},
  title: {fontSize: 18, fontWeight: '700', color: '#15263B'},
  note: {fontSize: 14, lineHeight: 20, color: '#64748B'},
  status: {flexDirection: 'row', flexWrap: 'wrap', gap: 16},
  warning: {fontSize: 14, lineHeight: 20, color: '#8A5A0A', fontWeight: '600'},
  error: {fontSize: 14, lineHeight: 20, color: '#A13A32', fontWeight: '600'},
  empty: {paddingVertical: 32, gap: 8},
});
