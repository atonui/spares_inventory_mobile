import {useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useRouter} from 'expo-router';
import {AppIcon, type AppIconName} from './AppIcon';

type ActiveTab = 'home' | 'inventory' | 'scan' | 'changes' | 'more';

const palette = {
  navy: '#15263B', amber: '#E9A23B', slate: '#64748B', white: '#FFFFFF',
  border: '#CBD5E1', background: '#F5F7FA', muted: '#475569', red: '#A13A32',
};

export function AppBottomNavigation({
  active,
  queuedCount = 0,
  conflictCount = 0,
  onSignOut,
}: {
  active: ActiveTab;
  queuedCount?: number;
  conflictCount?: number;
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);
  const pendingCount = queuedCount + conflictCount;
  const tabs: {key: ActiveTab; label: string; icon: AppIconName}[] = [
    {key: 'home', label: 'Home', icon: 'home'},
    {key: 'inventory', label: 'Inventory', icon: 'inventory'},
    {key: 'scan', label: 'Scan', icon: 'scan'},
    {key: 'changes', label: 'Changes', icon: 'changes'},
    {key: 'more', label: 'More', icon: 'more'},
  ];

  function navigateTo(path: '/' | '/home' | '/scan' | '/offline-changes' | '/profile' | '/settings') {
    setMenuVisible(false);
    router.push(path);
  }

  return (
    <>
      <View style={styles.bar}>
        {tabs.map(tab => {
          const selected = active === tab.key || (tab.key === 'more' && menuVisible);
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityLabel={tab.key === 'more'
                ? 'Open menu'
                : tab.key === 'changes' && pendingCount > 0
                  ? `${tab.label} tab, ${pendingCount} pending changes`
                  : `${tab.label} tab`}
              accessibilityState={{selected}}
              onPress={() => {
                if (tab.key === 'more') setMenuVisible(true);
                else if (selected) return;
                else if (tab.key === 'home') navigateTo('/home');
                else if (tab.key === 'inventory') router.push({pathname: '/', params: {filter: undefined, query: undefined}});
                else if (tab.key === 'scan') navigateTo('/scan');
                else if (tab.key === 'changes') navigateTo('/offline-changes');
              }}
              style={[styles.tab, tab.key === 'scan' && styles.scanTab]}
            >
              {selected && tab.key !== 'scan' && <View style={styles.activeIndicator} />}
              <View style={[styles.iconWrap, tab.key === 'scan' && styles.scanIconWrap]}>
                <AppIcon name={tab.icon} color={tab.key === 'scan' ? palette.navy : selected ? palette.navy : palette.slate} size={tab.key === 'scan' ? 25 : 22} />
                {tab.key === 'changes' && pendingCount > 0 && (
                  <View accessible={false} style={[styles.badge, conflictCount > 0 ? styles.badgeError : styles.badgeWarning]}>
                    <Text style={[styles.badgeText, conflictCount > 0 && styles.badgeErrorText]}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, (selected || tab.key === 'scan') && styles.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Modal transparent visible={menuVisible} animationType="slide" onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.backdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={() => setMenuVisible(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>More</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={() => setMenuVisible(false)} style={styles.closeButton}>
                <AppIcon name="close" color={palette.slate} size={20} />
              </Pressable>
            </View>
            <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.groupLabel}>ACCOUNT & APP</Text>
              <MenuAction icon="profile" title="Profile" subtitle="View your account details" onPress={() => navigateTo('/profile')} />
              <MenuAction icon="settings" title="Settings" subtitle="Scanner feedback and offline data" onPress={() => navigateTo('/settings')} />
            </ScrollView>
            {onSignOut && (
              <View style={styles.signOutSection}>
                <MenuAction icon="signOut" title="Sign out" subtitle="Saved offline changes stay on this device" onPress={() => {setMenuVisible(false); onSignOut();}} />
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function MenuAction({icon, title, subtitle, onPress}: {icon: AppIconName; title: string; subtitle: string; onPress: () => void}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({pressed}) => [styles.menuAction, pressed && styles.menuActionPressed]}>
      <View style={styles.menuIcon}><AppIcon name={icon} color={title === 'Sign out' ? palette.red : palette.navy} size={21} /></View>
      <View style={styles.menuCopy}>
        <Text style={[styles.menuTitle, title === 'Sign out' && styles.signOutTitle]}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <AppIcon name="chevronRight" color={palette.slate} size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {height: 76, flexDirection: 'row', marginHorizontal: -20, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: palette.white},
  tab: {flex: 1, minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: 4},
  scanTab: {marginTop: -14},
  activeIndicator: {position: 'absolute', top: 0, width: 28, height: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: palette.amber},
  iconWrap: {position: 'relative', minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center'},
  scanIconWrap: {width: 54, height: 54, borderRadius: 18, backgroundColor: palette.amber, borderWidth: 3, borderColor: palette.white},
  tabLabel: {fontSize: 11, fontWeight: '600', color: palette.slate},
  tabLabelActive: {fontWeight: '800', color: palette.navy},
  badge: {position: 'absolute', top: -4, right: -9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 9},
  badgeWarning: {backgroundColor: palette.amber},
  badgeError: {backgroundColor: palette.red},
  badgeText: {fontSize: 9, lineHeight: 12, fontWeight: '800', color: palette.navy},
  badgeErrorText: {color: palette.white},
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21, 38, 59, 0.38)'},
  sheet: {maxHeight: '88%', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: palette.white},
  handle: {alignSelf: 'center', width: 42, height: 4, marginBottom: 10, borderRadius: 2, backgroundColor: palette.border},
  sheetHeader: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6},
  sheetTitle: {fontSize: 20, fontWeight: '800', color: palette.navy},
  closeButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  menuScroll: {flexShrink: 1},
  menuContent: {paddingBottom: 8},
  groupLabel: {marginTop: 4, marginBottom: 2, fontSize: 10, fontWeight: '800', letterSpacing: 1, color: palette.slate},
  signOutSection: {marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: palette.border},
  menuAction: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#E8EDF2'},
  menuActionPressed: {opacity: 0.72},
  menuIcon: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.background},
  menuCopy: {flex: 1},
  menuTitle: {fontSize: 14, fontWeight: '700', color: palette.navy},
  signOutTitle: {color: palette.red},
  menuSubtitle: {marginTop: 3, fontSize: 12, lineHeight: 16, color: palette.muted},
});
