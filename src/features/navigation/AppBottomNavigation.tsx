import {useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useRouter} from 'expo-router';
import {AppIcon, type AppIconName} from './AppIcon';

type ActiveTab = 'inventory' | 'scan' | 'changes' | 'more';

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
    {key: 'inventory', label: 'Inventory', icon: 'inventory'},
    {key: 'scan', label: 'Scan', icon: 'scan'},
    {key: 'changes', label: 'Changes', icon: 'changes'},
    {key: 'more', label: 'More', icon: 'more'},
  ];

  function navigateTo(path: '/' | '/scan' | '/offline-changes') {
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
                else if (tab.key === 'inventory') navigateTo('/');
                else if (tab.key === 'scan') navigateTo('/scan');
                else navigateTo('/offline-changes');
              }}
              style={styles.tab}
            >
              {selected && <View style={styles.activeIndicator} />}
              <View style={styles.iconWrap}>
                <AppIcon name={tab.icon} color={selected ? palette.navy : palette.slate} size={22} />
                {tab.key === 'changes' && pendingCount > 0 && (
                  <View accessible={false} style={styles.badge}>
                    <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
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
              <Text accessibilityRole="header" style={styles.sheetTitle}>Menu</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={() => setMenuVisible(false)} style={styles.closeButton}>
                <AppIcon name="close" color={palette.slate} size={20} />
              </Pressable>
            </View>
            <MenuAction icon="inventory" title="Inventory" subtitle="Search and browse stock" onPress={() => navigateTo('/')} />
            <MenuAction icon="scan" title="Scan a part" subtitle="Find an item by barcode or QR code" onPress={() => navigateTo('/scan')} />
            <MenuAction
              icon="changes"
              title="Offline changes"
              subtitle={pendingCount ? `${queuedCount} waiting · ${conflictCount} need review` : 'View sync status'}
              onPress={() => navigateTo('/offline-changes')}
            />
            {onSignOut ? (
              <MenuAction icon="signOut" title="Sign out" subtitle="Saved offline changes stay on this device" onPress={() => {setMenuVisible(false); onSignOut();}} />
            ) : (
              <MenuAction icon="more" title="Account" subtitle="Return to Inventory for account actions" onPress={() => navigateTo('/')} />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function MenuAction({icon, title, subtitle, onPress}: {icon: AppIconName; title: string; subtitle: string; onPress: () => void}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.menuAction}>
      <View style={styles.menuIcon}><AppIcon name={icon} color={title === 'Sign out' ? palette.red : palette.navy} size={21} /></View>
      <View style={styles.menuCopy}>
        <Text style={[styles.menuTitle, title === 'Sign out' && styles.signOutTitle]}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {height: 70, flexDirection: 'row', marginHorizontal: -20, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white},
  tab: {flex: 1, minHeight: 70, alignItems: 'center', justifyContent: 'center', gap: 3},
  activeIndicator: {position: 'absolute', top: 0, width: 28, height: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: palette.amber},
  iconWrap: {position: 'relative', minWidth: 26, minHeight: 25, alignItems: 'center', justifyContent: 'center'},
  tabLabel: {fontSize: 10, fontWeight: '600', color: palette.slate},
  tabLabelActive: {fontWeight: '800', color: palette.navy},
  badge: {position: 'absolute', top: -4, right: -9, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderRadius: 8, backgroundColor: palette.red},
  badgeText: {fontSize: 9, lineHeight: 12, fontWeight: '800', color: palette.white},
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21, 38, 59, 0.38)'},
  sheet: {paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: palette.white},
  handle: {alignSelf: 'center', width: 42, height: 4, marginBottom: 10, borderRadius: 2, backgroundColor: palette.border},
  sheetHeader: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6},
  sheetTitle: {fontSize: 18, fontWeight: '800', color: palette.navy},
  closeButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  menuAction: {minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#E8EDF2'},
  menuIcon: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.background},
  menuCopy: {flex: 1},
  menuTitle: {fontSize: 13, fontWeight: '800', color: palette.navy},
  signOutTitle: {color: palette.red},
  menuSubtitle: {marginTop: 3, fontSize: 11, color: palette.muted},
  chevron: {fontSize: 23, color: palette.slate},
});
