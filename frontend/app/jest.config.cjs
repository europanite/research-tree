module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setupFiles.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '\\.(png|jpe?g|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
    '\\.(css|scss)$': '<rootDir>/__mocks__/styleMock.js',
    '^expo-constants$': '<rootDir>/__mocks__/expoConstantsMock.js'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-navigation|expo|@expo/.*|expo-.*|react-native-svg|react-native-screens)/)'
  ],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)']
};
