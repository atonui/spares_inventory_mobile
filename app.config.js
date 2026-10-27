const allowedVariants = new Set(['development', 'demo', 'staging', 'production']);

export default ({config}) => {
  const appVariant = process.env.EXPO_PUBLIC_APP_VARIANT ?? 'development';
  if (!allowedVariants.has(appVariant)) {
    throw new Error(`Unsupported EXPO_PUBLIC_APP_VARIANT: ${appVariant}`);
  }

  const isInternalVariant = appVariant === 'demo' || appVariant === 'staging';
  const suffix = appVariant === 'demo' ? '.demo' : appVariant === 'staging' ? '.staging' : '';
  const label = appVariant === 'demo' ? ' Demo' : appVariant === 'staging' ? ' Staging' : '';

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      'expo-sqlite',
      ['expo-audio', {
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      }],
    ],
    name: `${config.name}${label}`,
    ios: {
      ...config.ios,
      bundleIdentifier: isInternalVariant ? `${config.ios.bundleIdentifier}${suffix}` : config.ios.bundleIdentifier,
    },
    android: {
      ...config.android,
      package: isInternalVariant ? `${config.android.package}${suffix}` : config.android.package,
    },
    extra: {
      ...config.extra,
      appVariant,
    },
  };
};
