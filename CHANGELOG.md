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
The app is pre-alpha at 0.1.0. Until it is ready for a functional beta, each
release raises only the patch number (0.1.1, 0.1.2, and so on). The functional
beta is 0.2.0.
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

Android now encrypts messages natively, so Android matches iOS: it signs you
in, keeps your session behind your fingerprint, and reads and sends end-to-end
encrypted direct messages.

### Added

- **Messages:** Android now encrypts natively, the same way iOS does. Private keys stay in Android Keystore behind your fingerprint, and phones without secure hardware ask for your password instead.
- **Messages:** Photos and animated images in direct messages now show inline, decrypted on your phone. Other files download only when you ask. On iPhone a tap opens them in a preview inside the app. On Android a hold shares or saves them, because there is no preview yet. Animated images follow your GIF setting, and wait for a tap while your phone asks for reduced motion. A photo with too many pixels to draw shows as a file card instead.
- **Messages:** Text and Markdown files up to 1 MiB load once on screen into a short preview under the file, which you can expand with a tap. Markdown shows as written.
- **Messages:** Videos in direct messages play inline. Videos up to 64 MiB load once on screen and wait for you to press play. Larger ones, up to 256 MiB, wait for a tap to play. A video that fails to download says why and tries again on a tap, and one your phone can't play says so and names its format.
- **Messages:** Hold any attachment up to 256 MiB for half a second to share or save it. For a video, hold its name above the player. On iPhone this opens the share sheet. On Android it offers "Share…" and "Save to phone…". A tap never opens the share sheet.

### Fixed

- **Sign-in:** An encryption problem on the device no longer shows up as "Could not reach the server", and the unlock button names your phone's biometric feature.
- **Messages:** Android no longer says "This version of the app is no longer supported". The app now tells the server it is the Android app and which version it is.
- **Sign-in:** When fingerprint unlock can't be turned on, for example because no fingerprint is set up, the app now says why instead of silently signing you out next launch.
- **Layout:** On Android, the tabs and the message box no longer sit under the navigation bar. Screens now pad for the phone's real status and navigation bars.
- **Messages:** GIF messages and messages with attachments no longer show as empty bubbles. GIFs play through Concord's GIF proxy once their message is on screen. As on desktop, they wait for a tap when "Load GIFs automatically" is off in your privacy settings. Each attachment is named with its size, such as "Photo, 2.0 KB".
- **Messages:** On iPhone, saving a photo or video to Photos from the share sheet no longer closes the app.

## [0.1.0] - 2026-11-05

The first iOS build signs you in, keeps your session behind Face ID, and reads
and sends end-to-end encrypted direct messages. Android builds run, but
encryption on Android is not built yet.

**6 Total Changes** | 6 Added

### Added

- **Sign-in:** Sign in with your email and password, and confirm with an MFA code when your account requires one.
- **Sign-in:** The app keeps your session across launches and unlocks it with Face ID.
- **Messages:** Read and send end-to-end encrypted direct messages. On iOS, encryption runs natively and private keys stay in the Keychain.
- **Security:** The iOS app proves to the server that it is genuine with Apple App Attest.
- **Messages:** Conversations follow the server's WebSocket event budgets.
- **Updates:** The app sends its version and platform, so a server can require a minimum app version.
