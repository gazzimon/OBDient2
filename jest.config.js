/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Ships untranspiled ESM and needs the native module — neither exists in the
    // node test environment. Persisted stores only need somewhere to put strings.
    '^react-native-mmkv$': '<rootDir>/src/__mocks__/react-native-mmkv.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.test.json' }],
  },
};
