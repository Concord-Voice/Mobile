# Android native crypto port (as built)

Approved by Mark on 2026-11-04. The review copy is the "Android E2EE crypto port: design" Claude Doc. This file records what shipped and where it differs from that copy.

## Goal

`native/ConcordCrypto/android` is the Kotlin counterpart of the iOS `ConcordCrypto` pod. It is byte-for-byte compatible with the desktop's `crypto.ts`. The JS surface (`src/ConcordCrypto.ts`) is unchanged: the same 16 methods, uppercase UUID handles, and `E_CONCORD_CRYPTO_<CASE>` reject codes. Keys never enter JS. Attestation is out of scope (`ConcordAttest` is iOS-only for now).

## Primitives

| Operation | Android | Parity note |
| --- | --- | --- |
| AES-256-GCM | `AES/GCM/NoPadding`, 128-bit tag, 12-byte IV from `SecureRandom` | Framed as IV ‖ ciphertext ‖ tag, as desktop and iOS do. |
| RSA-OAEP-4096 | `RSA/ECB/OAEPPadding` with an explicit `OAEPParameterSpec(SHA-256, MGF1-SHA-256)` | The transformation name alone gives MGF1-SHA-1 on Android, which WebCrypto can't decrypt. A JVM test pins this. |
| RSA keygen | `KeyPairGenerator("RSA")`, 4096 bits, F4 exponent, software key | Same as iOS: the live identity is a software key in process memory. |
| SPKI / PKCS#8 | `KeyFactory`, then two checks: the key must re-encode to exactly the input bytes, and the modulus must be 4096 bits | Strictness equivalent to the Swift DER reader. |
| Argon2id | `Vendor/argon2` reference C, built by CMake as `libconcordargon2.so` with `ARGON2_NO_THREADS`, called over JNI | t=3, m=64 MiB, p=4, 32-byte output. Built for every ABI, including armeabi-v7a (the Galaxy A13 test phone runs only 32-bit apps). |

## Storage

- **Identity behind biometrics (`ConcordIdentityVault`).** A Keystore AES-256-GCM key wraps the PKCS#8 blob, and the blob lives in `noBackupFilesDir`.
  - The key requires authentication on every use: strong biometrics only on API 30+, any enrolled fingerprint on API 26–29.
  - The key is invalidated when a new biometric is enrolled. That surfaces as `NOTFOUND`, and the blob is deleted.
  - The key must be in a TEE or StrongBox; StrongBox is preferred when the phone has it. A software-only Keystore is refused with `NOSECUREHARDWARE`, and the user types their password on every unlock.
  - When `loadIdentity` is called with `allowUI=false`, the read fails with `INTERACTIONNOTALLOWED`. This is the silent-read refusal.
- **Session record (`ConcordSessionVault`).** A Keystore AES-GCM key with no user authentication encrypts the record. It is written through `AtomicFile` to `noBackupFilesDir` and is readable without a prompt, as `AfterFirstUnlockThisDeviceOnly` is on iOS.

## Differences from the review copy

1. **Saving prompts as well.** Keystore gates encryption under an auth-bound AES key too, so `persistIdentity` shows the prompt ("Turn on biometric unlock") right after sign-in. iOS writes without a prompt.
2. **New reject code `E_CONCORD_CRYPTO_NOSECUREHARDWARE` (Android only).** The UI can use it to explain why biometric unlock is off.
3. **The in-app transparency copy and the "Mobile security model" wiki page move to the app-lock follow-up**, which includes the first-launch setup. The app has no Settings › Security screen yet.
4. **Sign-in errors.** `describeError` no longer reports native crypto failures as network failures. It also drops a branch for `E_CONCORD_CRYPTO_WRONGPASSWORD`, a code no native module ever emitted. Biometric copy now names the platform's feature (`biometricName()`).

## Verification

- JVM unit tests (`./gradlew :concord-crypto:testDebugUnitTest`) are a port of `Tests/ConcordCryptoTests.swift`, with a stand-in KDF.
- The runtime probe (`scripts/native-runtime-probe`) runs the full iOS case list on Android. That covers real Argon2id over JNI, identity and channel round trips, and the refusals.
- The biometric cases run on a real phone (the Galaxy): the prompt, the silent-read refusal and re-enrolment.

## Later

- Play Integrity / key attestation.
- App lock plus inactivity auto-lock that releases all keys, with a first-launch setup, on iOS and Android together.
