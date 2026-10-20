const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Trouble-code base (scripts/build-dtc-base.py): read from disk on first use,
// not parsed with the JS bundle at start.
config.resolver.assetExts.push('dtcdb');

module.exports = withNativeWind(config, { input: './src/global.css' });
