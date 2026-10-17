const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Detector models ship as assets (react-native-fast-tflite).
config.resolver.assetExts.push('tflite');

module.exports = withNativeWind(config, { input: './src/global.css' });
