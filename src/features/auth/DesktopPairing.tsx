import {useEffect, useRef, useState} from 'react';
import {CameraView, useCameraPermissions} from 'expo-camera';
import * as Linking from 'expo-linking';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {AppIcon} from '../navigation/AppIcon';
import type {MobilePairingCredential} from '../../api/client';

const palette = {
  navy: '#15263B',
  amber: '#E9A23B',
  slate: '#64748B',
  background: '#F5F7FA',
  white: '#FFFFFF',
  border: '#CBD5E1',
  muted: '#475569',
  danger: '#A13A32',
  dangerTint: '#FFF0EE',
};

type Props = {
  mockMode: boolean;
  onPair: (credential: MobilePairingCredential, onApprovalRequired: () => void) => Promise<void>;
  onCancel?: () => void;
  onPhaseChange?: (phase: Phase) => void;
};

type Phase = 'welcome' | 'scan' | 'code' | 'pending';

export const PREVIEW_PAIRING_QR = 'sparesflow://pair?token=preview-pairing-token';

export default function DesktopPairing({mockMode, onPair, onCancel, onPhaseChange}: Props) {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [cameraMountError, setCameraMountError] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [retryingCamera, setRetryingCamera] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const scanned = useRef(false);

  useEffect(() => {onPhaseChange?.(phase);}, [onPhaseChange, phase]);

  async function beginPairing(credential: MobilePairingCredential) {
    if (scanned.current) return;
    scanned.current = true;
    setError('');
    setApprovalRequired(false);
    setPhase('pending');
    try {
      await onPair(credential, () => setApprovalRequired(true));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pairing could not be completed. Try again.');
      setPhase('pairingCode' in credential ? 'code' : 'scan');
      scanned.current = false;
    }
  }

  function cancelPairing() {
    scanned.current = false;
    onCancel?.();
    setError('');
    setPhase('welcome');
  }

  async function openCameraSettings() {
    setError('');
    try {
      await Linking.openSettings();
    } catch {
      setError('Could not open device settings. Open Settings and enable camera access for Spares Tracker.');
    }
  }

  async function checkCameraPermission() {
    setError('');
    try {
      const currentPermission = await getPermission();
      if (!currentPermission.granted) {
        setError('Camera access is still off. Enable it in device settings, then check again.');
      }
    } catch {
      setError('Camera access could not be checked. Try again.');
    }
  }

  async function retryCamera() {
    setError('');
    setCameraMountError(false);
    setRetryingCamera(true);
    try {
      const currentPermission = await getPermission();
      if (currentPermission.granted) setCameraAttempt(attempt => attempt + 1);
    } catch {
      setCameraMountError(true);
      setError('Camera access could not be checked. Try again.');
    } finally {
      setRetryingCamera(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {phase === 'pending' ? 'Approve this device' : 'Pair with your desktop'}
      </Text>
      {phase === 'welcome' && (
        <>
          <Text style={styles.body}>
            On your signed-in desktop, open your profile and generate a one-time QR code or manual pairing code.
          </Text>
          <View style={styles.steps}>
            <Step number="1" text="Open Spares Tracker on your desktop" />
            <Step number="2" text="Go to Profile → Connect mobile app" />
            <Step number="3" text="Scan the QR code or enter its code, then approve this device there" />
          </View>
          <View style={styles.qrGuide}>
            <View style={styles.qrMark}><AppIcon name="scan" color={palette.white} size={20} /></View>
            <View style={styles.qrCopy}>
              <Text style={styles.qrTitle}>Ready to connect</Text>
              <Text style={styles.qrDescription}>Scan the one-time QR code on your desktop, or enter its pairing code if the camera cannot scan. The Scan screen also reads stock barcodes and QR codes.</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={() => {setError(''); setPhase('scan');}} style={styles.primaryButton}>
            <AppIcon name="scan" color={palette.white} size={18} />
            <Text style={styles.primaryButtonText}>Scan pairing QR</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => {setError(''); setPhase('code');}} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Enter pairing code</Text>
          </Pressable>
          <Text style={styles.privacyNote}>The QR code and manual code expire in two minutes and can each be used once.</Text>
          {mockMode && (
            <Pressable accessibilityRole="button" onPress={() => void beginPairing({qrData: PREVIEW_PAIRING_QR})} style={styles.previewButton}>
              <Text style={styles.previewButtonText}>Try preview pairing</Text>
            </Pressable>
          )}
        </>
      )}

      {phase === 'code' && (
        <>
          <Text style={styles.body}>Enter the one-time code shown beside the QR code in your desktop profile. Desktop approval is still required.</Text>
          <TextInput
            accessibilityLabel="Pairing code"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={11}
            onChangeText={value => {
              const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
              setPairingCode(normalized.length > 5 ? `${normalized.slice(0, 5)}-${normalized.slice(5)}` : normalized);
            }}
            placeholder="ABCDE-23456"
            placeholderTextColor={palette.slate}
            style={styles.codeInput}
            value={pairingCode}
          />
          <Pressable
            accessibilityRole="button"
            disabled={pairingCode.replace('-', '').length !== 10}
            onPress={() => void beginPairing({pairingCode})}
            style={[styles.primaryButton, pairingCode.replace('-', '').length !== 10 && styles.disabledButton]}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
          <Text style={styles.privacyNote}>This code expires in two minutes and can be used once.</Text>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" onPress={cancelPairing} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Back</Text>
          </Pressable>
        </>
      )}

      {phase === 'scan' && (
        <>
          <Text style={styles.body}>Hold your camera over the QR code shown in your desktop profile.</Text>
          {permission?.granted ? (
            cameraMountError ? (
              <View style={styles.cameraFailureCard}>
                <AppIcon name="scan" color={palette.slate} size={24} />
                <Text style={styles.cameraFailureTitle}>Camera couldn’t start</Text>
                <Text style={styles.cameraFailureBody}>Check that no other app is using the camera, then try again.</Text>
                <Pressable accessibilityRole="button" disabled={retryingCamera} onPress={() => void retryCamera()} style={styles.cameraRetryButton}>
                  {retryingCamera ? <ActivityIndicator color={palette.navy} /> : <Text style={styles.cameraRetryText}>Try camera again</Text>}
                </Pressable>
              </View>
            ) : (
              <View style={styles.cameraFrame}>
                <CameraView
                  key={cameraAttempt}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{barcodeTypes: ['qr']}}
                  onBarcodeScanned={({data}) => void beginPairing({qrData: data})}
                  onMountError={() => setCameraMountError(true)}
                />
                <View pointerEvents="none" style={styles.scanFrame}><View style={styles.scanCorners} /></View>
              </View>
            )
          ) : (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>Camera access is needed to scan your QR code</Text>
              <Text style={styles.permissionBody}>The camera scans a one-time QR code to pair this phone. The Scan screen uses it to look up stock by barcode or QR code.</Text>
              {!!permission && !permission.canAskAgain ? (
                <>
                  <Text style={styles.permissionBody}>Camera access is turned off. Open device settings to allow camera access for Spares Tracker, then return and check again.</Text>
                  <Pressable accessibilityRole="button" onPress={() => void openCameraSettings()} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Open device settings</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => void checkCameraPermission()} style={styles.settingsCheckButton}>
                    <Text style={styles.settingsCheckButtonText}>Check camera access</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Allow camera</Text>
                </Pressable>
              )}
            </View>
          )}
          <Pressable accessibilityRole="button" onPress={() => {setError(''); setPhase('code');}} style={styles.manualCodeButton}>
            <Text style={styles.manualCodeButtonText}>Enter pairing code instead</Text>
          </Pressable>
          {mockMode && (
            <Pressable accessibilityRole="button" onPress={() => void beginPairing({qrData: PREVIEW_PAIRING_QR})} style={styles.previewButton}>
              <Text style={styles.previewButtonText}>Use preview QR</Text>
            </Pressable>
          )}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" onPress={cancelPairing} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Back</Text>
          </Pressable>
        </>
      )}

      {phase === 'pending' && (
        <View style={styles.pendingCard}>
          <ActivityIndicator size="large" color={palette.navy} />
          <Text accessibilityRole="text" style={styles.pendingTitle}>
            {approvalRequired ? 'Waiting for desktop approval' : 'Requesting approval'}
          </Text>
          <Text style={styles.body}>
            Keep this screen open. Confirm the device sign-in request in your desktop account.
          </Text>
          <Pressable accessibilityRole="button" onPress={cancelPairing} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Cancel pairing</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function Step({number, text}: {number: string; text: string}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {flexGrow: 1, justifyContent: 'center', padding: 18, backgroundColor: palette.white, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, borderWidth: 1, borderColor: palette.border},
  title: {fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.2, color: palette.navy},
  body: {marginTop: 6, fontSize: 13, lineHeight: 19, color: palette.muted},
  steps: {gap: 11, marginTop: 18, marginBottom: 18},
  step: {flexDirection: 'row', alignItems: 'center', gap: 12},
  stepNumber: {width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#FEF3DF'},
  stepNumberText: {fontSize: 13, fontWeight: '800', color: palette.navy},
  stepText: {flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: palette.navy},
  qrGuide: {flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 13, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, backgroundColor: palette.background},
  qrMark: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.navy},
  qrCopy: {flex: 1},
  qrTitle: {fontSize: 12, fontWeight: '800', color: palette.navy},
  qrDescription: {marginTop: 2, fontSize: 11, lineHeight: 16, color: palette.muted},
  primaryButton: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, backgroundColor: palette.navy},
  primaryButtonText: {fontSize: 14, fontWeight: '800', color: palette.white},
  disabledButton: {opacity: 0.5},
  codeInput: {height: 54, marginTop: 18, marginBottom: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: palette.border, borderRadius: 11, backgroundColor: palette.white, color: palette.navy, fontSize: 18, fontWeight: '800', letterSpacing: 2, textAlign: 'center'},
  privacyNote: {marginTop: 13, textAlign: 'center', fontSize: 12, lineHeight: 18, color: palette.slate},
  previewButton: {minHeight: 46, marginTop: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background},
  previewButtonText: {fontSize: 13, fontWeight: '700', color: palette.navy},
  cameraFrame: {height: 300, marginTop: 22, overflow: 'hidden', borderRadius: 18, backgroundColor: '#0B1726'},
  cameraFailureCard: {height: 300, alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 22, padding: 20, borderRadius: 18, backgroundColor: palette.background},
  cameraFailureTitle: {fontSize: 16, fontWeight: '800', textAlign: 'center', color: palette.navy},
  cameraFailureBody: {maxWidth: 260, fontSize: 13, lineHeight: 19, textAlign: 'center', color: palette.muted},
  cameraRetryButton: {minHeight: 44, marginTop: 5, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#FEF3DF'},
  cameraRetryText: {fontSize: 13, fontWeight: '800', color: palette.navy},
  scanFrame: {position: 'absolute', top: '20%', right: '16%', bottom: '20%', left: '16%', borderWidth: 2, borderColor: palette.amber, borderRadius: 14},
  scanCorners: {flex: 1, margin: -3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 16},
  permissionCard: {marginTop: 22, padding: 18, borderRadius: 14, backgroundColor: palette.background},
  permissionTitle: {fontSize: 15, lineHeight: 21, fontWeight: '700', color: palette.navy},
  permissionBody: {marginTop: 8, fontSize: 13, lineHeight: 19, color: palette.muted},
  secondaryButton: {minHeight: 44, marginTop: 15, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.navy},
  secondaryButtonText: {fontSize: 14, fontWeight: '700', color: palette.white},
  settingsCheckButton: {minHeight: 44, marginTop: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  settingsCheckButtonText: {fontSize: 14, fontWeight: '700', color: palette.navy},
  manualCodeButton: {minHeight: 44, marginTop: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  manualCodeButtonText: {fontSize: 14, fontWeight: '700', color: palette.navy},
  textButton: {alignSelf: 'center', minHeight: 44, marginTop: 15, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  textButtonLabel: {fontSize: 14, fontWeight: '700', color: palette.slate},
  pendingCard: {alignItems: 'center', marginTop: 20, padding: 22, borderRadius: 16, backgroundColor: palette.background},
  pendingTitle: {marginTop: 15, fontSize: 17, fontWeight: '800', color: palette.navy},
  error: {marginTop: 13, padding: 12, borderRadius: 10, color: palette.danger, backgroundColor: palette.dangerTint, fontSize: 13, lineHeight: 19},
});
