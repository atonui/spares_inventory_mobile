import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {api, isMockMode} from '../api/runtime';
import {ApiError, type InventoryRow, type NativeUser} from '../api/client';
import {sortInventory, type InventorySort} from '../features/inventory/inventorySort';

function responseMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isMockMode && error instanceof Error) return error.message;
  return 'Could not reach the server. Check your connection and try again.';
}

type InventoryFilter = 'all' | 'lowStock' | 'available' | 'allocated';

const inventoryFilterOptions: {value: InventoryFilter; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'lowStock', label: 'Low stock'},
  {value: 'available', label: 'Available'},
  {value: 'allocated', label: 'Allocated'},
];

const inventorySortOptions: {value: InventorySort; label: string}[] = [
  {value: 'default', label: 'Default'},
  {value: 'partNumber', label: 'Part number'},
  {value: 'lowestStock', label: 'Lowest stock'},
];

export default function InventoryScreen() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);
  const [user, setUser] = useState<NativeUser | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [search, setSearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('all');
  const [inventorySort, setInventorySort] = useState<InventorySort>('default');

  const loadInventory = useCallback(async () => {
    const rows = await api.getInventory();
    setInventory(rows);
  }, []);

  const restoreSession = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const savedSession = await api.getSession();
      if (!savedSession) {
        setHasSession(false);
        setUser(null);
        return;
      }
      setHasSession(true);
      const currentUser = await api.getMe();
      setUser(currentUser);
      await loadInventory();
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        setHasSession(false);
        setUser(null);
        setInventory([]);
        setError(reason.status === 401
          ? 'Your session expired. Please sign in again.'
          : 'This account does not have an active company membership.');
      } else {
        setError(responseMessage(reason));
      }
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }, [loadInventory]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (active) await restoreSession();
    });
    return () => { active = false; };
  }, [restoreSession]);

  async function signIn() {
    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setLoading(true);
    let issuedSession = false;
    try {
      const session = await api.login({email, password, rememberMe});
      await api.saveSession(session);
      issuedSession = true;
      setHasSession(true);
      setPassword('');
      const currentUser = await api.getMe();
      setUser(currentUser);
      await loadInventory();
    } catch (reason) {
      if (issuedSession && reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        setHasSession(false);
        setUser(null);
      }
      setError(responseMessage(reason));
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }

  async function signOut() {
    if (!hasSession) return;
    setError('');
    setLoading(true);
    try {
      const result = await api.logout();
      if (!result.success) throw new ApiError('The server could not confirm sign out.', 0);
      setHasSession(false);
      setUser(null);
      setInventory([]);
      setSearch('');
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        setHasSession(false);
        setUser(null);
        setInventory([]);
        setSearch('');
      }
      setError(`Sign out failed: ${responseMessage(reason)}`);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!hasSession) return;
    setRefreshing(true);
    setError('');
    try {
      await loadInventory();
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        setHasSession(false);
        setUser(null);
        setInventory([]);
        setError(reason.status === 401
          ? 'Your session expired. Please sign in again.'
          : 'This account does not have an active company membership.');
      } else {
        setError(responseMessage(reason));
      }
    } finally {
      setRefreshing(false);
    }
  }

  const visibleInventory = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = inventory.filter(row => {
      const matchesSearch = !query ||
        `${row.partNumber} ${row.description} ${row.storeName}`.toLocaleLowerCase().includes(query);
      const matchesFilter = inventoryFilter === 'all' ||
        (inventoryFilter === 'lowStock' && row.quantity <= row.minThreshold) ||
        (inventoryFilter === 'available' && !row.isAllocated) ||
        (inventoryFilter === 'allocated' && row.isAllocated);
      return matchesSearch && matchesFilter;
    });
    return sortInventory(filtered, inventorySort);
  }, [inventory, search, inventoryFilter, inventorySort]);

  if (!isReady || (loading && !user && hasSession)) {
    return <LoadingScreen message="Checking your session…" />;
  }

  if (user && hasSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screen}>
          <View style={styles.topBar}>
            <View style={styles.brandMark}><Image source={require('../../assets/android-icon-foreground.png')} style={styles.brandIcon} /></View>
            <View style={styles.brandCopy}>
              <Text style={styles.wordmark}>Spares Tracker</Text>
              <Text style={styles.pageTitle}>Inventory</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={signOut} disabled={loading} style={styles.signOutButton}>
              <Text style={styles.signOutText}>{loading ? '…' : 'Sign out'}</Text>
            </Pressable>
          </View>

          <View style={styles.welcomeRow}>
            <View>
              <Text style={styles.welcome}>Good to see you, {user.name.split(' ')[0]}</Text>
              <Text style={styles.muted}>{user.role.replaceAll('_', ' ')} · {isMockMode ? 'preview data' : 'live inventory'}</Text>
            </View>
            <View style={styles.totalBadge}>
              <Text style={styles.totalNumber}>{inventory.length}</Text>
              <Text style={styles.totalLabel}>LINES</Text>
            </View>
          </View>

          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              accessibilityLabel="Search inventory"
              value={search}
              onChangeText={setSearch}
              placeholder="Search part, description, or store"
              placeholderTextColor={palette.placeholder}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                accessibilityHint="Clears the inventory search"
                onPress={() => setSearch('')}
                style={styles.clearSearchButton}
                hitSlop={4}
              >
                <Text style={styles.clearSearchText}>×</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.filterRow} accessibilityRole="radiogroup" accessibilityLabel="Filter inventory">
            {inventoryFilterOptions.map(option => {
              const selected = inventoryFilter === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{checked: selected}}
                  onPress={() => setInventoryFilter(option.value)}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}
                >
                  <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sortSection}>
            <Text style={styles.sortLabel}>Sort by</Text>
            <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Sort inventory">
              {inventorySortOptions.map(option => {
                const selected = inventorySort === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{checked: selected}}
                    onPress={() => setInventorySort(option.value)}
                    style={[styles.sortChip, selected && styles.filterChipSelected]}
                  >
                    <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {!!error && <ErrorNotice message={error} onRetry={refresh} />}

          <FlatList
            data={visibleInventory}
            keyExtractor={row => String(row.id)}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.navy} />}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{search || inventoryFilter !== 'all' ? 'No matching stock' : 'No stock to show'}</Text>
                <Text style={styles.muted}>
                  {search || inventoryFilter !== 'all'
                    ? 'Try changing your search or filter.'
                    : 'Pull down to refresh your inventory.'}
                </Text>
              </View>
            }
            renderItem={({item: row}) => {
              const lowStock = row.quantity <= row.minThreshold;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${row.partNumber}, ${row.description}`}
                  accessibilityHint="Opens stock details"
                  onPress={() => router.push({pathname: '/inventory/[itemId]', params: {itemId: String(row.id)}})}
                  style={({pressed}) => [styles.stockCard, pressed && styles.stockCardPressed]}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.partNumber}>{row.partNumber}</Text>
                    <View style={[styles.quantityBadge, lowStock && styles.lowQuantityBadge]}>
                      <Text style={[styles.quantityValue, lowStock && styles.lowQuantityText]}>{row.quantity}</Text>
                      <Text style={[styles.quantityCaption, lowStock && styles.lowQuantityText]}>{lowStock ? 'LOW STOCK' : 'IN STOCK'}</Text>
                    </View>
                  </View>
                  <Text style={styles.description}>{row.description}</Text>
                  <View style={styles.cardFooter}>
                    <Text style={styles.storeName}>{row.storeName}</Text>
                    <Text style={styles.threshold}>Min. {row.minThreshold}</Text>
                  </View>
                  <View style={styles.statusRow}>
                    <Text style={row.isAllocated ? styles.allocatedStatus : styles.availableStatus}>
                      {row.isAllocated ? `Allocated${row.workOrder ? ` · ${row.workOrder}` : ''}` : 'Available'}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.loginScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.heroBrandRow}>
              <View style={styles.heroMark}><Image source={require('../../assets/android-icon-foreground.png')} style={styles.heroBrandIcon} /></View>
              <Text style={styles.heroWordmark}>Spares Tracker</Text>
            </View>
            <Text style={styles.heroLabel}>INVENTORY MANAGEMENT</Text>
            <Text style={styles.heroTitle}>Everything in its place.</Text>
            <Text style={styles.heroSubtitle}>Keep track of your stock, wherever the work takes you.</Text>
          </View>
          <View style={styles.loginCard}>
            <Text style={styles.loginTitle}>Welcome back</Text>
            <Text style={styles.loginSubtitle}>Sign in to manage your inventory.</Text>
            {!!error && <ErrorNotice message={error} onRetry={hasSession ? restoreSession : undefined} />}
            <Text style={styles.inputLabel}>Email address</Text>
            <TextInput
              accessibilityLabel="Email address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={palette.placeholder}
              style={styles.input}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!loading}
              returnKeyType="next"
            />
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={palette.placeholder}
              style={styles.input}
              autoCapitalize="none"
              autoComplete="password"
              secureTextEntry
              textContentType="password"
              editable={!loading}
              onSubmitEditing={signIn}
              returnKeyType="go"
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{checked: rememberMe}}
              onPress={() => setRememberMe(value => !value)}
              style={styles.rememberRow}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <Text style={styles.rememberText}>Stay signed in</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={signIn} disabled={loading} style={[styles.primaryButton, loading && styles.buttonDisabled]}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
            </Pressable>
            <Text style={styles.inviteNote}>Access is available by invitation from your organization.</Text>
            {isMockMode && <Text style={styles.previewNote}>Preview mode: any valid email and non-empty password will show sample inventory.</Text>}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LoadingScreen({message}: {message: string}) {
  return (
    <SafeAreaView style={[styles.safeArea, styles.loadingScreen]}>
      <ActivityIndicator size="large" color={palette.navy} />
      <Text style={styles.muted}>{message}</Text>
    </SafeAreaView>
  );
}

function ErrorNotice({message, onRetry}: {message: string; onRetry?: () => void}) {
  return (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && <Pressable onPress={() => void onRetry()}><Text style={styles.retryText}>Retry</Text></Pressable>}
    </View>
  );
}

const palette = {
  navy: '#15263B',
  amber: '#E9A23B',
  slate: '#64748B',
  background: '#F5F7FA',
  white: '#FFFFFF',
  text: '#15263B',
  muted: '#475569',
  placeholder: '#475569',
  border: '#CBD5E1',
  red: '#A13A32',
  redTint: '#FFF0EE',
};

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 20},
  topBar: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: palette.border},
  brandMark: {width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.navy},
  brandIcon: {width: 31, height: 31},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.navy},
  pageTitle: {fontSize: 13, fontWeight: '600', color: palette.muted},
  signOutButton: {paddingVertical: 10, paddingHorizontal: 12},
  signOutText: {fontWeight: '700', color: palette.navy},
  welcomeRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, paddingBottom: 16},
  welcome: {fontSize: 17, fontWeight: '700', color: palette.text},
  muted: {marginTop: 4, color: palette.muted, fontSize: 13},
  totalBadge: {minWidth: 56, alignItems: 'center', borderRadius: 12, backgroundColor: '#FEF3DF', paddingVertical: 7, paddingHorizontal: 9},
  totalNumber: {fontSize: 19, fontWeight: '800', color: palette.navy},
  totalLabel: {fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: palette.navy},
  searchBox: {height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, backgroundColor: palette.white, borderRadius: 13, borderWidth: 1, borderColor: palette.border},
  searchIcon: {fontSize: 24, color: palette.muted, transform: [{rotate: '-20deg'}]},
  searchInput: {flex: 1, paddingVertical: 10, fontSize: 14, color: palette.text},
  clearSearchButton: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  clearSearchText: {fontSize: 25, lineHeight: 29, color: palette.muted},
  filterRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10},
  filterChip: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: palette.border, borderRadius: 22, backgroundColor: palette.white},
  filterChipSelected: {borderColor: palette.amber, backgroundColor: palette.amber},
  filterLabel: {fontSize: 12, fontWeight: '700', color: palette.muted},
  filterLabelSelected: {color: palette.navy},
  sortSection: {marginTop: 11},
  sortLabel: {marginBottom: 6, fontSize: 12, fontWeight: '700', color: palette.muted},
  sortRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  sortChip: {minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 20, backgroundColor: palette.white},
  listContent: {paddingTop: 13, paddingBottom: 28, gap: 10},
  stockCard: {backgroundColor: palette.white, borderColor: palette.border, borderWidth: 1, borderRadius: 15, padding: 15, shadowColor: '#152D43', shadowOffset: {width: 0, height: 3}, shadowOpacity: 0.045, shadowRadius: 9, elevation: 1},
  stockCardPressed: {opacity: 0.72},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10},
  partNumber: {flex: 1, marginTop: 2, fontSize: 15, fontWeight: '800', letterSpacing: 0.2, color: palette.navy},
  description: {marginTop: 5, fontSize: 14, lineHeight: 20, fontWeight: '500', color: palette.text},
  quantityBadge: {minWidth: 67, alignItems: 'center', backgroundColor: '#EAF4EC', borderRadius: 10, paddingVertical: 5, paddingHorizontal: 8},
  quantityValue: {fontSize: 17, fontWeight: '800', color: '#287441'},
  quantityCaption: {fontSize: 7, fontWeight: '800', letterSpacing: 0.8, color: '#287441'},
  lowQuantityBadge: {backgroundColor: '#FFF0E8'},
  lowQuantityText: {color: '#A54E1E'},
  cardFooter: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDF1F4'},
  statusRow: {marginTop: 8},
  availableStatus: {fontSize: 12, fontWeight: '700', color: '#287441'},
  allocatedStatus: {fontSize: 12, fontWeight: '700', color: '#475569'},
  storeName: {flex: 1, marginRight: 8, fontSize: 12, fontWeight: '700', color: palette.muted},
  threshold: {fontSize: 11, color: palette.muted},
  emptyState: {alignItems: 'center', paddingHorizontal: 24, paddingTop: 70},
  emptyTitle: {fontSize: 17, fontWeight: '800', color: palette.text},
  loginScreen: {flex: 1},
  loginContent: {flexGrow: 1, padding: 18, justifyContent: 'center'},
  hero: {paddingHorizontal: 22, paddingTop: 26, paddingBottom: 30, backgroundColor: palette.navy, borderTopLeftRadius: 24, borderTopRightRadius: 24},
  heroBrandRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  heroMark: {width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: palette.white},
  heroBrandIcon: {width: 38, height: 38},
  heroWordmark: {fontSize: 23, fontWeight: '800', color: palette.white},
  heroLabel: {marginTop: 16, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, color: palette.amber},
  heroTitle: {marginTop: 9, fontSize: 30, lineHeight: 36, fontWeight: '800', color: palette.white},
  heroSubtitle: {marginTop: 8, fontSize: 15, lineHeight: 23, color: '#C1D0DF'},
  loginCard: {padding: 22, backgroundColor: palette.white, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, borderWidth: 1, borderTopWidth: 0, borderColor: palette.border},
  loginTitle: {fontSize: 29, fontWeight: '800', letterSpacing: -0.7, color: palette.navy},
  loginSubtitle: {marginTop: 5, marginBottom: 23, fontSize: 15, color: palette.muted},
  inputLabel: {marginBottom: 7, marginTop: 15, fontSize: 14, fontWeight: '700', color: palette.text},
  input: {height: 52, paddingHorizontal: 13, borderRadius: 11, borderWidth: 1, borderColor: '#AFC0CF', fontSize: 15, color: palette.text, backgroundColor: palette.white},
  rememberRow: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 9, marginTop: 18, paddingVertical: 5},
  checkbox: {width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1.5, borderColor: '#98A7B5'},
  checkboxChecked: {backgroundColor: palette.navy, borderColor: palette.navy},
  checkboxTick: {fontSize: 14, fontWeight: '800', color: palette.white},
  rememberText: {fontSize: 13, color: palette.muted},
  primaryButton: {minHeight: 51, marginTop: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.amber},
  buttonDisabled: {opacity: 0.65},
  primaryButtonText: {fontSize: 15, fontWeight: '800', color: palette.navy},
  inviteNote: {marginTop: 16, textAlign: 'center', fontSize: 11, lineHeight: 16, color: palette.muted},
  previewNote: {marginTop: 8, textAlign: 'center', fontSize: 11, lineHeight: 16, color: palette.navy},
  errorNotice: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: palette.redTint},
  errorText: {flex: 1, fontSize: 12, lineHeight: 18, color: palette.red},
  retryText: {fontWeight: '800', color: palette.red},
  loadingScreen: {alignItems: 'center', justifyContent: 'center', gap: 12},
});
