const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Polyfills nécessaires pour ethers.js v6 dans React Native / Expo
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve('react-native-get-random-values'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('@ethersproject/shims'),
  process: require.resolve('process/browser'),
  events: require.resolve('events'),
};

// S'assurer que les polyfills sont dans les sourceExts
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'cjs',
];

module.exports = config;
