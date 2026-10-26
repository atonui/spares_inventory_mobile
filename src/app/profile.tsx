import {useEffect, useState} from 'react';
import {ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRouter} from 'expo-router';
import type {NativeUser} from '../api/client';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';

const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', background: '#F5F7FA', white: '#FFFFFF', border: '#CBD5E1', muted: '#475569', error: '#A13A32'};

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<NativeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      try {
        const userId = await offlineStockStore.getActiveUserId();
        const savedProfile = userId === null ? null : await offlineStockStore.loadProfile(userId);
        if (active) setProfile(savedProfile?.id === userId ? savedProfile : null);
      } catch {
        if (active) setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);

  const initials = profile?.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'ST';

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
            <Text accessibilityRole="header" style={styles.title}>Profile</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>Account details for the profile connected to this device.</Text>
          {loading ? (
            <View style={styles.stateCard}><ActivityIndicator color={palette.navy} /><Text style={styles.body}>Loading profile…</Text></View>
          ) : profile ? (
            <>
              <View style={styles.identityCard}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
                <Text style={styles.name}>{profile.name}</Text>
                <Text style={styles.email}>{profile.email}</Text>
                <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{formatRole(profile.role)}</Text></View>
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
  header: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: palette.border},
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  backGlyph: {fontSize: 30, lineHeight: 33, color: palette.navy},
  brandIcon: {width: 40, height: 40, borderRadius: 12},
  headerCopy: {flex: 1},
  brand: {fontSize: 17, fontWeight: '800', color: palette.navy},
  title: {fontSize: 13, fontWeight: '600', color: palette.muted},
  content: {paddingTop: 18, paddingBottom: 20},
  intro: {marginBottom: 18, fontSize: 14, lineHeight: 21, color: palette.muted},
  identityCard: {alignItems: 'center', padding: 20, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  avatar: {width: 68, height: 68, alignItems: 'center', justifyContent: 'center', borderRadius: 34, backgroundColor: '#FFF2D9'},
  avatarText: {fontSize: 22, fontWeight: '800', color: palette.navy},
  name: {marginTop: 14, fontSize: 20, fontWeight: '800', textAlign: 'center', color: palette.navy},
  email: {marginTop: 4, fontSize: 14, textAlign: 'center', color: palette.muted},
  roleBadge: {marginTop: 12, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, backgroundColor: palette.background},
  roleBadgeText: {fontSize: 12, fontWeight: '700', color: palette.navy},
  section: {marginTop: 24},
  sectionTitle: {marginBottom: 9, fontSize: 15, fontWeight: '800', color: palette.navy},
  detailsCard: {paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  detailRow: {minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderBottomColor: '#E8EDF2'},
  detailRowLast: {borderBottomWidth: 0},
  detailLabel: {fontSize: 13, color: palette.slate},
  detailValue: {flex: 1, fontSize: 13, fontWeight: '700', textAlign: 'right', color: palette.navy},
  footnote: {marginTop: 14, fontSize: 12, lineHeight: 18, color: palette.slate},
  stateCard: {alignItems: 'center', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  emptyTitle: {fontSize: 16, fontWeight: '800', textAlign: 'center', color: palette.navy},
  body: {marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center', color: palette.muted},
  outlineButton: {minHeight: 46, marginTop: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white},
  outlineButtonText: {fontSize: 13, fontWeight: '700', color: palette.navy},
});
