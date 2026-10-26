import {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import {ApiError, type NativeUser} from '../api/client';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {api} from '../api/runtime';
import type {QueuedStockAdjustment} from '../features/inventory/offlineStockQueue';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {AppIcon} from '../features/navigation/AppIcon';

const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', background: '#F5F7FA', white: '#FFFFFF', border: '#CBD5E1', muted: '#475569', error: '#A13A32'};

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<NativeUser | null>(null);
  const [queue, setQueue] = useState<QueuedStockAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      try {
        const userId = await offlineStockStore.getActiveUserId();
        const [savedProfile, pending] = userId === null ? [null, []] : await Promise.all([
          offlineStockStore.loadProfile(userId), offlineStockStore.list(userId),
        ]);
        if (active) {
          setProfile(savedProfile?.id === userId ? savedProfile : null);
          setQueue(pending);
        }
      } catch {
        if (active) setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  const initials = profile?.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'ST';
  const pendingCount = queue.length;

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      const result = await api.logout();
      if (!result.success) throw new Error('The server could not confirm sign out.');
      await offlineStockStore.setActiveUserId(null);
      setSignOutVisible(false);
      router.replace('/');
    } catch (reason) {
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        await api.clearSession();
        await offlineStockStore.setActiveUserId(null);
        setSignOutVisible(false);
        router.replace('/');
        return;
      }
      setSignOutError(reason instanceof Error ? reason.message : 'Sign out failed. Try again.');
    } finally {
      setSigningOut(false);
    }
  }

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
            <Text accessibilityRole="header" style={styles.title}>Profile & settings</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {loading ? (
            <View style={styles.stateCard}><ActivityIndicator color={palette.navy} /><Text style={styles.body}>Loading profile…</Text></View>
          ) : profile ? (
            <>
              <View style={styles.identityCard}>
                <View style={styles.identityTopRow}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
                  <View style={styles.identityCopy}>
                    <Text style={styles.name}>{profile.name}</Text>
                    <Text style={styles.email}>{profile.email}</Text>
                    <Text style={styles.profileMeta}>{formatRole(profile.role)} · Paired device</Text>
                  </View>
                  <View style={styles.pairedBadge}><Text style={styles.pairedBadgeText}>Paired</Text></View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>On this device</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={styles.destinationRow}>
                  <View style={styles.destinationIcon}><AppIcon name="settings" color={palette.navy} size={19} /></View>
                  <View style={styles.destinationCopy}><Text style={styles.destinationTitle}>Settings</Text><Text style={styles.destinationSubtitle}>Scanner feedback and offline data</Text></View>
                  <AppIcon name="chevronRight" color={palette.slate} size={17} />
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => router.push('/offline-changes')} style={styles.destinationRow}>
                  <View style={styles.destinationIcon}><AppIcon name="changes" color={palette.navy} size={19} /></View>
                  <View style={styles.destinationCopy}><Text style={styles.destinationTitle}>Offline changes</Text><Text style={styles.destinationSubtitle}>{pendingCount ? `${pendingCount} saved on this device` : 'No changes waiting to sync'}</Text></View>
                  <AppIcon name="chevronRight" color={palette.slate} size={17} />
                </Pressable>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Account details</Text>
                <View style={styles.detailsCard}>
                  <DetailRow label="Name" value={profile.name} />
                  <DetailRow label="Email" value={profile.email} />
                  <DetailRow label="Role" value={formatRole(profile.role)} />
                  {profile.territory !== null && <DetailRow label="Territory" value={profile.territory} last />}
                </View>
              </View>
              <Pressable accessibilityRole="button" onPress={() => {setSignOutError(''); setSignOutVisible(true);}} style={styles.signOutButton}>
                <AppIcon name="signOut" color={palette.error} size={17} />
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
              <Text style={styles.footnote}>Profile details are read from the account’s last successful sign-in.</Text>
            </>
          ) : (
            <View style={styles.stateCard}>
              <Text style={styles.emptyTitle}>Profile details unavailable</Text>
              <Text style={styles.body}>Return to Inventory while signed in to refresh the account details saved on this device.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>Back to inventory</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
      <AppBottomNavigation active="more" />
      <Modal transparent visible={signOutVisible} animationType="fade" onRequestClose={() => {if (!signingOut) setSignOutVisible(false);}}>
        <View style={styles.modalBackdrop}>
          <View accessibilityRole="alert" style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{pendingCount ? 'Sign out with unsynced work?' : 'Sign out?'}</Text>
            <Text style={styles.modalBody}>{pendingCount
              ? `${pendingCount} saved change${pendingCount === 1 ? '' : 's'} will remain on this device and sync after you sign in again.`
              : 'You can pair this device again from your desktop profile.'}</Text>
            {!!signOutError && <Text accessibilityRole="alert" style={styles.signOutError}>{signOutError}</Text>}
            <View style={styles.confirmActions}>
              <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => setSignOutVisible(false)} style={styles.stayButton}><Text style={styles.stayText}>Stay signed in</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => void signOut()} style={styles.confirmSignOutButton}><Text style={styles.confirmSignOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({label, value, last = false}: {label: string; value: string; last?: boolean}) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function formatRole(role: string) {
  return role.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
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
  content: {paddingTop: 15, paddingBottom: 20, gap: 12},
  identityCard: {padding: 15, borderRadius: 16, backgroundColor: palette.navy},
  identityTopRow: {flexDirection: 'row', alignItems: 'center', gap: 11},
  identityCopy: {flex: 1},
  avatar: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: palette.amber},
  avatarText: {fontSize: 18, fontWeight: '800', color: palette.navy},
  name: {fontSize: 15, fontWeight: '800', color: palette.white},
  email: {marginTop: 2, fontSize: 11, color: '#D0DAE5'},
  profileMeta: {marginTop: 4, fontSize: 10, color: '#C4D0DC'},
  pairedBadge: {paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#D9F0E2'},
  pairedBadgeText: {fontSize: 9, fontWeight: '800', color: '#21653A'},
  section: {marginTop: 4},
  sectionTitle: {marginBottom: 7, fontSize: 14, fontWeight: '800', color: palette.navy},
  destinationRow: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#E8EDF2', backgroundColor: palette.white},
  destinationIcon: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.background},
  destinationCopy: {flex: 1},
  destinationTitle: {fontSize: 13, fontWeight: '700', color: palette.navy},
  destinationSubtitle: {marginTop: 2, fontSize: 10, color: palette.slate},
  detailsCard: {paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  detailRow: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderBottomColor: '#E8EDF2'},
  detailRowLast: {borderBottomWidth: 0},
  detailLabel: {fontSize: 13, color: palette.slate},
  detailValue: {flex: 1, fontSize: 13, fontWeight: '700', textAlign: 'right', color: palette.navy},
  signOutButton: {minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, borderWidth: 1, borderColor: '#E7B7B2', backgroundColor: palette.white},
  signOutText: {fontSize: 13, fontWeight: '800', color: palette.error},
  footnote: {fontSize: 11, lineHeight: 17, color: palette.slate},
  modalBackdrop: {flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(21,38,59,0.5)'},
  confirmCard: {padding: 18, borderRadius: 16, backgroundColor: palette.white},
  confirmTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  modalBody: {marginTop: 8, fontSize: 13, lineHeight: 19, color: palette.muted},
  signOutError: {marginTop: 8, fontSize: 12, color: palette.error},
  confirmActions: {flexDirection: 'row', gap: 8, marginTop: 16},
  stayButton: {flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border},
  stayText: {fontSize: 12, fontWeight: '700', color: palette.navy},
  confirmSignOutButton: {flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.error},
  confirmSignOutText: {fontSize: 12, fontWeight: '800', color: palette.white},
  stateCard: {alignItems: 'center', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  emptyTitle: {fontSize: 16, fontWeight: '800', textAlign: 'center', color: palette.navy},
  body: {marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center', color: palette.muted},
  outlineButton: {minHeight: 46, marginTop: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white},
  outlineButtonText: {fontSize: 13, fontWeight: '700', color: palette.navy},
});
