module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['scripts/native-runtime-probe/*.mjs'],
      env: { node: true },
      parserOptions: { ecmaVersion: 2022 },
    },
  ],
};
