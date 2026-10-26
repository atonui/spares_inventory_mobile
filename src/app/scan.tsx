import {useEffect, useRef, useState} from 'react';
import {CameraView, useCameraPermissions, type BarcodeType} from 'expo-camera';
import * as Haptics from 'expo-haptics';
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
  const [permissionError, setPermissionError] = useState('');
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [manualPartNumber, setManualPartNumber] = useState('');
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
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
    setMatches(findInventoryMatches(inventory, value));
  }

  function scanAgain() {
    scanned.current = false;
    setHasScanned(false);
    setScannedValue('');
    setMatches([]);
    setTorchEnabled(false);
  }

  function findPartNumber() {
    const partNumber = manualPartNumber.trim();
    if (!partNumber) return;
    Keyboard.dismiss();
    setTorchEnabled(false);
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

        <Text style={styles.intro}>Scan a code or enter a part number to check stock saved on this device.</Text>

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
              <View style={styles.cameraFrame}>
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

            {!hasScanned && (
              <View style={styles.manualEntry}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{expanded: manualEntryVisible}}
                  onPress={() => setManualEntryVisible(value => !value)}
                  style={styles.manualFallbackToggle}
                >
                  <Text style={styles.manualFallbackText}>
                    {manualEntryVisible ? 'Hide part-number entry' : 'Can’t scan? Enter part number'}
                  </Text>
                </Pressable>
                {manualEntryVisible && (
                  <View style={styles.manualForm}>
                    <TextInput
                      accessibilityLabel="Part number"
                      value={manualPartNumber}
                      onChangeText={setManualPartNumber}
                      onSubmitEditing={findPartNumber}
                      placeholder="e.g. BRK-2048"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="search"
                      style={styles.manualInput}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={!manualPartNumber.trim()}
                      onPress={findPartNumber}
                      style={[styles.manualButton, !manualPartNumber.trim() && styles.manualButtonDisabled]}
                    >
                      <Text style={styles.manualButtonText}>Find</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            {hasScanned && (
              <View style={styles.results}>
                {matches.length === 0 ? (
                  <>
                    <Text accessibilityRole="header" style={styles.resultsTitle}>No matching part number</Text>
                    <Text style={styles.scannedCodeLabel}>Scanned code</Text>
                    <Text selectable style={styles.scannedCode}>{scannedValue}</Text>
                    <Text style={styles.messageText}>This scan checks exact part numbers in the inventory saved on this device. Refresh Inventory or check the code and try again.</Text>
                  </>
                ) : (
                  <>
                    <Text accessibilityRole="header" style={styles.resultsTitle}>
                      {matches.length === 1 ? '1 matching stock record' : `Stock found in ${matches.length} locations`}
                    </Text>
                    {matches.length > 1 && <Text style={styles.resultHint}>Choose the store you’re checking.</Text>}
                    {matches.map(item => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View ${item.partNumber} at ${item.storeName}, ${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}`}
                        key={item.id}
                        onPress={() => openItem(item)}
                        style={styles.resultCard}
                      >
                        <View style={styles.resultCopy}>
                          <Text style={styles.resultPart}>{item.partNumber}</Text>
                          <Text style={styles.resultDescription}>{item.description}</Text>
                          <Text style={styles.resultStore}>{item.storeName}</Text>
                          <Text style={styles.resultAction}>View stock details</Text>
                        </View>
                        <Text style={styles.resultQuantity}>{item.quantity} <Text style={styles.resultUnit}>{item.quantity === 1 ? 'unit' : 'units'}</Text></Text>
                      </Pressable>
                    ))}
                  </>
                )}
                <Pressable accessibilityRole="button" onPress={scanAgain} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Scan again</Text>
                </Pressable>
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
  safeArea: {flex: 1, backgroundColor: palette.background},
  screen: {flex: 1, paddingHorizontal: 20},
  topBar: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: palette.border},
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12},
  backButtonText: {fontSize: 30, lineHeight: 33, color: palette.navy},
  brandIcon: {width: 40, height: 40, borderRadius: 12},
  brandCopy: {flex: 1},
  wordmark: {fontSize: 17, fontWeight: '800', color: palette.navy},
  pageTitle: {fontSize: 13, fontWeight: '600', color: palette.muted},
  intro: {marginTop: 18, fontSize: 14, lineHeight: 21, color: palette.muted},
  scanContent: {flex: 1, marginTop: 16},
  scanContentInner: {paddingBottom: 16},
  cameraFrame: {height: 280, overflow: 'hidden', borderRadius: 18, backgroundColor: palette.navy},
  scanFrame: {position: 'absolute', top: '18%', right: '14%', bottom: '18%', left: '14%', borderWidth: 2, borderColor: palette.amber, borderRadius: 16},
  scanCorners: {flex: 1, margin: -3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 18},
  torchButton: {position: 'absolute', right: 12, bottom: 12, minWidth: 78, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(21,38,59,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)'},
  torchButtonActive: {backgroundColor: palette.amber, borderColor: palette.amber},
  torchLabel: {fontSize: 12, fontWeight: '800', color: palette.white},
  torchLabelActive: {color: palette.navy},
  manualEntry: {marginTop: 8},
  manualFallbackToggle: {minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10},
  manualFallbackText: {fontSize: 13, fontWeight: '700', color: palette.slate, textDecorationLine: 'underline'},
  manualForm: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4},
  manualInput: {flex: 1, height: 48, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, fontSize: 15, color: palette.navy},
  manualButton: {minWidth: 68, height: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: palette.amber},
  manualButtonDisabled: {opacity: 0.5},
  manualButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  permissionCard: {marginTop: 18, padding: 18, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  permissionTitle: {fontSize: 16, fontWeight: '700', textAlign: 'center', color: palette.navy},
  permissionDescription: {marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center', color: palette.muted},
  permissionButton: {minHeight: 48, minWidth: 144, marginTop: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white, paddingHorizontal: 14},
  permissionButtonText: {fontSize: 14, fontWeight: '700', color: palette.navy},
  permissionError: {marginTop: 10, fontSize: 13, lineHeight: 19, textAlign: 'center', color: '#A13A32'},
  messageState: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  messageTitle: {fontSize: 17, fontWeight: '800', textAlign: 'center', color: palette.navy},
  messageText: {marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center', color: palette.muted},
  primaryButton: {minHeight: 48, minWidth: 144, marginTop: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.amber, paddingHorizontal: 14},
  primaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  secondaryButton: {minHeight: 48, marginTop: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.navy, backgroundColor: palette.white},
  secondaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.navy},
  results: {marginTop: 16, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  resultsTitle: {fontSize: 16, fontWeight: '800', color: palette.navy},
  scannedCodeLabel: {marginTop: 12, fontSize: 12, fontWeight: '700', color: palette.slate},
  scannedCode: {marginTop: 3, fontSize: 16, lineHeight: 22, fontWeight: '700', color: palette.navy},
  resultHint: {marginTop: 5, fontSize: 13, lineHeight: 19, color: palette.slate},
  resultCard: {minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border},
  resultCopy: {flex: 1},
  resultPart: {fontSize: 14, fontWeight: '800', color: palette.navy},
  resultDescription: {marginTop: 2, fontSize: 13, color: palette.muted},
  resultStore: {marginTop: 4, fontSize: 12, fontWeight: '700', color: palette.slate},
  resultAction: {marginTop: 8, fontSize: 12, fontWeight: '800', color: palette.navy},
  resultQuantity: {fontSize: 18, fontWeight: '800', color: palette.navy},
  resultUnit: {fontSize: 11, fontWeight: '600', color: palette.slate},
});
