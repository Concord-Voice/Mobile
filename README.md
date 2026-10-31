# Concord Voice mobile

The React Native client for iOS (#206) and Android (#205). The app lives at the root of this repository.

## Layout

- `App.tsx`: the app shell: sign-in, MFA, and Home (Messages and You tabs; Servers and
  Alerts are placeholders). Screens follow the internal design prototype's dark scheme.
- `native/ConcordCrypto/`: the native message-crypto pod, which uses CryptoKit
  AES-256-GCM, Security.framework RSA-OAEP-4096, vendored reference Argon2id, and a
  biometry-bound Keychain. Keys stay native, and JS holds only opaque handles. JS can
  still ask for a channel key to be wrapped to any public key it passes, so the JS
  bundle is inside the trust boundary.
- `src/ConcordCrypto.ts`: the typed JS bridge to that module.
- `native/ConcordCrypto/Sources/ConcordAttest*.swift` and `src/ConcordAttest.ts`:
  Apple App Attest for the control plane's client attestation (Alpha ADR-0010 D17).
  The key stays in the Secure Enclave; its id is kept in a device-only Keychain item.
  `ConcordApi` attests only when the server refuses a request with
  `ATTESTATION_MISSING`, `EXPIRED` or `INVALID`: it asserts with the stored key, makes
  and attests a new key when the server or Apple no longer knows it, and retries once.
  The app carries the `appattest-environment` entitlement (`development` for Xcode
  installs; TestFlight and App Store builds always use production). App Attest does
  not work on the simulator, and Android has no attestation yet.
- `src/core/`: the control-plane REST client (sign-in with code-based MFA, token
  refresh with one shared rotation and a single retry on 401, logout), the DM WebSocket,
  and `createSocket`, which opens every socket with the app's fixed origin
  `app://concord-mobile`. Servers must list that origin in `ALLOWED_ORIGINS`.
  On iOS, every request and the socket URL also carry the app's version (the bundle's marketing
  version as major.minor.patch) and platform (`X-Concord-Client-Version`,
  `X-Concord-Client-Platform`; `client_version`, `client_platform` on the socket), for the
  server's minimum-version check. A refusal (`CLIENT_VERSION_TOO_OLD`) asks the user to
  update. Android sends neither until its native module lands. A failed version lookup
  is retried on the next request.
- DM conversations (`src/state/conversation.ts`, `src/ui/Chat.tsx`): opening a
  conversation loads the newest page, fetches and unwraps each key epoch it uses once
  (`GET /e2ee/keys/:id?version=N`), decrypts natively, then follows new messages over
  the DM socket. Sending encrypts under the current epoch and moves to a newer one once
  a peer's message under it decrypts. The server is authoritative on epochs: a key
  served for another epoch than asked is refused, a refused epoch is not fetched again
  for 30 seconds, and a live label more than one past any epoch seen is not fetched at
  all. Unlabelled rows open with the current key, and rows labelled 1 fall back to it,
  as on desktop. A message that will not decrypt, or whose key cannot be loaded, is
  shown as such, never dropped, and sends no read receipt. Live messages that arrive
  while history loads merge into it in order. A dropped socket is shown; reopening the
  conversation reconnects. Not yet: older pages, starting a new DM, starting a key
  rotation, edits, reactions, attachments and automatic reconnect.
- Persisted sessions (`src/state/session.ts`): after sign-in, the unlocked identity key
  is stored behind Face ID / Touch ID, and the session record (server, machine id,
  refresh token, session id, user id) in a device-only Keychain item readable after
  first unlock. The record is rewritten in place, best effort, on every token rotation. On
  launch, Face ID reopens the key and the refresh token rotates back into the same
  server session. Any unlock failure other than a missing key keeps everything for an
  "Unlock with Face ID" retry; a lockout or Keychain fault (unlike a cancel) also says
  so, and the password still signs in. A changed Face ID set, a refused
  refresh or a sign-out ends the session (server revocation is best effort) and deletes
  both items; a changed Face ID set that cannot reach the server keeps the record so
  the next launch retries the revocation, and a sign-out whose delete fails is retried
  once and then reported. Devices with no biometrics enrolled save nothing and sign in
  on every launch. The machine id is a native random UUID.

The crypto and core code come from the #663 framework probe.

## Run

```sh
npm ci
npm test && npm run typecheck && npm run lint
npm start                                           # Metro
cd ios && bundle install && bundle exec pod install && cd ..
npm run ios                                         # or: npm run android
```

`bundle install` needs Ruby 3.2 or newer, so install one with Homebrew or rbenv first; macOS's system Ruby 2.6 is too old.

The repository refuses keystore files, so Android debug builds need a local one:

```sh
keytool -genkeypair -keystore android/app/debug.keystore -storepass android \
  -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 \
  -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```

The iOS deployment target is 16.0. iOS 16 is best-effort and untested. The tested
range is iOS 17.5 and later on simulators. Android minSdk is 26.

Release builds are unsigned on purpose until a release key exists. Only Argon2id
accounts can unlock; a legacy key-derivation account is refused with a distinct error.

## Local checks

[pre-commit](https://pre-commit.com/) runs the secret scanners (detect-secrets,
gitleaks, TruffleHog), actionlint, Semgrep and the supply-chain guards before
each commit:

```sh
pipx install pre-commit
pre-commit install --hook-type pre-commit --hook-type commit-msg
```

Two hooks need tools that pre-commit does not install:

- **Semgrep** runs under `python3.9`, because its dependencies do not work on
  newer Pythons. On macOS, Command Line Tools ships it at
  `/Library/Developer/CommandLineTools/`.
- **TruffleHog** calls a local `trufflehog` binary (`brew install trufflehog`).

Dependabot proposes weekly updates for npm, Bundler (CocoaPods), Gradle, GitHub
Actions and the CI tool manifests. Exact pins are documented in
`.github/dependency-pin-exceptions.json`.

## Not built yet

- Servers, channels, alerts, voice and the rest of the prototype's screens.
- WebAuthn (passkey) MFA.
- An Android native crypto module.
- Native build and store-release CI.

Scanner workflows are ported from Alpha. The IOC-gated app checks run `npm ci`,
`npm test`, `npm run lint` and `npm run typecheck` on pull requests. This new CI
job was accepted on 2026-10-24; Alpha had no Mobile app-level CI.

IOC-gated CodeQL and Scorecard scans also run on pushes to `main` and daily.

Protected scanner runs read Semgrep rules and exclusions from the immutable
workflow revision, while scanning PR source. PR ignore files and inline Semgrep
suppressions cannot narrow that coverage. Protected OSV scans also include
Git-ignored lockfiles. Scanner-policy changes must land on `main` before the
required workflow is repinned to their merge commit.

SonarCloud (project `Concord-Voice_Mobile`) analyses `src/` with Jest coverage.
On pull requests, the protected required build dispatches `sonarcloud.yml` from
`main` in the `protected-sonar` environment. That run verifies the caller's
OIDC proof (`tools/sonar-caller-proof`) and scans an inert copy of the PR
source. `sonar-main.yml` analyses `main` daily. Fork PRs skip the scan.
