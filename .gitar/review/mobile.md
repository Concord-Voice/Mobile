# Mobile review guidance

React Native client for iOS and Android. Message crypto lives in the native pod `native/ConcordCrypto` (CryptoKit AES-256-GCM, Security.framework RSA-OAEP-4096, Argon2id, biometry-bound Keychain). JS holds only opaque key handles through `src/ConcordCrypto.ts`.

## Crypto and key custody

- Message crypto stays in native Swift. Flag any JS implementation of encryption, decryption or key derivation, and any change that returns raw key bytes to JS.
- Minimums: AES-256-GCM, RSA-OAEP 4096, Argon2id. No MD5, SHA-1 (integrity), DES, RC4 or ECB. No new third-party crypto library.
- Flag any encryption opt-out, fallback, or `isEncrypted`-style branch.
- Key epochs: the server is authoritative. A key served for a different epoch than requested is refused.

## Token storage and background work

- Tokens live in the Keychain, never AsyncStorage or plaintext files.
- Background refresh must keep working (future push depends on it). Items read during background work use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`; flag a change to `WhenUnlocked` or a biometry requirement on anything background refresh reads.
- The App Attest key stays in the Secure Enclave; its id stays in a device-only Keychain item.

## Network

- Every socket opens with the fixed origin `app://concord-mobile` through `createSocket`.
- Requests carry `X-Concord-Client-Version` and `X-Concord-Client-Platform`; do not drop them.
- Treat every server payload as untrusted and validate its shape before use.
- Never log tokens, keys or message payloads.

## Repository rules

- This repository is private, so no SonarCloud workflow: Sonar runs only on public repositories. Flag one being added.
- iOS signing, entitlements and `Info.plist` export-compliance keys change only with explicit review.
