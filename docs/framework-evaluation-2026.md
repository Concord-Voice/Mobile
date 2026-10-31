# Mobile framework evaluation — 2026

**Status:** provisional recommendation; evaluation remains open.
**Reconciled:** 2026-10-16 (America/New_York), against the 2026-10-15 evidence cutoff. **Updated:** 2026-10-22 with the [simulator and emulator track](validation/2026-10-22-663-simulator-track.md).
**Issues:** #663 under #204, with Android #205 and iOS #206.

Use the [complete handover](663-native-evaluation-handover-2026-10-15.md) for results, decisions, gotchas and next steps; [ADR-0047](adr/0047-mobile-client-framework-and-native-boundaries.md) remains Proposed.

## Product basis

Android and iOS launch together with the same core E2EE messaging, voice/video and background-call features. Use the prototype UX with platform adjustments and practical mobile parity. Keep the Android API 26 floor; iOS 15 and 16 get best-effort compatibility with no commitment or testing (project lead, 2026-10-22); the current deployment target stays iOS 16.0. Keep receiving screen shares, voicemail, widgets/Live Activities and PiP. Phone broadcasting may be deferred consistently on both platforms if costly. Android includes UnifiedPush alongside FCM, with no silent Google fallback; iOS requires APNs/PushKit and native incoming-call behavior.

The prototype mocks services, media and crypto. A rendered prototype, a framework API or package listing is not proof of compatible encrypted communication or lifecycle behavior.

## Comparison

| Criterion | React Native + TypeScript | Kotlin Multiplatform | Native Kotlin / Swift |
| --- | --- | --- | --- |
| Shared prototype/UI | Closest fit to existing React/TypeScript skills; mobile components still need implementation. | Shared Compose UI or shared domain plus native UI are both options. | Separate UI implementations and parity work. |
| Portable desktop logic | Candidate reuse of schemas/domain/actions; DOM, Electron, persistence, workers and media require adapters. No measured reuse percentage. | Port TypeScript contracts/logic and verify protocol equivalence. | Port/maintain equivalent logic per platform. |
| Message crypto | Candidate native crypto adapter; browser WebCrypto is not automatically available. | Native/shared libraries still require compatibility and lifecycle proof. | Native APIs still require compatible formats and explicit custody behavior. |
| Media E2EE | Bounded matching iOS SDK/wrapper/RN path executed. Android matching integration remains unbuilt. | No comparable executable probe; native hooks still necessary. | Direct access to platform/native hooks; no comparable executable probe completed. |
| Background calls / push / storage | Focused platform adapters still required. | Platform-specific lifecycle and secure-storage integration remain necessary. | Direct platform integration, with duplicated implementation/maintenance. |
| Team and ownership | Best initial fit to current Go/TypeScript team, but substantial C++/ObjC/JNI/Swift/Kotlin maintenance remains. | Kotlin/tooling/porting and native ownership need staffing. | Both Kotlin and Swift teams/ownership need staffing. |
| Store / distribution | Framework choice does not prove policy compliance. | Same unresolved platform/distribution constraints. | Direct APIs do not automatically satisfy distribution, crypto or background policy. |

**Leading conditional candidate:** React Native/TypeScript, portable domain logic and explicit native boundaries. It currently has the strongest executed evidence in this evaluation, on iOS simulators for the RN/Concord path. Android has only unmodified-SDK evidence on emulators. This does not establish universal superiority over unprobed alternatives or final adoption.

## Crypto and dependency boundaries

Preserve desktop RSA-OAEP 4096, AES-256-GCM, HKDF, Argon2id and supported legacy PBKDF2 unwrap/recovery behavior. Protected storage is a separate concern from compatible cryptographic operations; session-only/logout/epoch semantics must be proven. Media v5 framing stays unchanged, with live frame bytes/keys native and synthetic keys only in probes.

The approved evaluation SDK/BoringSSL boundary is limited to the native media probe. Quick Crypto, Nitro, Base64, Keychain and push packages remain candidates behind separate approval/security/E2EE gates. Their observed 2026-10-13 versions were research observations, not adopted production pins. No keygen <100 ms, app cold-start <2 s or decrypt <50 ms benchmark was established. Do not select a package based on an API list or repeat outdated package-version claims as current.

Authenticated media/image loading must preserve authorization headers for the existing media proxy; #626's issue comments remain a requirement to verify on both mobile platforms. A new public or unauthenticated proxy is not implied by this evaluation.

## Current validation by platform

| Platform | Verified | Still unverified |
| --- | --- | --- |
| iOS | Generic unmodified SDK build and nine selected native tests; portable/native fail-closed/ownership tests; 23 reciprocal fixtures; matching prefixed SDK/wrapper/RN simulator media on iOS 27 and 26.3.1, then on 17.5, 18.6, 26.0, 26.5, 27.0 and 27.1 with the baseline and lifecycle suites ([2026-10-22](validation/2026-10-22-663-simulator-track.md)); scoped coverage; unsigned minimum-16 device build. | iOS 15/16 runtime (untested by decision, 2026-10-22), physical device, signing/provisioning, cross-client/account/secure-storage behavior, background/locked/killed calls, push and distribution. |
| Android | Complete separate Linux source/DEPS/package/hooks qualification; unmodified two-ABI AAR/ABI/426-class parity; unchanged-source ARM64 C++ test APK plus manifest/signature/ZIP/ELF inspection; fourteen bounded native cases passed on arm64 emulators at API 26, 37 and 37 with 16 KiB pages ([2026-10-22](validation/2026-10-22-663-simulator-track.md)). | Device native/API 26 runtime; device 16 KiB compatibility; Concord native/JNI implementation, matching prefixed SDK/wrapper/RN integration; device, lifecycle, push, custody and distribution. |
| Shared | Conditional framework proposal, native wire-format and callback feasibility, preserved build/results/recovery records. | Aggregate changed-code coverage, independent security review, full mobile parity, performance targets and named maintenance ownership. |

Do not add suite snapshots, repeat executions or utility-parser coverage to manufacture platform coverage. The handover gives exact unique counts and limitations.

## Recommendation and next decision

Follow the handover's ordered gates: identified dedicated devices, actual unchanged Android native execution on a device (emulator execution passed 2026-10-22), device-specific packaging/page-size qualification if required, Concord Android integration and prefixed artifacts, Android floor and both platforms' lifecycle/cross-client evidence, then coverage/security/distribution/ownership. Personal devices are excluded.

Keep ADR-0047 Proposed and #663 open. Do not update accepted/public architecture or imply implementation approval until the missing gates support a lead decision. If owned native maintenance or cross-platform/lifecycle evidence makes the current direction impractical, compare KMP/native alternatives using that concrete evidence before accepting or superseding the ADR.
