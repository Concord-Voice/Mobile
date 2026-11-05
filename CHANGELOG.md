# Changelog

All notable changes to the Concord Voice mobile app for iOS and Android are
recorded in this file. The root `package.json` holds the app version, and
`scripts/sync-native-version.mjs` copies it into the Android `versionName` and
the iOS `MARKETING_VERSION`. The server and the desktop app have their own
versions and changelogs in the
[Self-Hosted](https://github.com/Concord-Voice/Self-Hosted) and
[Desktop](https://github.com/Concord-Voice/Desktop) repositories.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file names the pending section `[Prerelease]`, not `[Unreleased]`, after
the release channel that ships it first.

To add an entry, write one line under the matching `###` category in
`[Prerelease]`: Added, Changed, Deprecated, Removed, Fixed, or Security. Start
the line with a bold area tag, such as `**Voice:**`. Mark a breaking change with
`**BREAKING**` after the tag. The category sets the recommended version bump:
Added, Deprecated and Removed suggest a minor, and the rest suggest a patch. A
**BREAKING** entry suggests a major (a minor before 1.0). Keep one summary of 1-3
sentences above the categories. Release notes lead with that summary.
Do not add a paragraph for each change. Edit the summary only when your change
belongs in it, and write it if the section has none. Do not edit the
`**N Total Changes**` line. The promoter recounts it when it cuts a release.

## [Prerelease]

The first iOS build signs you in, keeps your session behind Face ID, and reads
and sends end-to-end encrypted direct messages. Android builds run, but
encryption on Android is not built yet.

### Added

- **Sign-in:** Sign in with your email and password, and confirm with an MFA code when your account requires one.
- **Sign-in:** The app keeps your session across launches and unlocks it with Face ID.
- **Messages:** Read and send end-to-end encrypted direct messages. On iOS, encryption runs natively and private keys stay in the Keychain.
- **Security:** The iOS app proves to the server that it is genuine with Apple App Attest.
- **Messages:** Conversations follow the server's WebSocket event budgets.
- **Updates:** The app sends its version and platform, so a server can require a minimum app version.
