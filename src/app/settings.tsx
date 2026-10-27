import {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import type {QueuedStockAdjustment} from '../features/inventory/offlineStockQueue';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {AppIcon} from '../features/navigation/AppIcon';

const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', background: '#F5F7FA', white: '#FFFFFF', border: '#CBD5E1', muted: '#475569', red: '#A13A32', green: '#217A4B'};

export default function SettingsScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [scanSoundsEnabled, setScanSoundsEnabled] = useState(false);
  const [queue, setQueue] = useState<QueuedStockAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPreference, setSavingPreference] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      try {
        const activeUserId = await offlineStockStore.getActiveUserId();
        if (!active) return;
        setUserId(activeUserId);
        if (activeUserId === null) {
          setQueue([]);
          return;
        }
        const [pending, enabled, soundsEnabled] = await Promise.all([
          offlineStockStore.list(activeUserId),
          offlineStockStore.getScanHapticsEnabled(activeUserId),
          offlineStockStore.getScanSoundsEnabled(activeUserId),
        ]);
        if (active) {
          setQueue(pending);
          setHapticsEnabled(enabled);
          setScanSoundsEnabled(soundsEnabled);
        }
      } catch {
        if (active) setError('Could not load settings saved on this device.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadSettings();
    return () => { active = false; };
  }, []);

  async function updateHaptics(enabled: boolean) {
    if (userId === null || savingPreference) return;
    const previous = hapticsEnabled;
    setHapticsEnabled(enabled);
    setSavingPreference(true);
    setError('');
    try {
      await offlineStockStore.setScanHapticsEnabled(userId, enabled);
    } catch {
      setHapticsEnabled(previous);
      setError('Could not save this setting. Try again.');
    } finally {
      setSavingPreference(false);
    }
  }

  async function updateScanSounds(enabled: boolean) {
    if (userId === null || savingPreference) return;
    const previous = scanSoundsEnabled;
    setScanSoundsEnabled(enabled);
    setSavingPreference(true);
    setError('');
    try {
      await offlineStockStore.setScanSoundsEnabled(userId, enabled);
    } catch {
      setScanSoundsEnabled(previous);
      setError('Could not save this setting. Try again.');
    } finally {
      setSavingPreference(false);
    }
  }

  const waitingCount = queue.filter(change => change.status === 'queued').length;
  const conflictCount = queue.filter(change => change.status === 'conflict').length;
  const pendingCount = waitingCount + conflictCount;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Image source={require('../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
          <View style={styles.headerCopy}>
            <Text style={styles.brand}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.title}>Settings</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>Adjust scanner feedback and check stock changes stored on this device.</Text>

          <Text style={styles.sectionTitle}>Scanning</Text>
          <View style={styles.settingCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>Haptic scan feedback</Text>
                <Text style={styles.settingDescription}>Vibrate to confirm a match or flag an unrecognized code.</Text>
              </View>
              <Switch
                accessibilityLabel="Haptic scan feedback"
                value={hapticsEnabled}
                onValueChange={value => void updateHaptics(value)}
                disabled={loading || savingPreference || userId === null}
                trackColor={{false: palette.border, true: palette.amber}}
                thumbColor={palette.white}
              />
            </View>
            <View style={styles.settingDivider} />
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>Sound scan feedback</Text>
                <Text style={styles.settingDescription}>Play a high tone for a match and a low tone when no part is found. Off by default.</Text>
              </View>
              <Switch
                accessibilityLabel="Sound scan feedback"
                value={scanSoundsEnabled}
                onValueChange={value => void updateScanSounds(value)}
                disabled={loading || savingPreference || userId === null}
                trackColor={{false: palette.border, true: palette.amber}}
                thumbColor={palette.white}
              />
            </View>
            {savingPreference && <ActivityIndicator size="small" color={palette.slate} style={styles.preferenceProgress} />}
          </View>

          <Text style={styles.sectionTitle}>Offline work</Text>
          <View style={styles.offlineCard}>
            <View style={styles.offlineSummary}>
              <View style={[styles.statusDot, pendingCount > 0 ? styles.statusDotWaiting : styles.statusDotClear]} />
              <Text style={styles.offlineSummaryText}>
                {loading ? 'Checking saved changes…' : pendingCount === 0 ? 'No changes waiting to sync' : `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} saved on this device`}
              </Text>
            </View>
            <Text style={styles.settingDescription}>Stock changes stay here until they sync or you resolve any conflicts.</Text>
            {!loading && pendingCount > 0 && (
              <View style={styles.countRow}>
                {waitingCount > 0 && <CountTag label={`${waitingCount} waiting`} tone="waiting" />}
                {conflictCount > 0 && <CountTag label={`${conflictCount} need review`} tone="conflict" />}
              </View>
            )}
            <Pressable accessibilityRole="button" onPress={() => router.push('/offline-changes')} style={styles.reviewButton}>
              <AppIcon name="changes" color={palette.navy} size={18} />
              <Text style={styles.reviewButtonText}>Review offline changes</Text>
              <AppIcon name="chevronRight" color={palette.slate} size={16} />
            </Pressable>
          </View>

          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        </ScrollView>
      </View>
      <AppBottomNavigation active="more" queuedCount={waitingCount} conflictCount={conflictCount} />
    </SafeAreaView>
  );
}

function CountTag({label, tone}: {label: string; tone: 'waiting' | 'conflict'}) {
  return <Text style={[styles.countTag, tone === 'conflict' && styles.countTagConflict]}>{label}</Text>;
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 16},
  header: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: -16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#34475C', backgroundColor: palette.navy},
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  backGlyph: {fontSize: 30, lineHeight: 33, color: palette.white},
  brandIcon: {width: 40, height: 40, borderRadius: 12},
  headerCopy: {flex: 1},
  brand: {fontSize: 15, fontWeight: '800', color: palette.white},
  title: {fontSize: 12, fontWeight: '600', color: '#C4D0DC'},
  content: {paddingTop: 15, paddingBottom: 20},
  intro: {marginBottom: 17, fontSize: 13, lineHeight: 19, color: palette.muted},
  sectionTitle: {marginBottom: 9, fontSize: 15, fontWeight: '800', color: palette.navy},
  settingCard: {marginBottom: 22, padding: 15, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  settingRow: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14},
  settingDivider: {height: 1, marginVertical: 12, backgroundColor: palette.border},
  settingCopy: {flex: 1},
  settingTitle: {fontSize: 14, fontWeight: '700', color: palette.navy},
  settingDescription: {marginTop: 5, fontSize: 13, lineHeight: 19, color: palette.muted},
  preferenceProgress: {alignSelf: 'flex-end', marginTop: 5},
  offlineCard: {padding: 15, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  offlineSummary: {flexDirection: 'row', alignItems: 'center', gap: 8},
  statusDot: {width: 9, height: 9, borderRadius: 5},
  statusDotWaiting: {backgroundColor: palette.amber},
  statusDotClear: {backgroundColor: palette.green},
  offlineSummaryText: {flex: 1, fontSize: 14, fontWeight: '700', color: palette.navy},
  countRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12},
  countTag: {overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: '#FFF2D9', color: '#7A4D08', fontSize: 11, fontWeight: '700'},
  countTagConflict: {backgroundColor: '#FDE9E7', color: palette.red},
  reviewButton: {minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 15, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  reviewButtonText: {flex: 1, fontSize: 13, fontWeight: '700', color: palette.navy},
  error: {marginTop: 14, fontSize: 13, lineHeight: 18, color: palette.red},
});
