# #663 mobile framework evaluation — reconciled handover

**Evidence cutoff:** 2026-10-15, extended by the 2026-10-22 simulator and emulator track. **Handover finalized:** 2026-10-16 (America/New_York). The source-backup timestamps use UTC.
**Status:** evaluation incomplete; React Native is the leading conditional candidate.
**Issues:** #663 evaluation, #204 mobile epic, #205 Android, #206 iOS.
**Decision record:** [ADR-0047, Proposed](adr/0047-mobile-client-framework-and-native-boundaries.md).
**Update 2026-10-22:** the [simulator and emulator track](validation/2026-10-22-663-simulator-track.md) adds two kinds of evidence. The three bounded iOS suites passed on six simulator runtimes from iOS 17.5 to 27.1. The 14 bounded Android native cases passed on arm64 emulators at API 26, at API 37, and at API 37 with 16 KiB pages, which is the first Android execution. It also records the project lead's iOS 15/16 policy. Simulator and emulator results close no dedicated-device gate.

## Purpose and authority

This record reconciles the framework assessment, approved native probes, failures, repairs, validation and operational recovery in the #663 continuation. It is an evaluation handover, not approval to ship a mobile client. The detailed historical records, experimental source, source lock and receipts were preserved in the private Concord-Voice-Alpha repository at evaluation checkpoint `8e32967ed` and are not published here. The exact SDK, dependency and artifact identities live in that source lock.

Use this record for current status. Earlier plans have unchecked tasks and point-in-time prose, including statements that Android lacked a Linux builder or an APK. Those were true at their checkpoints and are superseded by the AAR and native-test APK results below. Source-lock notes describing earlier iOS work are historical when they conflict with the later Android build record. Never turn a historical failure into a current pass, or a later build into earlier runtime evidence.

> **Imported from Concord-Voice-Alpha.** This handover was written there and is published here with operational recovery detail removed. The experimental probe implementation stayed on a private branch; this document does not merge or approve it.

## Decisions already made

| Decision | Binding scope |
| --- | --- |
| Launch together | Android and iOS launch with the same core mobile capabilities; one platform's simulator success does not authorize a split launch. |
| Core experience | E2EE messaging, voice/video and background calls are core. Use the mobile prototype with platform adjustments and practical mobile parity. Its existing mock services/media/crypto are not implementation evidence. |
| Platform floors | Android API 26 remains a product requirement. iOS changed on 2026-10-22: the project lead decided that iOS 15 and 16 get best-effort compatibility with no support commitment and no testing, because those builds aren't accessible. The SDK/app deployment target stays 16.0, so iOS 15 can't install the current build. Simulator-tested iOS starts at 17.5. A compiler flag, minimum-OS plist or newer simulator run does not prove a floor at runtime. |
| Push | Include UnifiedPush alongside FCM on Android, and APNs/PushKit on iOS. A selected UnifiedPush provider must not silently fall back to Google. Native incoming-call handling remains required. |
| Other capabilities | Receiving screen shares is core. Phone broadcasting may be deferred on both platforms if costly. Preserve voicemail playback, widgets/Live Activities and PiP. |
| Shared framework direction | Continue evaluating React Native/TypeScript with explicit native boundaries. ADR-0047 remains Proposed; there is no final framework adoption. |
| Crypto boundary | The approved evaluation-only WebRTC SDK/BoringSSL boundary covers the bounded media probe. Later crypto, protected-storage and push packages retain separate approval and security/E2EE gates. |
| Media boundary | Live encoded frames and keys stay native. Use synthetic keys only. Never log or commit key-bearing fixtures, content, SDP, addresses, accounts or raw media statistics. |
| Protocol | Preserve desktop v5: Opus clear prefix 1 byte, VP8 clear prefix 2 bytes, no AAD, 22-byte trailer, 16-byte tag and AES-256-GCM. Read implementation rather than obsolete VP8 comments. Clear-header mutation is not guaranteed authentication failure under this existing no-AAD format. |
| Devices | Dedicated Android and iPhone devices are being obtained. Personal devices are excluded from development tests. |
| Reviews | Three full review cycles have been consumed in the existing Codex/E2EE track. Address new P0/P1 defects only; do not start another broad fanout. The named independent security review did not run because of access failure and is not waived. |
| Tooling | All SonarQube MCP use is prohibited: never initialize, invoke, recreate, install, restart or restore it through Plugins, Docker or another route, and never ask to re-enable it. Existing cached images are not permission to use them. Remote repository CI checks and quality gates remain required. |

## Current results by operating system

| Area | iOS / Mac evidence | Android evidence | Remaining gate |
| --- | --- | --- | --- |
| SDK source | Complete pinned checkout/DEPS and bounded unmodified iOS build/test evidence. | Separate Linux checkout/DEPS, source/archive/package-identity audit, installed-package integrity/copy checks and explicit hooks passed. | Revalidate a restored builder before using it; keep Mac and Linux checkout provenance separate. |
| Unmodified SDK | Generic device/simulator ARM64 XCFramework built with minimum iOS 16; nine selected native tests passed on the newer test host, and again on six simulator runtimes on 2026-10-22. | ARM64 and x86_64 AAR built; both ELF/ABI and Java-class parity checks passed. | Neither result is a full upstream regression suite or minimum-OS runtime pass. |
| Native v5 kernel | Five codec cases and reciprocal desktop/native fixture validation passed. | No Concord-patched native SDK is built or executed. | Unchanged native Android execution passed on emulators on 2026-10-22. Repeat it on a dedicated device before applying the Concord patch. |
| Creation/callback safety | Focused creation-time fail-closed, generation/fencing, callback and ownership tests passed. The six lifecycle cases passed again on six simulator runtimes on 2026-10-22. | Maintained patch contains Android source scaffolding, not a working Android binding or runtime result. | Android JNI/public boundary, creation and teardown evidence. |
| Native counts | 46 C++ cases: 41 boundary plus 5 codec. Six unique Objective-C cases produced 27 executions. These overlap platform reruns. | Stock native C++ ARM64 test APK built and statically verified. On 2026-10-22, real discovery matched all fourteen candidate cases, and all fourteen passed on arm64 emulators at API 26, API 37, and API 37 with 16 KiB pages. | Repeat the same selection on an identified dedicated device. |
| React Native media | Matching prefixed SDK/wrapper/app passed one unique UI/XCTest case on iOS 27 and 26.3.1; two successful stdout executions per runtime. Native report 8/8: six self-checks, Opus and VP8. On 2026-10-22, the same case, the nine GoogleTests and the six lifecycle cases passed on 17.5, 18.6, 26.0, 26.5, 27.0 and 27.1 simulators. | No matching prefixed Android SDK/wrapper/RN artifact or execution. | Prefix reconciliation, Android native integration and actual runtime. |
| OS floors/devices | Unsigned ARM64 device app built with minimum iOS 16 and SDK 27; not installed/run. No dedicated-device result. iOS 15/16 are best-effort and untested by decision; Xcode 27.1 on macOS 27 can't install those simulator runtimes, and its XCTest needs iOS 17 or newer. | Native build API 26 verified. Stock AAR manifest is min 21 / target 23; test APK is min 23 / target 24. The bounded native cases ran on an API 26 emulator; no API 26 device or app execution. | Real Android floor and current-OS device runs, and iOS current-OS device runs, with verified signing/provisioning/install policy. |
| End-to-end product | Bounded in-process/same-app simulator media only. | Build/static checks, plus the fourteen bounded native cases on emulators. | Desktop/mobile cross-client operation, accounts, key custody, background/locked/killed calls, network changes, audio routes, push and distribution. |
| Coverage | SDK changed executable lines 1,035/1,215 (85.19%); wrapper 449/540 (83.15%); selected JS 33/35 (about 94.3%). | 233 added Android lines remain unmeasured. Host output-parser coverage is a separate utility result. | Seven SDK headers and two wrapper headers unmapped; aggregate changed-code coverage remains open. Do not average unlike scopes. |

### Test accounting

- Initial desktop exporter/reference suites passed 79 tests. The later codec/verifier checkpoint passed 83, including four verifier cases; these are overlapping suite snapshots, not 162 tests.
- There are 23 synthetic Opus/VP8 reciprocal fixture cases, including nine native positive re-encryptions. Fixtures were mode 0600, verified and deleted. They are not retained in the handover archive.
- The 46 C++ cases include the five codec cases. The earlier 41-case count and later platform reruns must not be added again.
- Six Objective-C cases are unique; 27 executions are repeat/platform executions. That is the 2026-10-15 count. The 2026-10-22 simulator and emulator runs repeat the same unique cases (6 Objective-C, 9 GoogleTests, 1 RN UI and 14 Android native) and must not be added to it. The six native vector self-checks inside the RN report are not extra named XCTest cases.
- Final focused JS checks passed 22 tests across two suites, typecheck and lint. Lint retained one existing inline-style warning. Selected branch coverage was 39/40 (97.5%).
- The RN case is one unique test, repeated successfully. Four UI counters were positive, but exact values were not exported. Do not reconstruct counts or claim microphone-purity proof.
- The host-side Android output parser has 13 tests. Its TDD record includes 27 failing assertions against the RED stub, followed by GREEN. Its 57/58 line coverage (98.276%, branches unmeasured) is not Android SDK, JNI or aggregate coverage.
- These are recorded historical results. Preservation integrity checks and restored host-helper tests were run separately; this handover does not rerun the SDK suites.

## Review coverage and residual reporting limits

Existing review records are preserved, not rerun. Cycle 2 covered the C++ codec/transformer, creation/admission and final queue-fence slice; it explicitly excluded the unfinished matching-key helper, Objective-C/Java/JNI, RN, Android and devices. Cycle 3 covered the later C++ helper/Objective-C control slice and reported no supported finding at that checkpoint. Neither is a blanket review of later Task 4 wrapper/lifetime work or Android implementation. The separate named security reviewer never started because access returned an entitlement failure; zero execution is not a clean security verdict.

The probe's sender identity is trusted control-plane/SSRC input, not a newly authenticated wire field or AAD. Current-generation counters can reset and are not cumulative reconnect evidence. These are reporting/threat-model boundaries to validate before adoption, not newly accepted production residuals. Keep the three-full-cycle cap and carry the outstanding independent gates forward.

## Native integration and maintenance cost

The SDK is release 144.7559.15 at commit prefix `30d5e63ae91d`; the wrapper is version 144.2.0 at `7b650378b276`. The probe uses RN 0.87.1, React 19.2.3 and mediasoup-client 3.24.1. Full commit identities, DEPS pins, commands, binaries and hashes are in the locked source and preserved receipts. These are evaluated pins, not instructions to update dependencies automatically.

The maintained SDK patch has 66 source files and 272,149 bytes; the wrapper patch has four files and 28,722 bytes. Clean-base apply and source-byte checks were recorded. Generic Android outputs use `org.webrtc` / `libjingle_peerconnection_so.so`; the wrapper requires `livekit.org.webrtc` / `liblkjingle_peerconnection_so.so` and matching JNI prefixes. iOS similarly requires `LiveKitWebRTC` / `LKRTC*` artifacts. Renaming a generic binary is not reconciliation. The Android vendor-prefix context repair is source-only and uncompiled.

| Artifact / build | Recorded result | Meaning |
| --- | --- | --- |
| Generic unmodified iOS XCFramework | 409,356,336 bytes / 240 files, including dSYMs; 387.913 s successful baseline build | Device and simulator ARM64, minimum 16 / SDK 27; generic artifact is not the prefixed wrapper artifact. |
| Initial iOS test-only harness | 2,126.774 s with four local workers; an earlier eighteen-worker attempt was interrupted after 267.757 s | Test-host build cost is separate from the generic SDK build and later incremental probe timings. |
| Owner-repaired prefixed iOS XCFramework | 423,894,992 bytes / 242 files | Public device/simulator consumer links and bounded newer-simulator checks passed. Full stripping caused LINKEDIT problems; the verified linkable build retained unstripped output. |
| Unsigned iOS device probe app | 38,281,842 bytes; build 45.619 s | Built, not signed for installation, installed or executed. |
| Stock two-ABI Android AAR | 29,845,522 bytes; 10,487.278 s | ARM64 and x86_64; 426 Java classes identical across ABIs. Generic stock SDK only. |
| Stock ARM64 native C++ test APK | 23,351,787 bytes; SDK build 4,067.192 s, outer 4,073.746 s | Unchanged SDK/tests/GN arguments for this route; 2,232 transitive dependencies, no Byte Buddy dependency. APK build/static checks at the 2026-10-15 cutoff; the emulator runs are in the next row. |
| APK native library | 22,116,464-byte packaged ARM64 ELF; unstripped debug library also preserved | Not executed at the 2026-10-15 cutoff. The fourteen bounded cases passed on arm64 emulators on 2026-10-22, not on a device. |

A named owner for SDK/wrapper updates, native build environments, regression tests, distribution and dependency/security response is still required. No credible full mobile implementation estimate or code-reuse percentage was established.

## Android findings and bounded alternatives

The unmodified production AAR succeeded on a case-sensitive Docker native volume using Linux amd64 userspace under Rosetta on an ARM64 Linux VM. Build jobs used one CPU, one Siso worker, 4 GiB RAM/no swap, offline networking and task-only capacity monitoring. This proves a cross-build route, not native x86 Linux execution or Android runtime support. The approved Linux workspace has a **32 GiB monitored task budget**, with stops below **16 GiB host free** or **6 GiB VM free**. These are stop guards, not hard quotas. Restoring or expanding a builder does not authorize raising those limits, allocating a paid host or changing shared Docker settings.

The final native-volume sync passed in 809.728 s. A separate 116.908 s cold-source/archive/package-identity audit covered all 67 pinned source checkouts with disposable indexes (real indexes unchanged), all seven GCS archives and 59 CIPD package identities. The canonical installed-package CheckIntegrity/copy-mode pass was separate (1.614 s in-container); it can reuse unchanged stat metadata and is not an independent fresh rehash of every installed package byte. The known compressed source/archive inventory was about 5.21 GiB, excluding checkout, extraction and build storage. Earlier cloud fetch failures and the external-drive route are historical, not a current “Linux build impossible” finding.

The original Java instrumentation target failed on three stale `VideoCodecInfo` constructor calls in two test files. A separate three-call test-only repair retained all assertions and passed focused compilation (159 classes, 16.121 s). The qualified APK then failed at D8 because base and Java-9 multi-release Byte Buddy classes were passed together. An isolated SDK filter on copies of both jars passed the complete DEX action in 118.923 s, preserving all 71 input slots and every non-versioned byte. It did not produce an APK or runtime result. Stock archive-input actions timed out at 240 and 600 seconds without a compiler verdict; further duration retries were stopped. The archive continuation helper is gated on a GREEN result that never occurred and must not be run as if qualified.

The separate `//:rtc_unittests` route avoided Byte Buddy and produced the unchanged-source ARM64 APK. Pinned Build Tools 36 verified its manifest, v2 signature for API 26 and 16 KiB ZIP alignment. It is debuggable, declares twelve permissions plus one implied storage permission, and declares no service. Native Activity completion must be checked from actual test output: the JNI launcher ignores `main`'s return value, and the stock instrumentation path references a service absent from the APK. Neither a shell success nor a build exit proves a test pass.

The APK signature check verifies package integrity against its embedded test certificate; it is not trusted production signing or a functional mobile-app distribution.

The old emulator route failed before boot with both renderer modes because Rosetta lacks Linux `signalfd` (syscall 282), with no KVM route available. It is not worth another duration or renderer retry. The approved continuation is a dedicated Android device. On 2026-10-22, a different route worked: the stable macOS arm64 Android Emulator on Hypervisor.framework booted arm64 images headless and ran the bounded native selection. That is emulator evidence; device execution is still required ([simulator track](validation/2026-10-22-663-simulator-track.md)).

### Fourteen-case Android execution candidate — discovered and passed on emulators 2026-10-22, not yet on a device

The source-audited candidate is below. Real discovery on the emulators matched all fourteen on 2026-10-22. Repeat discovery on the dedicated device before relying on it; do not skip discovery with `--extract-test-list-from-filter` or `--fast-local-dev`. The legacy nine Java instrumentation factory cases are a different target and remain unexecuted.

```text
JavaTypesTest.TestJavaToNativeStringMap
JavaTypesTest.TestNativeToJavaToNativeIntArray
JavaTypesTest.TestNativeToJavaIntArrayAcceptsTemporaryVector
JavaTypesTest.TestNativeToJavaToNativeByteArray
JavaTypesTest.TestNativeToJavaByteArrayAcceptsTemporaryVector
JavaTypesTest.TestNativeToJavaToNativeIntArrayLeakTest
JavaTypesTest.TestNativeToJavaToNativeByteArrayLeakTest
JavaCodecsWrapperTest.JavaToNativeVideoCodecInfo
JavaCodecsWrapperTest.JavaToNativeResolutionBitrateLimits
DataPacketCryptor.BasicTest
DataPacketCryptor.DifferentKeyProvider
DataPacketCryptor.IVGeneration
KeyProvider.KeyDerivationAlgorithm
KeyProvider.GetKeySetReturnsNullptrForOutOfRange
```

Exclude `FrameCryptor.KeyProvider` and `KeyProvider.KeyRingSizeMaxAcceptsIndex255`: their failed assertions can print key material. The selected conversion/codec/packet cases do not request capture, camera, network-monitor or peer-connection tests. Verify native log suppression and the app-private result path before execution. The host parser requires the exact discovered/run/pass set and rejects extra, missing, skipped, failed, duplicate, truncated or malformed output; its report does not set a runtime-verification flag by itself.

### Page-size evidence is intentionally scoped

| Library | LOAD alignment | RELRO end modulo 16 KiB | Result |
| --- | --- | --- | --- |
| Production AAR ARM64 | 16 KiB | 0 | Static ELF checks only. |
| Production AAR x86_64 | 16 KiB | 8 KiB | Compatibility concern; runtime impact unverified. |
| ARM64 native-test library | 16 KiB | 8 KiB | Compatibility concern despite the APK ZIP alignment pass. On the API 37 16 KiB emulator image (2026-10-22) it loaded and passed the fourteen cases with `pageSizeCompat=0` (undefined: no compatibility flag set). This doesn't prove the RELRO region is fully protected, or anything about devices. |

Actual generated flags contain `-Wl,-z,max-page-size=16384` and no common-page-size override. No dedicated common-page-size GN argument was found in the inspected pinned build configuration. The [Android guidance](https://developer.android.com/guide/practices/page-sizes) distinguishes ELF, RELRO, packaging and runtime checks. NDK r28 metadata alone is not proof because this SDK uses its own GN/LLVM configuration. No controlled relink proved a cause or fix. Check the actual test device's page size and install policy before deciding whether to qualify a separate build variant; never overwrite the baseline or enable compatibility/bypass settings silently.

## Gotchas and repairs to carry forward

| Symptom / trap | Verified handling and future instruction |
| --- | --- |
| Handoff bundle has prerequisite history | Import into a separate branch, verify the bundle/head and fetch normal upstream history for prerequisite `7e7634c0284c`. Preserve existing branches/dirty changes. Original transferred head was `9d50927d0589`; final evaluated checkpoint is `8e32967ed`. |
| Initial Mac checker looked green | Its first 17 tests used simulated Mac responses. Actual Xcode/readiness/build/runtime evidence came later; do not reuse the simulated result as host readiness. |
| SDK expects Xcode 26.1; Mac has 27 | Xcode 27 was explicitly approved. Recorded fixes used `use_clang_modules=false`, a C++-only `-fno-cxx-modules` wrapper, Apple `ld` via `use_lld=false`, and a link-only Xcode `libLTO` driver config. Preserve pinned compiler/DEPS and iOS 16 target. Use the maintained files and exact build notes; do not improvise compiler/header upgrades. |
| Xcode 27 XCTest cannot target iOS 16 | The test-only host targets iOS 17; runtime was newer. Product SDK/app minimum stays 16. Build success is not floor evidence. |
| Siso ignores `-j12` / autoninja bootstrap fails | Use the pinned Siso entry point and supported `-local_jobs` setting. An early 18-worker run was interrupted; four-worker iOS and one-worker Linux routes were bounded. Do not infer the cause of a Mac crash from these separate observations. |
| `iossim` launches zero cases | Record launcher/host failures as infrastructure failures. Use the exact verified test UID/filter/runtime flags and count actual cases. Invalid `-test-iterations 1` was rejected by Xcode; do not relabel zero cases as RED or GREEN. |
| Native crypto logs / assertion formatting | Stock key derivation can log raw material at INFO, and two known assertions print keys on failure. Suppress/verify native logging, exclude unsafe tests and retain only names/counts/status/durations. No raw key fixtures or broad device logs. |
| Generic SDK does not link to wrapper | Preserve framework/ObjC/Java/JNI/soname prefixes together. Context-only vendor patch repair retained all changed lines; no binary rename shortcuts. |
| Stripped SDK fails consumer LINKEDIT alignment | Generic baseline reproduced it. The recorded unstripped build linked; compare source hashes and real public consumers instead of equating packaging success with ABI compatibility. |
| Wrapper source-folder prepare fails on declarations | Reviewed local repack used published JS at the pinned head, verified publisher integrity and 99 native files; thirteen publisher Gradle-cache files were omitted. Normal install scripts remained enabled. Reuse the recorded recipe rather than disable lifecycle scripts. |
| RN app crashes at teardown | Symbolized `EXC_BAD_ACCESS` reached a proxy posting to a dead factory thread. Owner retention/lifetime repair produced meaningful RED tests then six focused GREEN lifecycle cases. This was an app crash, not a Mac reboot. Preserve the owner repair and verify teardown. |
| Standard receive callback is too late for creation safety | The evaluated mediasoup receive callback follows remote SDP. Arm the mandatory native receiver gate before peer-connection creation/negotiation, rather than wait for late JavaScript receive/track events. Preserve missing-transform content-drop, replacement/generation and final-forwarding tests; frames/keys stay native. |
| Focused iOS tests are mistaken for a full SDK suite | The recorded full prefixed-suite compile did not pass; the focused lifecycle target excludes unrelated GL tests. Keep exact target/host/filter configuration and nonzero case counts. Six focused lifecycle passes do not establish a whole-suite pass. |
| Same-app peers do not connect | Recorded synthetic loopback control required the explicit loopback option. Do not weaken encryption or general transport admission, or report loopback as cross-client interoperability. |
| Child Git reports dubious ownership | The pinned Gradle child reported owner 0 while parent/path checks saw UID501; the driver cause was unproven. Use only the recorded command-scoped exact task-path trust list (67 normalized SDK/depot/DEPS paths), never wildcard/persistent `safe.directory` or global ownership changes. Refetch and verify the locked Gradle revision normally. |
| Warm Git status is called a fresh source audit | The cold verifier used disposable indexes for all 67 pins and verified real indexes unchanged. Preserve that distinction, especially after storage faults; a warm cached stat check is not a content rehash. |
| Generic CIPD deployment checker flags valid copy installs | It reported nine symlink/copy and five NDK relink differences. Pinned `gclient_scm.py` selects copy mode; canonical `ensure` CheckIntegrity with that mode and the same 59 pins passed offline. Keep package identity, archive hashing and installed-content evidence separate; CheckIntegrity may skip unchanged file rehashes using stat metadata. |
| Android NDK checker rejects pruned package | The SDK uses a separate pinned Clang and a deliberately pruned NDK package. Check the SDK's actual build configuration; absent standalone NDK Clang/`source.properties` did not prove a bad package. Explicit `gclient runhooks` and corrected checker passed. |
| Hook process passed but wrapper reports failure | Distinguish SDK hook exit, capacity-observer failure and post-hook checker failure. Do not repeat successful hooks because an observer timed out. A late query during container exit was not a capacity stop. |
| Manifest-merger INFO becomes fatal stderr | A task-only JDK logger entry targeted `PositionXmlParser` INFO. Five controls preserved WARNING, SEVERE and unrelated INFO failures. Exact action RED/GREEN passed. Original JDK inode/bytes were restored and temporary backup removed. Never disable warnings-as-errors globally. |
| First isolated DEX probe fails while writing a depfile | Its compiler output existed, but the probe used absolute paths. The second attempt used the SDK action's expected relative paths and completed. This was a probe invocation error, not an additional SDK/compiler failure. |
| Java compile or isolated DEX action is called an APK | Keep three-call test compatibility and copied-jar DEX qualification separate from unmodified SDK/native execution. Do not edit dependency jars in place or drop inputs. |
| AAPT/ELF/parser inspection assumptions | Build Tools badging uses `minSdkVersion`; distinguish twelve declared permissions from thirteen badging entries. LLVM program-header type is `Type.Name=PT_LOAD`, not a string in `Type.Value`. Python `trace` catches `SystemExit`; verify CLI rejection outside trace. |
| Stock Android runner grants permissions/retains logs | It installs/clears using the manifest permission list and retains broad logcat/output. Do not run it blindly. A direct native Activity/app-private result path still needs actual device completion, retention and cleanup proof. |
| Public provenance hashes trip secret scanner | The owner approved exact batches (77, 33, six loopback, six Android AAR, six native APK). Those are instance decisions, not blanket permission. Historical baseline/proposal files are audit evidence: never copy them wholesale over a newer baseline or remove newer entries/settings. Reconcile only the still-applicable approved identities with fresh file/line evidence. Keep scanner rules and existing classifications; normal scanner metadata refresh needs equivalence checks and a normal commit retry. No hook bypass or signing change. |
| SonarQube MCP crashes reported by owner | Owner removed MCP access and ordered all use stopped. Never initialize/reinstall/recreate it, launch its cached image or ask for access. Do not bypass remote CI quality gates. |
| Storage cleanup is mistaken for native failure | Stop below the approved capacity guards. Preserve refs/notes/dirty changes. The earlier cleanup removed twelve inactive worktrees and eight old ignored dependency directories; do not present them as still reclaimable. A later four-directory cleanup command was offered; its actual execution was not observed. |
| Switching the documentation branch runs package setup | The normal post-checkout hook synchronized changed dependency locks and installed desktop/media-plane dependencies. Those are worktree setup side effects, not new probe results. Generated `experiments/` data remains untracked on the docs branch and must not be staged or deleted. Check out the frozen feature before reusing its probe paths. |
| Partial output-parser restore fails before tests | The test file reads the parent `validation-current-android-native-baseline-case-candidate.json`. Restore that manifest together with both Python files (or restore the complete host archive). The three-file archive round trip passes all thirteen host tests; no parser/SDK source change was needed. |
| Broad dependency cleanup damages a pinned SDK | Chromium/DEPS source can contain managed `node_modules` trees, including the material-web-components package observed during preservation. They are not automatically disposable app caches. Do not bulk-delete dependency directories from the SDK checkout; revalidate full source/package integrity after any approved cleanup. |
| Private Go caches consume disk | Use the shared default Go build/module/lint caches. Do not set private `GOCACHE`, `GOMODCACHE` or `GOLANGCI_LINT_CACHE`; report sandbox denial rather than duplicate caches. This handover performs no Go tests. |

## Ordered next steps

| Order | Owner / action | Required evidence before advancing |
| --- | --- | --- |
| 1 | Project lead provides identified dedicated devices and provisioning/access | Model, OS, API/ABI/page size, connection, signing/team/profile where applicable, app ownership/install policy and agreed cleanup. No personal-phone development or blanket permissions. |
| 2 | Native owner verifies unchanged Android native tests | Discover the actual fourteen-case candidate, verify safe logging/permissions/output transport, execute unchanged SDK tests and parse complete results. Shell exit alone is insufficient. Record hashes/API/ABI/page size/counts, bounded duration and cleanup. Emulator runs passed on 2026-10-22; reuse that harness (quoted device-shell flags, force-stop before each launch) on the dedicated device. Log hygiene on the emulators relied on deleting the AVD. A device keeps its logcat, so suppress native INFO logging or clear logcat before and after each run, and record that as cleanup evidence. |
| 3 | Native owner resolves device-specific packaging/page-size blockers if observed | Separate a test-harness/build qualification from baseline artifacts. Preserve original outputs and compare a controlled variant; do not silently raise product floors or enable device compatibility/install bypasses. |
| 4 | Native owner implements/tests the Android Concord integration | Apply the frozen portable kernel and creation-time fail-closed/generation/ownership boundaries with TDD; verify synthetic reciprocal desktop/native vectors. Build the complete prefixed SDK and JNI contract, then matching wrapper and RN probe. |
| 5 | iOS owner validates dedicated-device behavior | Matching verified artifacts, real signing/provisioning, current OS, actual media and teardown. The unsigned device app and simulators do not satisfy this. iOS 15/16 runtime is not a gate under the 2026-10-22 policy. |
| 6 | Mobile/security owners validate product boundaries | Desktop/Android/iOS cross-client E2EE, accounts/epochs/logout/recovery, secure storage, background/locked/killed incoming calls, push-provider choice/no fallback, network transitions, audio routing, receiving shares, voicemail/widgets/Live Activities/PiP and accessibility. Later packages need their own gates. |
| 7 | Maintainers close coverage, distribution, review and ownership gates | Current whole-change coverage, outstanding independent security review, store/dependency/licensing and build/update ownership. Honor the three-cycle cap; do not retry the unavailable named reviewer without changed access/authorization. |
| 8 | Project lead accepts/supersedes ADR-0047 | Compare maintained native costs against KMP/fully native alternatives using completed evidence. Only then update public accepted architecture, choose final framework and close the evaluation acceptance criteria. |

Only the bounded Opus/VP8 media path was exercised. AV1/H.264/VP9/HEVC and real screen-share capture/receive paths were not validated; future expansion must respect the existing codec admission/licensing policy and the approved conformance timebox/review boundary.

The original <100 ms key-generation target, mobile cold-start/decrypt targets, full codec expansion and lifecycle budgets were not established by these probes. No account crypto/secure-storage package, push service, production deployment, paid builder or mobile distribution was approved by the evaluation results.
