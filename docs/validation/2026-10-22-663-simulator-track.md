# #663 simulator and emulator track — 2026-10-22

**Scope:** simulator and emulator evidence only. It closes no dedicated-device gate, and it doesn't change [ADR-0047](../adr/0047-mobile-client-framework-and-native-boundaries.md) from Proposed.
**Why:** dedicated Android and iPhone devices are still a while away. The project lead asked on 2026-10-21 for the iOS suites to run on iPhone simulators now and for the best way to simulate Android.
**Inputs:** the frozen evaluated source (Concord-Voice-Alpha `8e32967ed`) and its preserved build artifacts. The source lock and receipts this record cites stay in that private repository. Nothing was rebuilt, no repository code changed, and no new branch was needed.

## Host

Apple M5 Pro, 48 GiB RAM, macOS 27.0.1 and Xcode 27.1 (`27A9275`). The global `xcode-select` was unchanged, and each command set its own `DEVELOPER_DIR`. Runs were headless and serial: Simulator.app stayed closed, and only one simulator or emulator ran at a time.

## iOS: three bounded suites on six simulator runtimes

The test selection is unchanged from the evaluated checkpoint. The Objective-C lifecycle host and the RN UI test runner had no earlier binary hash, so this run's hashes are a new baseline rather than a match (see Artifact identity):
- the React Native UI/XCTest case `testRunNativeMediaProbeReportsPositiveCallbackEvidence`, which asserts "Passed 8/8" and four positive counters;
- the nine selected GoogleTests (`rtc_unittests` 5 and `peerconnection_unittests` 4) through `iossim`, with logs and verbose output off and the two key-printing cases excluded;
- the six focused Objective-C lifecycle cases.

| Runtime (build) | Device type | RN UI case | GoogleTests | ObjC lifecycle |
| --- | --- | --- | --- | --- |
| 17.5 (`21F79`) | iPhone 15 | 1/1 | 9/9 | 6/6 |
| 18.6 (`22G86`) | iPhone 16 | 1/1 | 9/9 | 6/6 |
| 26.0 (`23A343`) | iPhone 17 | 1/1 | 9/9 | 6/6 |
| 26.5 (`23F77`) | iPhone 17 | 1/1 | 9/9 | 6/6 |
| 27.0 (`24A434`) | iPhone 17 | 1/1 | 9/9 | 6/6 |
| 27.1 (`24A94425`) | iPhone Duo | 1/1 | 9/9 | 6/6 |

Every run exited 0 with zero failures or skips. The 27.1 runtime offers only the "iPhone Duo" device type.

**Cleanup.** The iOS 26.0 runtime was deleted afterwards to free space. Five probe simulators, with their app data, were kept for repeat runs, with the project lead's approval on 2026-10-22. They hold synthetic keys only. Result bundles outside the receipts folder were not inventoried.

**Runtime availability.** Requests for specific versions through `xcodebuild -downloadPlatform iOS` on Xcode 27.1 refused 15.0, 15.5, 16.0, 16.4, 17.0, 17.4, 17.5, 18.0 and 18.6 (exit 70, "not available for download"). It offered 26.0, 26.2, 26.3.1 and 26.4.1. Apple's runtime index caps 15.x and 16.x at Xcode and macOS 26.99, so no iOS 15 or 16 simulator can run on this macOS 27 host. The project lead installed 17.5, 18.6 and 27.1 through Xcode's Components settings, which offered them although the command line refused 17.5 and 18.6. The other runtimes were already on the host or came from the command-line list. 26.3.1, used for the earlier evidence, wasn't rerun. Xcode 27's XCTest needs iOS 17 or newer, and 17.5 was the lowest such runtime available, so it is the lowest tested.

**Artifact identity.**
- The owner-repaired `LiveKitWebRTC.xcframework` matched its recorded per-file manifest: 242 files, 423,894,992 bytes, zero mismatches.
- Both slice binaries, the RN app binary and its embedded SDK, and the unmodified `rtc_unittests` and `peerconnection_unittests` host apps all matched their source-lock or baseline receipts.
- The recorded whole-tree hash (`85ca80e3…`) can't be reproduced from the recorded manifest itself, which gives `457906ef…` under the documented method. The root cause of that mismatch isn't established. The per-file manifest and the slice hashes do match, so the binaries didn't drift.
- The Objective-C lifecycle host and the RN UI test runner had no recorded binary hash before this run. Fresh hashes are now in the receipts.

**Harness adaptations (test selection unchanged).**
- The saved `.xctestrun` inserted a Main Thread Checker library that exists only in the iOS 27.0 runtime. That is why the first 26.5 attempt crashed with "Library missing". Runs now use a task-local copy without that insert.
- The `iossim` copy in `ios-unmodified-baseline-test-apps/` aborts (exit -6). Runs used `out/probe/ios-baseline-xctest17/iossim`, the copy the source lock's recorded command uses.

## Android: first native execution, on the macOS arm64 emulator

The earlier route, an x86_64 Linux emulator inside Docker under Rosetta, never booted (no `signalfd`, no KVM). The working route is the stable macOS arm64 Android Emulator, which runs arm64 guests directly on Hypervisor.framework. It runs the unchanged ARM64 `rtc_unittests` APK as built.

**Tooling.** Every download is task-scoped, and each download matched the size and SHA-1 in Google's repository manifest. That SHA-1 is the only upstream integrity anchor. The SHA-256 values in the receipts were computed after download.
- Emulator 37.2.12, darwin-aarch64.
- Platform-tools 37.0.1, the archive acquired on 2026-10-14, re-verified.
- Images: API 26 `default` arm64-v8a r02, API 37 `google_apis` arm64-v8a r08, and API 37 `google_apis_ps16k` arm64-v8a r08.
- `adb` and the emulator pass `codesign --verify --strict`. This record doesn't name the signing team.
- The APK (`d3f9b0dd…`) matches the source lock. The preserved output parser passed its 13 host tests after restore from the verified host archive.

**Method.**
- Each AVD booted fresh: `-no-window -gpu swiftshader_indirect -no-snapshot -no-audio -wipe-data`, 3 GiB RAM, two cores and an explicit serial.
- The APK was installed with `install -t` only. No `-g` blanket permission grant was used, and there was no low-target bypass.
- The native test Activity ran twice, each time writing to an app-private stdout file. The first run was real discovery: `--gtest_list_tests` over the 14-case filter, with no `--extract-test-list-from-filter` or `--fast-local-dev`. The second ran exactly those 14 cases with `--logs=false --verbose=false`.
- Only the stdout file was pulled and parsed. The APK was then uninstalled, the emulator killed and the AVD deleted.
- The stock Python runner wasn't used, and no logcat was captured or read. Stock SDK INFO logging still reaches the emulator's own log buffer, which is destroyed with the AVD. So the handover's log-suppression precondition was met only by deleting the AVD, and a device run needs its own log handling.

| AVD | Android / API | ABI | Page size | Discovered | Run / passed / failed / skipped | gtest time |
| --- | --- | --- | --- | --- | --- | --- |
| `default` r02 | 8.0.0 / 26 | arm64-v8a | 4 KiB | 14 (matches candidate) | 14 / 14 / 0 / 0 | 885 ms |
| `google_apis` r08 | 17 / 37 | arm64-v8a | 4 KiB | 14 (matches candidate) | 14 / 14 / 0 / 0 | 1,032 ms |
| `google_apis_ps16k` r08 | 17 / 37 | arm64-v8a | 16 KiB | 14 (matches candidate) | 14 / 14 / 0 / 0 | 1,007 ms |

The run reported 8,312 tests in the full APK; this record doesn't keep the listing behind that count. Only the source-audited 14 ran, so this is not a full SDK regression result.

**16 KiB pages.** The native library loaded and passed on the 16 KiB image despite its 8 KiB RELRO-end remainder. A follow-up run on a freshly created 16 KiB AVD checked compatibility mode:
- `getconf PAGE_SIZE` and `ro.product.cpu.pagesize.max` both read 16384.
- After install, the package showed `pageSizeCompat=0`, the undefined value, so no compatibility flag was set. Whether the system applied a compatibility mode by default wasn't separately checked.
- All 14 cases passed again.

This shows the remainder doesn't stop loading or these cases on a true 16 KiB kernel image. It doesn't show that the RELRO region is fully protected, and it settles nothing for real devices.

**Harness bugs found and fixed (none touched the SDK, APK or parser).**
- `adb shell` re-joins its arguments, so the gtest flag list must be quoted for the device shell. Without that, the stdout-file extra was lost.
- A reused app process carried flags that the absl flag parser rejected, and `am start -W` then hung. Running `am force-stop` before each launch fixed it.

## What this establishes and what it doesn't

**Established (simulator and emulator only):**
- The matching prefixed iOS SDK, wrapper and RN media path, the nine baseline GoogleTests and the six ownership lifecycle cases pass on six iOS runtimes from 17.5 to 27.1.
- The unchanged Android SDK's bounded native cases pass at the API 26 floor, at API 37, and under 16 KiB pages.

**Not established:**
- Anything on physical devices: signing, provisioning, install policy and real hardware media.
- iOS 15 or 16 at runtime. Under the 2026-10-22 policy these are best-effort and untested.
- Any Concord-patched Android SDK, JNI, wrapper or RN runtime, which is still unbuilt.
- Cross-client E2EE, lifecycle, push, secure storage or distribution.
- Aggregate changed-code coverage, and the independent security review.

**Platform policy recorded 2026-10-22 (project lead):** iOS 15 and 16 get best-effort compatibility, with no support commitment and no testing, because the project has no access to those builds. The current SDK and app deployment target stays iOS 16.0, so iOS 15 can't install the current build. The Android API 26 floor is unchanged.
