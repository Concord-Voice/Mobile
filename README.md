# Concord Voice Mobile

<a href="https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile"><img align="right" src="https://sonarcloud.io/api/project_badges/quality_gate?project=Concord-Voice_Mobile" alt="Quality gate" /></a>

[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=Concord-Voice_Mobile&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=Concord-Voice_Mobile&metric=coverage)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=Concord-Voice_Mobile&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=Concord-Voice_Mobile&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=Concord-Voice_Mobile&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)

[![AI Code Assurance](https://sonarcloud.io/api/project_badges/ai_code_assurance?project=Concord-Voice_Mobile)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-success?logo=dependabot)](./.github/dependabot.yml)
[![license](https://img.shields.io/badge/license-CVSL%201.0-blue)](./LICENSE)
[![security](https://img.shields.io/badge/security-policy-green)](https://github.com/Concord-Voice/.github/blob/main/SECURITY.md)
[![status](https://img.shields.io/badge/status-pre--alpha-orange)](#not-built-yet)
[![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-blue)](#run)
[![SonarQube Cloud](https://sonarcloud.io/images/project_badges/sonarcloud-dark.svg)](https://sonarcloud.io/summary/new_code?id=Concord-Voice_Mobile)

The Concord Voice mobile app for iOS and Android.

**Website:** [www.concordvoice.com](https://www.concordvoice.com) | **Wiki:** [Mobile wiki](https://github.com/Concord-Voice/Mobile/wiki) | **Security:** security@concordvoice.com

---

## Introduction

Concord Voice is a privacy-first place to talk with your friends, your community, or your team. It gives you voice calls, video, screen sharing, and chat. Your device encrypts each message before it leaves, so our servers hold only scrambled data that we cannot read. You can use our hosted service, or you can run the same software on your own hardware.

This repository holds the mobile app. It is in early development, so it is not in the App Store or Google Play yet.
iOS comes first, and Android follows.

The app keeps the same promise as the desktop app: your phone encrypts your messages, and the server never sees them in plain text.
The encryption code runs natively on the phone, and the keys never leave the device's secure storage.

For guides and background, see the [Mobile wiki](https://github.com/Concord-Voice/Mobile/wiki).

---

## Technical overview

The React Native client for iOS (#206) and Android (#205). The app lives at the root of this repository.

### Layout

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
  conversation reconnects. A server overload close (1013) pauses manual reopening
  across conversations for the server's validated 100–30000 ms delay (1000 ms if its
  reason is invalid). The pause survives token refresh within that sign-in; expiry
  never opens a socket automatically. Valid budget advisories fail pending operations
  with a local busy message; malformed advisories are ignored, and operations are
  never replayed automatically. Not yet: older pages, starting a new DM, starting a key
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

### Run

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

The iOS deployment target is 16.0. iOS 16 is best-effort and untested. Historical
framework probes covered iOS 17.5 and later simulators; each dependency candidate
has runtime evidence only for the exact OS recorded in its own artifact. Android
minSdk is 26; the automated runtime guest is API 36, and other API levels are not
covered by that run.

Release builds are unsigned on purpose until a release key exists. Only Argon2id
accounts can unlock; a legacy key-derivation account is refused with a distinct error.

### Native validation

Use Node 22.13 or later in the 22.x line, Node 24.3 or later in the 24.x
line, or Node 26 or later, as required by React Native 0.88.

After a React Native upgrade, run `bundle exec pod install` on macOS and commit
the generated `ios/Podfile.lock` before merging. Validate iOS and Android builds
and the native crypto tests with the resolved native dependencies; the JavaScript
tests mock the native bridge.

The `Mobile native validation` workflow runs on pull requests that change the app,
its native projects or dependencies, its own workflow, the IOC gate workflow or
`scripts/security/**`, and on manual dispatches. It is advisory, not merge-required. After the IOC scan, its hosted macOS job resolves a fresh candidate
lock with `bundle exec pod install` and uploads `mobile-pod-lock-<run>-<attempt>`.
The artifact contains `Podfile.lock`, a native-project patch and source/digest
provenance for review. Download it from that run, review the changes and commit
the generated lock and any required project changes to the PR.

The job then restores the committed lock, requires `pod install --deployment`
without tracked toolchain/project changes, and builds the iOS simulator app in
Release configuration. An outdated committed lock still fails this gate even
when the candidate artifact uploaded successfully. The hosted Android job builds
the existing unsigned Release target for arm64.

After those normal builds, the workflow runs a separate test-only `ENTRY_FILE`
variant (`scripts/native-runtime-probe/index.tsx`) on fresh owned devices. It
requires a positive native layout event, native RN/React versions, a Release
Hermes runtime whose OSS release version equals the selected native Pod/Maven
engine version, matching HBC header version, and one fresh nonce- and
app-PID-bound result. The compiler's self-reported release (the Linux `hermesc`
prints 1.0.0), compiler-package metadata and actual bundled native-library digest
are recorded separately.
An armed probe, silence or a successful build does not pass the runtime gate.

On the exact installed iOS runtime recorded in the report, it calls the production
`src/ConcordCrypto.ts` adapter: create/unlock identity, wrap/unwrap a channel key,
encrypt/decrypt, and refuse authenticated tampering, wrong password, wrong key
kind and a released handle. All native handles are released. The existing
`ConcordCrypto-Unit-Tests` CocoaPods scheme must also report all 14 self-contained
tests passed and the two reciprocal-vector tests explicitly skipped; no desktop
vector evidence is claimed without those fixtures. This does not test Keychain
persistence, biometrics, physical devices or the placeholder UI's user flows.

Android uses a checked API 36 Google APIs x86_64 revision 7 image. Compile SDK 37
and target SDK 36 stay unchanged; the guest is not Android 37 runtime evidence.
Hardware mode requires read/write access to `/dev/kvm`. The hosted runner exposes
the device without granting the runner user access, so the workflow adds a udev
rule on that disposable runner before the probe. The probe itself never changes
host permissions. Software emulation is a bounded fallback when KVM is absent:
the installed emulator must identify as version 37.2.13.0/build 16740729, match its
package properties and positively advertise `off` in that exact binary's
`-help-accel`. The runner records the actual package/help/executable hashes and
bounded numeric identity before refusing an unsupported or ambiguous tool. It
chooses explicit `-accel off`, reporting software mode separately. Advertised
support is not proof that this API 36 image boots or performs adequately; the unchanged boot/runtime bounds and
positive runtime cases still decide, with no restart or timeout relaxation.
The APK install alone is retried, at most twice and only after an adb transport
drop or a package manager exception on the fresh guest. The emulator is never
restarted, and any `INSTALL_*` refusal fails at once.
The disposable guest gets 4 GB of RAM and has install-time package verification
turned off; nothing else about the guest is changed.
The Android crypto module is still absent: the real adapter must refuse it with
`Concord native crypto is unavailable`. No Android crypto success is claimed.
A copy of the runtime APK is signed with an isolated disposable test key, which
supplies no production signing or trusted-install evidence.

The host runners bound device boot to 5 minutes, runtime observation to 3 minutes,
native XCTest to 10 minutes and each runtime build to 20 minutes. Only the
isolated XCTest action enables module testability for its Release product copy;
ordinary Release application builds keep their existing settings. They stop/delete
only the simulator/emulator, AVD and test key they created. Uploaded artifacts are
limited to version/digest/source metadata, fixed case booleans, sanitized test IDs
and cleanup receipts; raw runtime/XCTest logs and native values are not uploaded.
An XCTest failure retains only a fixed diagnostic category, known test IDs and,
for compiler errors, up to eight owned Swift source locations with numeric line
and column and a fixed reason code. External filenames, raw compiler messages
and full paths are excluded. Failed emulator metadata commands retain only the
fixed command stage and reason, plus an exact known SDK launcher library name or
`UNKNOWN` for loader failures, with runtime still `NOT RUN`. This diagnostic does
not install a library or establish a remedy. The same sanitized
diagnostics and cleanup metadata are printed to the job log for review.
The iOS consumer starts a bounded live INFO log stream before launch and filters
the result by app PID and nonce; it does not rely on historical log persistence.
The probe pins the versions it proves: React Native and the Hermes engine in
`scripts/native-runtime-probe/run.mjs`, and the emulator build in `devices.mjs`.
A PR that bumps React Native must update those pins in the same change, or the
probe refuses with `installed-version-mismatch` or
`native-engine-selection-mismatch` before producing any evidence.
The default application never imports the probe. Reproduce its runner contracts
with `node --test scripts/native-runtime-probe/*.test.mjs`; use the workflow on
hosted macOS/Linux for the actual native executions.

### Local checks

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

### Not built yet

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

---

## Security

Report a vulnerability by email to security@concordvoice.com. Do not open a public issue for it. The [security policy](https://github.com/Concord-Voice/.github/blob/main/SECURITY.md) describes the disclosure process.

---

## Contributing

We welcome help. Read the [contributing guide](https://github.com/Concord-Voice/.github/blob/main/CONTRIBUTING.md) and the [code of conduct](https://github.com/Concord-Voice/.github/blob/main/CODE_OF_CONDUCT.md) before you open a pull request. Report bugs and request features in our [feedback repository](https://github.com/Concord-Voice/Concord-Voice/issues).

---

## License

This repository uses the Concord Voice Source License 1.0 (CVSL 1.0). Anyone can read the source. Personal and non-profit use is free. Commercial self-hosted use by a for-profit or government entity needs a commercial license. On 2030-02-15 the license converts to AGPL-3.0-or-later.

See [LICENSE](./LICENSE) for the full terms.

---

## Contact

- **Website:** [www.concordvoice.com](https://www.concordvoice.com)
- **Security:** security@concordvoice.com
- **Privacy:** privacy@concordvoice.com
- **General:** contact-us@concordvoice.com
