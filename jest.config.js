module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest.setup.js'],
  // The native runtime probe's runner tests use node:test (`node --test`), not Jest.
  testPathIgnorePatterns: ['/node_modules/', '/scripts/native-runtime-probe/'],
};
