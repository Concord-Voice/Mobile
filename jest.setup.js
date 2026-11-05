/* eslint-env jest */
// Native safe-area module is absent under Jest; use the package's own mock (zero insets).
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
