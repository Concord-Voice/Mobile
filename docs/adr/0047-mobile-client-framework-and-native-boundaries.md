# 0047 — Mobile client framework and native boundaries

**Status:** Proposed — conditional React Native direction; no framework adoption or product-release approval.
**Created:** 2026-10-14. **Reconciled:** 2026-10-16. **Updated:** 2026-10-22 (simulator/emulator evidence, iOS 15/16 policy).
**Decision owner:** project lead.
**Scope:** #663, under #204, with Android #205 and iOS #206.
**Evidence:** [reconciled handover](../663-native-evaluation-handover-2026-10-15.md), [2026-10-22 simulator and emulator track](../validation/2026-10-22-663-simulator-track.md), and frozen evaluated source lock.

## Context

Mobile must preserve existing E2EE formats and release Android/iOS together with the same core capabilities. The prototype supplies the intended shared experience; its mocked services, crypto and media do not prove an implementation. Framework choice alone cannot establish native key custody, frame hooks, incoming/background calls, distribution or maintenance ownership.

The approved bounded probe now has iOS simulator media evidence, plus Android build/static evidence and bounded native-test execution on emulators. These are different validation levels. Dedicated test devices are not ready; the personal iPhone is excluded. Independent security, Android floor-device runtime, cross-client/lifecycle and aggregate-coverage gates remain open.

## Proposed decision

Keep React Native/TypeScript as the leading conditional candidate for shared mobile UI and portable domain work, with explicit native boundaries:

- Share schemas, domain logic and selected actions only when ownership, reset and persistence behavior are proven. No broad desktop refactor or assumed reuse percentage.
- Keep protected storage, push, incoming-call lifecycle, audio ownership and permissions behind small native adapters.
- Keep encoded frames, synthetic probe keys, creation-time fail-closed admission, callback registration and generation/ownership fencing native. Preserve desktop v5 framing and existing key lifecycle/strength.
- Retain the Android API 26 floor. Under the project lead's 2026-10-22 decision, iOS 15 and 16 get best-effort compatibility with no support commitment and no testing. The current deployment target stays iOS 16.0, and simulator-tested iOS starts at 17.5. Deliver core E2EE messaging, voice/video and background calls together.
- Include UnifiedPush plus FCM without silent Google fallback, and APNs/PushKit on iOS. Retain receiving screen shares, voicemail, widgets/Live Activities and PiP. Any phone-broadcast deferral applies to both platforms.

The evaluation-only SDK/BoringSSL approval does not adopt later crypto, protected-storage or push packages. Each keeps its separate approval, dependency and security/E2EE review gates. Accepted architecture is not changed while the decision is provisional.

## Alternatives

| Approach | Fit supported by assessment | Unresolved cost |
| --- | --- | --- |
| React Native + TypeScript | Fits the prototype/current team and bounded iOS native-media integration. | Maintained SDK/wrapper/native adapters; Android prefix/runtime proof; lifecycle, crypto custody and distribution. |
| KMP + Compose or native UI | Can share mobile domain/UI work while retaining platform integrations. | Port existing TypeScript/protocol work; prove iOS/media integration and staffing/tool ownership. No comparable executable probe was completed. |
| Native Kotlin + Swift | Direct platform APIs and independent platform optimization. | Build/maintain the same core UX and protocol behavior twice. No comparable executable probe was completed. |

The [framework assessment](../framework-evaluation-2026.md) records the limits; no numeric scoring or benchmark winner is claimed.

## Consequences and evidence limits

- iOS: generic ARM64 device/simulator SDK built for minimum 16; nine selected unmodified native tests passed on a newer test host. The Concord probe records 46 C++ cases, six unique Objective-C cases and 23 reciprocal fixtures. Matching prefixed artifacts passed one unique RN UI case on iOS 27 and 26.3.1, with repeat executions; native status report 8/8. On 2026-10-22, that case, the nine baseline GoogleTests and the six lifecycle cases passed on iOS 17.5, 18.6, 26.0, 26.5, 27.0 and 27.1 simulators. The unsigned minimum-16 device app was built but not run. No physical-device, cross-client or background result exists, and iOS 15/16 are untested by decision.
- Android: complete Linux SDK/DEPS/package/hook qualification and the unmodified ARM64/x86_64 AAR build passed. The separate unchanged-source ARM64 C++ test APK also built and passed final static manifest/signature/ZIP checks. On 2026-10-22, its fourteen bounded native cases were discovered and passed on macOS arm64 emulators at API 26, API 37, and API 37 with 16 KiB pages. No device execution yet. Generic outputs are not wrapper-prefixed artifacts; no Concord Android kernel/JNI/wrapper/RN runtime is built or verified.
- Android harness maintenance is real: the Java instrumentation route needed a separate three-call test-source qualification and then encountered Byte Buddy DEX packaging. Copied-jar DEX qualification is not an APK/runtime pass. The C++ route avoids that dependency. The local Rosetta/Linux emulator never booted (`signalfd` unsupported), but the macOS arm64 emulator runs it.
- Page-size checks remain scoped: production ARM64 RELRO aligns, production x86_64 and the ARM64 test library have an 8 KiB remainder at a 16 KiB boundary. APK ZIP alignment passes. The test library loaded and passed on a 16 KiB emulator image with no page-size compatibility flag set. Device 16 KiB compatibility and any link-flag fix remain unverified.
- SDK changed-executable coverage is 1,035/1,215 (85.19%); wrapper 449/540 (83.15%); selected JS 33/35. Seven SDK/two wrapper headers remain unmapped and 233 Android lines unmeasured. The aggregate coverage gate remains open.
- Three broad review cycles are exhausted in the existing review track; continue only for new P0/P1 defects. The separate named security review could not start because of access failure. It is not waived by E2EE review or local tests.

The current native patch is 66 SDK files / 272,149 bytes plus four wrapper files / 28,722 bytes. Generic/prefixed ABI matching and the SDK owner-lifetime repair must survive future updates. A named maintenance/build/distribution/security owner remains unassigned. The original Linux builder image is no longer present; source and selected outputs were separately preserved, and any restored environment needs verification.

## Acceptance / revisit gate

The project lead may accept or supersede this ADR after unchanged Android native execution on a device, matching prefixed Android integration, the Android API 26 floor on a device, device and lifecycle paths on both platforms, cross-client E2EE/account evidence, aggregate coverage, independent security review, distribution/dependency review and named ownership are complete. The handover provides the ordered sequence. Do not close #663 or declare mobile implementation/release ready from this documentation PR.
