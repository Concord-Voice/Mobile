module.exports = {
  preset: '@react-native/jest-preset',
  // The native runtime probe's runner tests use node:test (`node --test`), not Jest.
  testPathIgnorePatterns: ['/node_modules/', '/scripts/native-runtime-probe/'],
};
