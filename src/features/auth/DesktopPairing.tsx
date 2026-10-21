import {useRef, useState} from 'react';
import {CameraView, useCameraPermissions} from 'expo-camera';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';

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
  onPair: (qrData: string, onApprovalRequired: () => void) => Promise<void>;
  onCancel?: () => void;
};

type Phase = 'welcome' | 'scan' | 'pending';

export const PREVIEW_PAIRING_QR = 'sparesflow://pair?token=preview-pairing-token';

export default function DesktopPairing({mockMode, onPair, onCancel}: Props) {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const scanned = useRef(false);

  async function beginPairing(qrData: string) {
    if (scanned.current) return;
    scanned.current = true;
    setError('');
    setApprovalRequired(false);
    setPhase('pending');
    try {
      await onPair(qrData, () => setApprovalRequired(true));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pairing could not be completed. Try again.');
      setPhase('scan');
      scanned.current = false;
    }
  }

  function cancelPairing() {
    scanned.current = false;
    onCancel?.();
    setError('');
    setPhase('welcome');
  }

  return (
    <View style={styles.page}>
      <View style={styles.brandMark} accessibilityElementsHidden>
        <Text style={styles.brandGlyph}>▰</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {phase === 'pending' ? 'Approve this device' : 'Sign in through your desktop account'}
      </Text>
      {phase === 'welcome' && (
        <>
          <Text style={styles.body}>
            Sign in to Spares Tracker on your desktop first. In Profile, choose Connect mobile app and generate a one-time QR code.
          </Text>
          <View style={styles.steps}>
            <Step number="1" text="Open Spares Tracker on your desktop" />
            <Step number="2" text="Go to Profile → Connect mobile app" />
            <Step number="3" text="Scan the QR code and approve this device there" />
          </View>
          <Pressable accessibilityRole="button" onPress={() => {setError(''); setPhase('scan');}} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Scan QR code</Text>
          </Pressable>
          <Text style={styles.privacyNote}>The QR code expires quickly and can only be used once.</Text>
          {mockMode && (
            <Pressable accessibilityRole="button" onPress={() => void beginPairing(PREVIEW_PAIRING_QR)} style={styles.previewButton}>
              <Text style={styles.previewButtonText}>Try preview pairing</Text>
            </Pressable>
          )}
        </>
      )}

      {phase === 'scan' && (
        <>
          <Text style={styles.body}>Hold your camera over the QR code shown in your desktop profile.</Text>
          {permission?.granted ? (
            <View style={styles.cameraFrame}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{barcodeTypes: ['qr']}}
                onBarcodeScanned={({data}) => void beginPairing(data)}
              />
              <View pointerEvents="none" style={styles.scanFrame}><View style={styles.scanCorners} /></View>
            </View>
          ) : (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>Camera access is needed to scan your QR code</Text>
              <Text style={styles.permissionBody}>SparesFlow uses the camera for QR scanning only.</Text>
              {!!permission && !permission.canAskAgain ? (
                <Text style={styles.permissionBody}>Enable camera access in your device settings, then return here.</Text>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Allow camera</Text>
                </Pressable>
              )}
            </View>
          )}
          {mockMode && (
            <Pressable accessibilityRole="button" onPress={() => void beginPairing(PREVIEW_PAIRING_QR)} style={styles.previewButton}>
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
    </View>
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
  page: {flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border},
  brandMark: {width: 54, height: 54, marginBottom: 22, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.navy},
  brandGlyph: {color: palette.amber, fontSize: 22, fontWeight: '900'},
  title: {fontSize: 27, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5, color: palette.navy},
  body: {marginTop: 9, fontSize: 15, lineHeight: 23, color: palette.muted},
  steps: {gap: 14, marginTop: 24, marginBottom: 25},
  step: {flexDirection: 'row', alignItems: 'center', gap: 12},
  stepNumber: {width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#FEF3DF'},
  stepNumberText: {fontSize: 13, fontWeight: '800', color: palette.navy},
  stepText: {flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: palette.navy},
  primaryButton: {minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.amber},
  primaryButtonText: {fontSize: 15, fontWeight: '800', color: palette.navy},
  privacyNote: {marginTop: 13, textAlign: 'center', fontSize: 12, lineHeight: 18, color: palette.slate},
  previewButton: {minHeight: 46, marginTop: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background},
  previewButtonText: {fontSize: 13, fontWeight: '700', color: palette.navy},
  cameraFrame: {height: 300, marginTop: 22, overflow: 'hidden', borderRadius: 18, backgroundColor: '#0B1726'},
  scanFrame: {position: 'absolute', top: '20%', right: '16%', bottom: '20%', left: '16%', borderWidth: 2, borderColor: palette.amber, borderRadius: 14},
  scanCorners: {flex: 1, margin: -3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 16},
  permissionCard: {marginTop: 22, padding: 18, borderRadius: 14, backgroundColor: palette.background},
  permissionTitle: {fontSize: 15, lineHeight: 21, fontWeight: '700', color: palette.navy},
  permissionBody: {marginTop: 8, fontSize: 13, lineHeight: 19, color: palette.muted},
  secondaryButton: {minHeight: 44, marginTop: 15, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.navy},
  secondaryButtonText: {fontSize: 14, fontWeight: '700', color: palette.white},
  textButton: {alignSelf: 'center', minHeight: 44, marginTop: 15, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center'},
  textButtonLabel: {fontSize: 14, fontWeight: '700', color: palette.slate},
  pendingCard: {alignItems: 'center', marginTop: 20, padding: 22, borderRadius: 16, backgroundColor: palette.background},
  pendingTitle: {marginTop: 15, fontSize: 17, fontWeight: '800', color: palette.navy},
  error: {marginTop: 13, padding: 12, borderRadius: 10, color: palette.danger, backgroundColor: palette.dangerTint, fontSize: 13, lineHeight: 19},
});
