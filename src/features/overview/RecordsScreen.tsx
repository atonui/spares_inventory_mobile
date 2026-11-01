import {useCallback, useMemo, useState} from 'react';
import {FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useRouter} from 'expo-router';
import {api, isMockMode} from '../../api/runtime';
import {ApiError} from '../../api/client';
import type {EquipmentRecord, PartRecord, StoreDestination} from '../../api/transferContract';
import type {InventoryItem} from '../inventory/inventoryRepository';
import {applyQueuedStockCounts} from '../inventory/offlineStockQueue';
import {getInventorySnapshot} from '../inventory/inventorySnapshot';
import {offlineStockStore} from '../inventory/offlineStockStore';
import {AppBottomNavigation} from '../navigation/AppBottomNavigation';
import {AppIcon} from '../navigation/AppIcon';

type DirectoryKind = 'parts' | 'stores' | 'equipment' | 'my-parts';
type RecordRow = {id: string; title: string; detail: string; meta: string; query?: string; storeId?: number};
const copy: Record<DirectoryKind, {title: string; description: string; empty: string}> = {
  parts: {title: 'Total parts', description: 'Browse the parts catalog.', empty: 'No parts are available.'},
  stores: {title: 'Active stores', description: 'Browse active stores, including empty locations.', empty: 'No active stores are available.'},
  equipment: {title: 'My equipment', description: 'Equipment assigned to your account.', empty: 'No equipment is assigned to you.'},
  'my-parts': {title: 'My parts', description: 'Parts held at stores assigned to you.', empty: 'No parts are assigned to your stores.'},
};
const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', muted: '#475569', background: '#F5F7FA', white: '#FFFFFF', border: '#D6DEE8', error: '#A13A32', errorBackground: '#FCE8E6'};

function isNetworkFailure(reason: unknown): boolean {
  return reason instanceof TypeError || (reason instanceof ApiError && reason.status === 0);
}

function formatSavedAge(savedAt: number | null): string | null {
  if (savedAt === null) return null;
  const minutes = Math.floor(Math.max(0, Date.now() - savedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(savedAt).toLocaleDateString();
}

async function offlineDirectoryNotice(userId: number, directory: 'parts' | 'stores' | 'equipment', message: string) {
  let savedAt: number | null = null;
  try { savedAt = await offlineStockStore.getDirectorySavedAt(userId, directory); }
  catch { /* Keep the saved directory visible when its freshness marker is unavailable. */ }
  const age = formatSavedAge(savedAt);
  return age ? `${message} Last refreshed ${age}.` : message;
}

function makeRows(kind: DirectoryKind, input: {parts?: PartRecord[]; stores?: StoreDestination[]; equipment?: EquipmentRecord[]; inventory?: InventoryItem[]; userId?: number}): RecordRow[] {
  if (kind === 'parts') return (input.parts ?? []).map(part => ({id: String(part.id), title: part.partNumber, detail: part.description, meta: part.category || 'Uncategorised', query: part.partNumber}));
  if (kind === 'stores') return (input.stores ?? []).map(store => ({id: String(store.id), title: store.name, detail: store.location || store.type.replaceAll('_', ' '), meta: store.type.replaceAll('_', ' '), storeId: store.id}));
  if (kind === 'equipment') return (input.equipment ?? []).filter(item => item.assignedUserId === input.userId).map(item => ({
    id: String(item.id), title: item.name, detail: [item.make, item.model].filter(Boolean).join(' ') || 'Equipment',
    meta: [item.serialNumber ? `S/N ${item.serialNumber}` : '', item.nextCalibrationDate ? `Calibration ${item.nextCalibrationDate}` : ''].filter(Boolean).join(' · ') || 'Assigned to you',
  }));

  const mine = (input.inventory ?? []).filter(row => row.storeOwner === input.userId);
  const parts = new Map<number, {row: InventoryItem; quantity: number; stores: Set<string>}>();
  for (const row of mine) {
    const part = parts.get(row.partId) ?? {row, quantity: 0, stores: new Set<string>()};
    part.quantity += row.quantity;
    part.stores.add(row.storeName);
    parts.set(row.partId, part);
  }
  return [...parts.values()].map(({row, quantity, stores}) => ({id: String(row.partId), title: row.partNumber, detail: row.description,
    meta: `${quantity} ${quantity === 1 ? 'unit' : 'units'} · ${stores.size} ${stores.size === 1 ? 'store' : 'stores'}`, query: row.partNumber}));
}

export function RecordsScreen({kind}: {kind: DirectoryKind}) {
  const router = useRouter();
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categorySheetVisible, setCategorySheetVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [offlineNotice, setOfflineNotice] = useState('');
  const heading = copy[kind];

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError('');
    setOfflineNotice('');
    try {
      let next: RecordRow[];
      if (kind === 'parts') {
        const [user, parts] = await Promise.all([api.getMe(), api.getParts()]);
        try { await offlineStockStore.savePartCatalog(user.id, parts); }
        catch { /* A local cache failure must not hide the live parts catalog. */ }
        next = makeRows(kind, {parts});
      }
      else if (kind === 'stores') {
        const [user, stores] = await Promise.all([api.getMe(), api.getStores()]);
        try { await offlineStockStore.saveStoreDirectory(user.id, stores); }
        catch { /* A local cache failure must not hide the live store directory. */ }
        next = makeRows(kind, {stores});
      }
      else if (kind === 'equipment') {
        const [user, equipment] = await Promise.all([api.getMe(), api.getEquipment()]);
        const assigned = equipment.filter(item => item.assignedUserId === user.id);
        try { await offlineStockStore.saveEquipmentDirectory(user.id, assigned); }
        catch { /* A local cache failure must not hide assigned equipment. */ }
        next = makeRows(kind, {equipment: assigned, userId: user.id});
      } else {
        const [user, inventory] = await Promise.all([api.getMe(), api.getInventory()]);
        next = makeRows(kind, {inventory, userId: user.id});
      }
      setRows(next);
    } catch (reason) {
      if (!isNetworkFailure(reason)) {
        setError(reason instanceof ApiError || (isMockMode && reason instanceof Error)
          ? reason.message : 'Could not reach the server. Check your connection and try again.');
        return;
      }
      try {
        const userId = await offlineStockStore.getActiveUserId();
        if (userId === null) throw new Error('No saved store directory or inventory is available.');
        if (kind === 'parts') {
          const savedParts = await offlineStockStore.loadPartCatalog(userId);
          if (savedParts !== null) {
            setRows(makeRows(kind, {parts: savedParts}));
            setOfflineNotice(await offlineDirectoryNotice(userId, 'parts', 'Offline · Showing your last saved parts catalog.'));
            return;
          }
        } else if (kind === 'equipment') {
          const savedEquipment = await offlineStockStore.loadEquipmentDirectory(userId);
          if (savedEquipment !== null) {
            setRows(makeRows(kind, {equipment: savedEquipment, userId}));
            setOfflineNotice(await offlineDirectoryNotice(userId, 'equipment', 'Offline · Showing equipment assigned to you from your last saved directory.'));
            return;
          }
          setError('Equipment is not saved on this device yet. Connect and open this directory to make it available offline.');
          return;
        }
        if (kind === 'stores') {
          const savedStores = await offlineStockStore.loadStoreDirectory(userId);
          if (savedStores !== null) {
            setRows(makeRows(kind, {stores: savedStores}));
            setOfflineNotice(await offlineDirectoryNotice(userId, 'stores', 'Offline · Showing your last saved store directory, including empty stores.'));
            return;
          }
        }
        const [savedRows, queue] = await Promise.all([
          offlineStockStore.loadInventorySnapshot(userId), offlineStockStore.list(userId),
        ]);
        const snapshot = getInventorySnapshot() ?? savedRows;
        if (snapshot === null) throw new Error('No saved inventory is available.');
        const inventory = applyQueuedStockCounts(snapshot, queue);
        if (kind === 'my-parts') {
          setRows(makeRows(kind, {inventory, userId}));
          setOfflineNotice('Offline · Showing parts from your last saved inventory.');
        } else if (kind === 'parts') {
          const uniqueParts = [...new Map(inventory.map(row => [row.partId, {
            id: row.partId, partNumber: row.partNumber, description: row.description, category: 'Saved inventory',
          }])).values()];
          setRows(makeRows(kind, {parts: uniqueParts}));
          setOfflineNotice('Offline · Showing parts represented in saved inventory. The full catalog needs a connection.');
        } else {
          const stores = [...new Map(inventory.map(row => [row.storeId, {
            id: row.storeId, name: row.storeName, type: row.storeType, location: null,
          }])).values()];
          setRows(makeRows(kind, {stores}));
          setOfflineNotice('Offline · Showing stores represented in saved inventory. Open the store directory online once to save empty stores for offline use.');
        }
      } catch {
        setError('Could not reach the server, and no saved store directory or inventory is available on this device.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [kind]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const categories = useMemo(() => [...new Set(rows.map(row => row.meta).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, undefined, {numeric: true, sensitivity: 'base'})), [rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows
      .filter(row => selectedCategory === null || row.meta === selectedCategory)
      .filter(row => !query || `${row.title} ${row.detail} ${row.meta}`.toLocaleLowerCase().includes(query))
      .sort((first, second) => kind === 'parts'
        ? first.title.localeCompare(second.title, undefined, {numeric: true, sensitivity: 'base'})
        : 0);
  }, [rows, search, selectedCategory, kind]);

  const openRow = (row: RecordRow) => {
    if (row.storeId !== undefined) router.push({pathname: '/', params: {storeId: String(row.storeId), view: undefined, query: undefined, filter: undefined}});
    else if (row.query) router.push({pathname: '/', params: {query: row.query, view: undefined, storeId: undefined, filter: undefined}});
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to overview" onPress={() => router.push('/home')} style={styles.backButton}>
            <AppIcon name="chevronRight" color={palette.navy} size={20} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.title}>{heading.title}</Text>
          </View>
        </View>
        <FlatList
          data={filtered} keyExtractor={row => row.id} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {void load(true);}} tintColor={palette.navy} />}
          ListHeaderComponent={(
            <View style={styles.listHeader}>
              <Text style={styles.description}>{heading.description}</Text>
              {!!offlineNotice && <View accessibilityRole="summary" style={styles.offlineNotice}><Text style={styles.offlineNoticeText}>{offlineNotice}</Text></View>}
              <View style={styles.searchBox}>
                <AppIcon name="search" color={palette.slate} size={18} />
                <TextInput accessibilityLabel={`Search ${heading.title.toLocaleLowerCase()}`} value={search} onChangeText={setSearch}
                  placeholder={`Search ${heading.title.toLocaleLowerCase()}`} placeholderTextColor={palette.slate}
                  autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={styles.searchInput} />
              </View>
              {kind === 'parts' && categories.length > 1 && <Pressable accessibilityRole="button"
                accessibilityLabel={`Filter by category${selectedCategory ? `, selected ${selectedCategory}` : ''}`}
                accessibilityHint="Opens a list of part categories"
                onPress={() => setCategorySheetVisible(true)} style={[styles.categoryButton, selectedCategory !== null && styles.categoryButtonActive]}>
                <AppIcon name="filter" color={selectedCategory !== null ? palette.navy : palette.slate} size={16} />
                <Text numberOfLines={1} style={[styles.categoryButtonText, selectedCategory !== null && styles.categoryButtonTextActive]}>
                  {selectedCategory ?? 'All categories'}
                </Text>
                <AppIcon name="chevronRight" color={palette.slate} size={15} />
              </Pressable>}
              {!loading && !error && <Text accessibilityRole="text" style={styles.resultCount}>{filtered.length} {filtered.length === 1 ? 'record' : 'records'}{offlineNotice ? ' · saved on this device' : ''}</Text>}
            </View>
          )}
          ListEmptyComponent={loading ? (
            <View accessibilityLabel={`Loading ${heading.title.toLocaleLowerCase()}`} style={styles.loadingList}>
              <View style={styles.loadingRow} /><View style={styles.loadingRow} /><View style={styles.loadingRow} />
            </View>
          ) : error ? (
            <View style={styles.emptyState}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => {void load();}} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{search.trim() || selectedCategory ? 'No matching records' : heading.empty}</Text>
              {(search.trim() || selectedCategory) && <Text style={styles.description}>Try another search or category.</Text>}
            </View>
          )}
          renderItem={({item}) => (
            <Pressable accessibilityRole={item.storeId !== undefined || item.query ? 'button' : undefined}
              accessibilityLabel={`${item.title}. ${item.detail}. ${item.meta}${item.storeId !== undefined || item.query ? '. Open related inventory.' : ''}`}
              onPress={item.storeId !== undefined || item.query ? () => openRow(item) : undefined}
              style={({pressed}) => [styles.recordCard, pressed && styles.recordPressed]}>
              <View style={styles.recordIcon}><AppIcon name={kind === 'stores' ? 'store' : kind === 'equipment' ? 'equipment' : 'inventory'} color={palette.navy} size={19} /></View>
              <View style={styles.recordCopy}>
                <Text numberOfLines={1} style={styles.recordTitle}>{item.title}</Text>
                <Text numberOfLines={2} style={styles.recordDetail}>{item.detail}</Text>
                <Text numberOfLines={1} style={styles.recordMeta}>{item.meta}</Text>
              </View>
              {(item.storeId !== undefined || item.query) && <AppIcon name="chevronRight" color={palette.slate} size={18} />}
            </Pressable>
          )}
        />
      </View>
      <AppBottomNavigation active="inventory" />
      <Modal transparent visible={categorySheetVisible} animationType="fade" onRequestClose={() => setCategorySheetVisible(false)}>
        <View style={styles.categoryBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close category filter" onPress={() => setCategorySheetVisible(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.categorySheet}>
            <View style={styles.categorySheetHeader}>
              <View><Text accessibilityRole="header" style={styles.categorySheetTitle}>Part category</Text><Text style={styles.categorySheetSubtitle}>Narrow the catalog list.</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close category filter" onPress={() => setCategorySheetVisible(false)} style={styles.categoryClose}>
                <AppIcon name="close" color={palette.slate} size={19} />
              </Pressable>
            </View>
            <FlatList data={[null, ...categories]} keyExtractor={category => category ?? 'all-categories'}
              renderItem={({item: category}) => {
                const selected = category === selectedCategory;
                const count = category === null ? rows.length : rows.filter(row => row.meta === category).length;
                return <Pressable accessibilityRole="radio" accessibilityLabel={`${category ?? 'All categories'}, ${count} parts`}
                  accessibilityState={{checked: selected}} onPress={() => {setSelectedCategory(category); setCategorySheetVisible(false);}}
                  style={[styles.categoryOption, selected && styles.categoryOptionSelected]}>
                  <View style={[styles.categoryRadio, selected && styles.categoryRadioSelected]}>{selected && <View style={styles.categoryRadioDot} />}</View>
                  <Text style={[styles.categoryOptionText, selected && styles.categoryOptionTextSelected]}>{category ?? 'All categories'}</Text>
                  <Text style={styles.categoryCount}>{count}</Text>
                </Pressable>;
              }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background}, screen: {flex: 1, paddingHorizontal: 16},
  header: {minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: -16, paddingHorizontal: 16, backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: '#E2E8F0'},
  backButton: {width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#F0F3F7', transform: [{rotate: '180deg'}]},
  headerCopy: {flex: 1}, brand: {fontSize: 11, fontWeight: '700', color: palette.slate}, title: {marginTop: 2, fontSize: 18, fontWeight: '800', color: palette.navy},
  listContent: {paddingBottom: 20}, listHeader: {paddingTop: 14, paddingBottom: 8}, description: {fontSize: 13, lineHeight: 19, color: palette.muted},
  offlineNotice: {marginTop: 10, padding: 11, borderRadius: 11, backgroundColor: '#FFF4DB'}, offlineNoticeText: {fontSize: 12, lineHeight: 17, color: '#8A5A0A'},
  searchBox: {minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  searchInput: {flex: 1, paddingVertical: 8, fontSize: 14, color: palette.navy}, resultCount: {marginTop: 12, fontSize: 11, fontWeight: '700', color: palette.slate},
  categoryButton: {minHeight: 42, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, marginTop: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 10, backgroundColor: palette.white},
  categoryButtonActive: {borderColor: '#A8B7C8', backgroundColor: '#EDF2F7'},
  categoryButtonText: {maxWidth: 220, fontSize: 13, fontWeight: '700', color: palette.slate},
  categoryButtonTextActive: {color: palette.navy},
  categoryBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,38,59,0.38)'},
  categorySheet: {maxHeight: '78%', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: palette.white},
  categorySheetHeader: {minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8},
  categorySheetTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  categorySheetSubtitle: {marginTop: 3, fontSize: 13, color: palette.slate},
  categoryClose: {width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.background},
  categoryOption: {minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, borderRadius: 10},
  categoryOptionSelected: {backgroundColor: '#FFF8EA'},
  categoryRadio: {width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: palette.slate, borderRadius: 10},
  categoryRadioSelected: {borderColor: palette.navy},
  categoryRadioDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: palette.navy},
  categoryOptionText: {flex: 1, fontSize: 14, fontWeight: '600', color: palette.muted},
  categoryOptionTextSelected: {fontWeight: '800', color: palette.navy},
  categoryCount: {minWidth: 28, fontSize: 12, textAlign: 'right', color: palette.slate},
  recordCard: {minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 8, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  recordPressed: {opacity: 0.72}, recordIcon: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#F0F3F7'},
  recordCopy: {flex: 1}, recordTitle: {fontSize: 14, fontWeight: '800', color: palette.navy}, recordDetail: {marginTop: 3, fontSize: 12, lineHeight: 17, color: palette.muted}, recordMeta: {marginTop: 4, fontSize: 11, color: palette.slate},
  emptyState: {alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 34}, emptyTitle: {fontSize: 15, fontWeight: '800', textAlign: 'center', color: palette.navy},
  loadingList: {gap: 8, paddingTop: 8}, loadingRow: {height: 84, borderRadius: 13, backgroundColor: '#E8EDF3'},
  errorText: {fontSize: 13, lineHeight: 19, textAlign: 'center', color: palette.error}, retryButton: {minHeight: 42, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 11, backgroundColor: palette.errorBackground}, retryText: {fontSize: 13, fontWeight: '800', color: palette.error},
});
