import {useEffect, useRef, useState} from 'react';
import {CameraView, useCameraPermissions, type BarcodeType} from 'expo-camera';
import * as Haptics from 'expo-haptics';
import {StatusBar} from 'expo-status-bar';
import {ActivityIndicator, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useLocalSearchParams, useRouter} from 'expo-router';
import type {InventoryItem} from '../features/inventory/inventoryRepository';
import {getInventorySnapshot} from '../features/inventory/inventorySnapshot';
import {applyQueuedStockCounts} from '../features/inventory/offlineStockQueue';
import {offlineStockStore} from '../features/inventory/offlineStockStore';
import {findInventoryMatches} from '../features/inventory/scanLookup';
import {AppBottomNavigation} from '../features/navigation/AppBottomNavigation';
import {AppIcon} from '../features/navigation/AppIcon';

const scannerBarcodeTypes: BarcodeType[] = [
  'qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'codabar', 'itf14',
];

type InventoryState = 'loading' | 'ready' | 'unavailable';

export default function InventoryScanScreen() {
  const router = useRouter();
  const {userId: userIdParam} = useLocalSearchParams<{userId?: string}>();
  const [permission, requestPermission] = useCameraPermissions();
  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [inventoryState, setInventoryState] = useState<InventoryState>('loading');
  const [signedInUserId, setSignedInUserId] = useState<number | null>(null);
  const [scannedValue, setScannedValue] = useState('');
  const [hasScanned, setHasScanned] = useState(false);
  const [matches, setMatches] = useState<InventoryItem[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [permissionError, setPermissionError] = useState('');
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [manualPartNumber, setManualPartNumber] = useState('');
  const scanned = useRef(false);

  useEffect(() => {
    let active = true;
    const loadInventory = async () => {
      const requestedUserId = /^\d+$/.test(userIdParam ?? '') ? Number(userIdParam) : null;
      let activeUserId: number | null;
      try { activeUserId = await offlineStockStore.getActiveUserId(); }
      catch {
        if (active) setInventoryState('unavailable');
        return;
      }
      if (activeUserId === null || (requestedUserId !== null && requestedUserId !== activeUserId)) {
        if (active) setInventoryState('unavailable');
        return;
      }
      if (active) setSignedInUserId(activeUserId);
      try {
        const enabled = await offlineStockStore.getScanHapticsEnabled(activeUserId);
        if (active) setHapticsEnabled(enabled);
      } catch {
        // Keep scan feedback enabled if the local preference cannot be read.
      }
      const snapshot = getInventorySnapshot();
      if (snapshot !== null) {
        if (active) {
          setInventory(snapshot);
          setInventoryState('ready');
        }
        return;
      }

      try {
        const cachedRows = await offlineStockStore.loadInventorySnapshot(activeUserId);
        if (!active) return;
        if (cachedRows === null) {
          setInventoryState('unavailable');
          return;
        }
        const queued = await offlineStockStore.list(activeUserId);
        if (!active) return;
        setInventory(applyQueuedStockCounts(cachedRows, queued));
        setInventoryState('ready');
      } catch {
        if (active) setInventoryState('unavailable');
      }
    };
    void loadInventory();
    return () => { active = false; };
  }, [userIdParam]);

  useEffect(() => {
    if (!hasScanned || !hapticsEnabled) return;
    const sendScanFeedback = async () => {
      try {
        if (Platform.OS === 'android') {
          await Haptics.performAndroidHapticsAsync(matches.length > 0
            ? Haptics.AndroidHaptics.Confirm
            : Haptics.AndroidHaptics.Reject);
        } else {
          await Haptics.notificationAsync(matches.length > 0
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error);
        }
      } catch {
        // Visual scan results remain available when device haptics are unavailable.
      }
    };
    void sendScanFeedback();
  }, [hasScanned, hapticsEnabled, matches.length]);

  function onBarcodeScanned(value: string) {
    if (scanned.current || inventory === null) return;
    scanned.current = true;
    setHasScanned(true);
    setScannedValue(value);
    const found = findInventoryMatches(inventory, value);
    setMatches(found);
    setSelectedMatchId(found.length === 1 ? found[0].id : null);
  }

  function scanAgain() {
    scanned.current = false;
    setHasScanned(false);
    setScannedValue('');
    setMatches([]);
    setSelectedMatchId(null);
    setTorchEnabled(false);
  }

  function findPartNumber() {
    const partNumber = manualPartNumber.trim();
    if (!partNumber) return;
    Keyboard.dismiss();
    setTorchEnabled(false);
    scanned.current = false;
    setHasScanned(false);
    setScannedValue('');
    setMatches([]);
    onBarcodeScanned(partNumber);
  }

  async function allowCamera() {
    setPermissionError('');
    setRequestingPermission(true);
    try {
      const result = await requestPermission();
      if (!result.granted) {
        setPermissionError(result.canAskAgain
          ? 'Camera access is required to scan a code.'
          : 'Camera access is blocked. Allow it in your device settings to scan a code.');
      }
    } catch {
      setPermissionError('Camera permission could not be requested. Try again.');
    } finally {
      setRequestingPermission(false);
    }
  }

  function openItem(item: InventoryItem) {
    router.push({pathname: '/inventory/[itemId]', params: {itemId: String(item.id), userId: String(signedInUserId ?? '')}});
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <Image source={require('../../assets/icon.png')} style={styles.brandIcon} accessible={false} />
          <View style={styles.brandCopy}>
            <Text style={styles.wordmark}>Spares Tracker</Text>
            <Text accessibilityRole="header" style={styles.pageTitle}>Scan stock</Text>
          </View>
        </View>

        <View style={styles.scanHeading}>
          <Text accessibilityRole="header" style={styles.scanTitle}>{hasScanned ? 'Scan result' : 'Scan stock'}</Text>
          <Text style={styles.intro}>{hasScanned ? scannedValue : 'Align a barcode inside the frame or look up a part number.'}</Text>
        </View>

        {inventoryState === 'loading' && (
          <View style={styles.messageState}>
            <ActivityIndicator size="large" color={palette.navy} />
            <Text style={styles.messageText}>Loading saved inventory…</Text>
          </View>
        )}

        {inventoryState === 'unavailable' && (
          <View style={styles.messageState}>
            <Text style={styles.messageTitle}>Inventory is not loaded yet.</Text>
            <Text style={styles.messageText}>Open Inventory and refresh once to make saved stock available for scanning.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Back to inventory</Text>
            </Pressable>
          </View>
        )}

        {inventoryState === 'ready' && inventory?.length === 0 && (
          <View style={styles.messageState}>
            <Text style={styles.messageTitle}>No inventory to scan.</Text>
            <Text style={styles.messageText}>Refresh Inventory and try again.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Back to inventory</Text>
            </Pressable>
          </View>
        )}

        {inventoryState === 'ready' && (inventory?.length ?? 0) > 0 && (
          <>
            <ScrollView style={styles.scanContent} contentContainerStyle={styles.scanContentInner} keyboardShouldPersistTaps="handled">
            {permission?.granted ? (
              !hasScanned && <View style={styles.cameraFrame}>
                {!hasScanned && (
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    enableTorch={torchEnabled}
                    barcodeScannerSettings={{barcodeTypes: scannerBarcodeTypes}}
                    onBarcodeScanned={({data}) => onBarcodeScanned(data)}
                  />
                )}
                <View pointerEvents="none" style={styles.scanFrame}><View style={styles.scanCorners} /></View>
                {!hasScanned && <View pointerEvents="none" style={styles.scanPrompt}><Text style={styles.scanPromptText}>Align code inside frame</Text></View>}
                {!hasScanned && Platform.OS !== 'web' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={torchEnabled ? 'Turn torch off' : 'Turn torch on'}
                    accessibilityState={{checked: torchEnabled}}
                    onPress={() => setTorchEnabled(value => !value)}
                    style={[styles.torchButton, torchEnabled && styles.torchButtonActive]}
                  >
                    <AppIcon name="flashlight" color={torchEnabled ? palette.navy : palette.white} size={18} />
                    <Text style={[styles.torchLabel, torchEnabled && styles.torchLabelActive]}>{torchEnabled ? 'Torch on' : 'Torch'}</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={styles.permissionCard}>
                <Text accessibilityRole="header" style={styles.permissionTitle}>Use your camera to scan stock</Text>
                <Text style={styles.permissionDescription}>Spares Tracker uses the camera to read barcodes and QR codes.</Text>
                <Text style={styles.permissionNote}>You can also enter a part number below.</Text>
                {permissionError ? <Text accessibilityRole="alert" style={styles.permissionError}>{permissionError}</Text> : null}
                {!permission?.canAskAgain && permission?.granted === false ? (
                  <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.permissionButton}>
                    <Text style={styles.permissionButtonText}>Open device settings</Text>
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" disabled={requestingPermission} onPress={() => void allowCamera()} style={styles.permissionButton}>
                    {requestingPermission ? <ActivityIndicator color={palette.navy} /> : <Text style={styles.permissionButtonText}>Allow camera</Text>}
                  </Pressable>
                )}
              </View>
            )}

            {!hasScanned && <View style={styles.manualEntry}>
              <Text style={styles.manualTitle}>Can’t scan?</Text>
              <Text style={styles.manualHint}>Enter a part number to look it up.</Text>
              <View style={styles.manualForm}>
                <TextInput accessibilityLabel="Part number" value={manualPartNumber} onChangeText={setManualPartNumber}
                  onSubmitEditing={findPartNumber} placeholder="e.g. BRK-2048" placeholderTextColor="#94A3B8"
                  autoCapitalize="characters" autoCorrect={false} returnKeyType="search" style={styles.manualInput} />
                <Pressable accessibilityRole="button" disabled={!manualPartNumber.trim()} onPress={findPartNumber}
                  style={[styles.manualButton, !manualPartNumber.trim() && styles.manualButtonDisabled]}>
                  <Text style={styles.manualButtonText}>Look up part</Text>
                </Pressable>
              </View>
            </View>}

            {hasScanned && (
              <View style={styles.results}>
                {matches.length === 0 ? (
                  <>
                    <View style={styles.noMatchHeader}>
                      <View style={styles.noMatchDot}><AppIcon name="close" color="#A13A32" size={17} /></View>
                      <View style={styles.noMatchCopy}>
                        <Text accessibilityRole="header" style={styles.resultsTitle}>No matching part found</Text>
                        <Text style={styles.resultHint}>Check the code or try a manual search.</Text>
                      </View>
                    </View>
                    <Text selectable style={styles.scannedCode}>{scannedValue}</Text>
                  </>
                ) : (
                  <>
                    <View style={styles.matchHeader}>
                      <View style={styles.matchDot}><Text style={styles.matchCheck}>✓</Text></View>
                      <View style={styles.noMatchCopy}>
                        <Text accessibilityRole="header" style={styles.resultsTitle}>Match found</Text>
                        <Text style={styles.resultHint}>{matches.length === 1 ? '1 stock record found' : `${matches.length} locations found`}</Text>
                        {matches.length > 1 && <Text style={styles.resultInstruction}>Choose the location you’re checking.</Text>}
                      </View>
                    </View>
                    {matches.map(item => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View ${item.partNumber} at ${item.storeName}, ${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}`}
                        accessibilityState={{selected: selectedMatchId === item.id}}
                        key={item.id}
                        onPress={() => setSelectedMatchId(item.id)}
                        style={[styles.resultCard, selectedMatchId === item.id && styles.resultCardSelected]}
                      >
                        <View style={styles.locationMark}><AppIcon name="inventory" color={palette.navy} size={18} /></View>
                        <View style={styles.resultCopy}>
                          <Text style={styles.resultPart}>{item.partNumber}</Text>
                          <Text style={styles.resultDescription} numberOfLines={2}>{item.description}</Text>
                          <Text style={styles.resultStore}>{item.storeName}</Text>
                          <Text style={styles.resultQuantityInline}>{item.quantity} {item.quantity === 1 ? 'unit' : 'units'} · {item.quantity === 0 ? 'Out of stock' : item.quantity <= item.minThreshold ? 'Low stock' : 'In stock'}</Text>
                        </View>
                        <View style={[styles.radio, selectedMatchId === item.id && styles.radioSelected]}>{selectedMatchId === item.id && <View style={styles.radioDot} />}</View>
                      </Pressable>
                    ))}
                  </>
                )}
                {matches.length > 0 && <Pressable accessibilityRole="button" disabled={selectedMatchId === null}
                  onPress={() => {const selected = matches.find(item => item.id === selectedMatchId); if (selected) openItem(selected);}}
                  style={[styles.openDetailsButton, selectedMatchId === null && styles.actionDisabled]}><Text style={styles.openDetailsText}>Open item details</Text></Pressable>}
                <View style={styles.resultActions}>
                  <Pressable accessibilityRole="button" onPress={scanAgain} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Scan again</Text></Pressable>
                  {matches.length === 0 && <Pressable accessibilityRole="button" onPress={scanAgain} style={styles.manualSearchButton}><Text style={styles.manualSearchText}>Search manually</Text></Pressable>}
                </View>
              </View>
            )}
            </ScrollView>
          </>
        )}
      </View>
      <AppBottomNavigation active="scan" />
    </SafeAreaView>
  );
}

const palette = {navy: '#15263B', amber: '#E9A23B', slate: '#64748B', background: '#F5F7FA', white: '#FFFFFF', border: '#CBD5E1', muted: '#475569'};
const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: palette.navy},
  screen: {flex: 1, paddingHorizontal: 16},
  topBar: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#34475C'},
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  backButtonText: {fontSize: 30, lineHeight: 33, color: palette.white},
  brandIcon: {width: 40, height: 40, borderRadius: 12},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.white},
  pageTitle: {fontSize: 12, fontWeight: '600', color: '#C4D0DC'},
  scanHeading: {marginTop: 12},
  scanTitle: {fontSize: 21, lineHeight: 27, fontWeight: '800', color: palette.white},
  intro: {marginTop: 3, fontSize: 13, lineHeight: 19, color: '#C4D0DC'},
  scanContent: {flex: 1, marginTop: 11},
  scanContentInner: {paddingBottom: 14},
  cameraFrame: {height: 320, overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: '#43576D', backgroundColor: '#0D1B2B'},
  scanFrame: {position: 'absolute', top: '18%', right: '14%', bottom: '18%', left: '14%', borderWidth: 2, borderColor: palette.amber, borderRadius: 16},
  scanCorners: {flex: 1, margin: -3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 18},
  scanPrompt: {position: 'absolute', top: 10, left: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(21,38,59,0.84)'},
  scanPromptText: {fontSize: 12, fontWeight: '700', color: palette.white},
  torchButton: {position: 'absolute', right: 12, bottom: 12, minWidth: 78, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(21,38,59,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)'},
  torchButtonActive: {backgroundColor: palette.amber, borderColor: palette.amber},
  torchLabel: {fontSize: 12, fontWeight: '800', color: palette.white},
  torchLabelActive: {color: palette.navy},
  manualEntry: {marginTop: 10, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  manualTitle: {fontSize: 14, fontWeight: '800', color: palette.navy},
  manualHint: {marginTop: 2, fontSize: 11, color: palette.slate},
  manualForm: {flexDirection: 'column', gap: 8, marginTop: 9},
  manualInput: {height: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 14, color: palette.navy},
  manualButton: {height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: palette.amber},
  manualButtonDisabled: {opacity: 0.5},
  manualButtonText: {fontSize: 13, fontWeight: '800', color: palette.navy},
  permissionCard: {marginTop: 12, padding: 18, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  permissionTitle: {fontSize: 16, fontWeight: '700', textAlign: 'center', color: palette.navy},
  permissionDescription: {marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center', color: palette.muted},
  permissionButton: {minHeight: 48, minWidth: 144, marginTop: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white, paddingHorizontal: 14},
  permissionNote: {marginTop: 9, fontSize: 12, color: palette.slate},
  permissionButtonText: {fontSize: 14, fontWeight: '700', color: palette.navy},
  permissionError: {marginTop: 10, fontSize: 13, lineHeight: 19, textAlign: 'center', color: '#A13A32'},
  messageState: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  messageTitle: {fontSize: 17, fontWeight: '800', textAlign: 'center', color: palette.white},
  messageText: {marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center', color: '#C4D0DC'},
  primaryButton: {minHeight: 48, minWidth: 144, marginTop: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.amber, paddingHorizontal: 14},
  primaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  secondaryButton: {minHeight: 48, marginTop: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white},
  secondaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  results: {marginTop: 12, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  resultsTitle: {fontSize: 15, fontWeight: '800', color: palette.navy},
  matchHeader: {flexDirection: 'row', alignItems: 'center', gap: 10},
  matchDot: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#D9F0E2'},
  matchCheck: {fontSize: 19, fontWeight: '900', color: '#21653A'},
  noMatchHeader: {flexDirection: 'row', alignItems: 'center', gap: 12},
  noMatchDot: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#FCE8E6'},
  noMatchCopy: {flex: 1},
  scannedCodeLabel: {marginTop: 12, fontSize: 12, fontWeight: '700', color: palette.slate},
  scannedCode: {marginTop: 3, fontSize: 16, lineHeight: 22, fontWeight: '700', color: palette.navy},
  resultHint: {marginTop: 4, fontSize: 13, lineHeight: 19, color: palette.slate},
  resultInstruction: {marginTop: 2, fontSize: 11, lineHeight: 16, color: palette.slate},
  resultCard: {minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 9, padding: 9, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  resultCardSelected: {borderColor: palette.navy, borderWidth: 1.5},
  locationMark: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.background},
  resultCopy: {flex: 1},
  resultPart: {fontSize: 14, fontWeight: '800', color: palette.navy},
  resultDescription: {marginTop: 2, fontSize: 13, color: palette.muted},
  resultStore: {marginTop: 4, fontSize: 12, fontWeight: '700', color: palette.slate},
  resultQuantityInline: {marginTop: 5, fontSize: 12, fontWeight: '800', color: palette.navy},
  radio: {width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderColor: palette.slate},
  radioSelected: {borderColor: palette.navy},
  radioDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: palette.navy},
  openDetailsButton: {minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 11, borderRadius: 10, backgroundColor: palette.navy},
  openDetailsText: {fontSize: 13, fontWeight: '800', color: palette.white},
  resultActions: {flexDirection: 'row', gap: 8, marginTop: 8},
  actionDisabled: {opacity: 0.5},
  manualSearchButton: {flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  manualSearchText: {fontSize: 12, fontWeight: '700', color: palette.navy},
});
