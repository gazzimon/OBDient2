module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
      ],
      // Must be listed last; excluded in Jest because it requires native worklets
      ...(process.env['JEST_WORKER_ID'] ? [] : ['react-native-reanimated/plugin']),
    ],
  };
};
