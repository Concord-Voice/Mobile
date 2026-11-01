# Mobile WebSocket compatibility implementation plan

Design: [bounded compatibility contract](2026-11-01-ws-event-budget-compatibility-design.md). Baseline: `741898aeef21c24500ffc97bb2dbcdd222b3322b`. The coordinating owner captured independent failures and released implementation in stages. Source is implemented; independent source review passed and the final integration-test review passed.

## Ownership and sequence

| Unit                                | Files                                                                                                                       | Responsibility                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Independent core/socket tests       | New `src/__tests__/wsEventBudget.test.ts`, existing `src/__tests__/core.test.ts`                                            | Parser/gate contract and actual connecting/live DmSocket paths.                                            |
| Independent lifecycle/UI tests      | `src/__tests__/session.test.ts`, `src/__tests__/conversation.test.ts`, `__tests__/App.test.tsx`                             | Real manual reopen ownership, session retirement and guarded UI completion.                                |
| Production implementation after RED | New `src/core/wsEventBudget.ts`; `DmSocket.ts`, `ConcordApi.ts`, `state/session.ts`, `state/conversation.ts`, `ui/Chat.tsx` | Implement the frozen contract without changing independent expectations to fit code.                       |
| Documentation and review            | This design/plan, relevant README feature paragraph, CHANGELOG if present                                                   | State actual behavior, validation and delivery limits. Coordinate any README edit with documentation PR40. |

The fresh source-claim census at preparation found only Mobile PR40, a documentation change. Recheck claims before publication if stale. No new router, Home, native adapter behavior, dependency, release workflow, version bump or server file is expected. Existing `socket.ts` origin/header behavior remains a control; only structural compatibility may require an edit.

## 1. Freeze tests and capture failures

Use the design's exact exports, constructor arguments, option fields and fixed messages. Test writers own distinct files and do not execute builds/tests or touch production during preparation. The coordinating owner runs the tests against the unchanged source and records expected missing-feature failures plus passing controls. Distinguish missing-module/compiler failures from behavioral regressions; capture behavioral failures wherever the existing interface permits them. Only the explicit RED release permits production edits.

Required core/parser vectors:

- Exact reason boundaries100/1000/30000; rejected99/30001, sign, leading zero, decimal/exponent, whitespace/newline/suffix, non-ASCII digits, absent/non-string reason; numeric1013 versus all other/string codes.
- Every class and retry bound; malformed data/known fields; either missing pair member; complete pair with another/missing code; ignored extras. Invalid error followed by a real ack proves the waiter survived. Valid budget error fails once with bounded typed values and sends nothing.
- Gate deadline equality, max-not-add behavior, retirement, no timer or auto-open, invalid direct delay immunity. Inject the clock per instance.

Required real transport vectors:

- Close1013 while opening and immediately after onopen before awaiting the promise; late onDropped attachment observes one drop and send/subscribe emit zero frames.
- Error-first attempt has no fabricated floor; timeout/abort/local close remove handlers and timers; captured old open/close/error/message/timer callbacks cannot resurrect work or move the gate after closure/retirement. Duplicate close is processed once.
- Ordinary close never clears a prior floor. Explicit close is silent. Advisory does not change gate/drop state or replay operations. Existing DM/ack/native-origin cases remain controls.

Required lifecycle/UI vectors:

- First Conversation closes1013, Back closes it, another Conversation using the same API cannot fetch a ticket/open early. Include another DM. Expiry alone creates no connection; a later manual start opens once. Refresh changing session ID preserves the gate.
- Close/retirement during a deferred ticket prevents factory/subscription/history/key allocation; a newly established floor during the same await also prevents construction. Abort an opening; invoke its captured late handlers.
- Replacement API/server starts fresh and old callbacks cannot affect it. Connect replacement, expiry, signOut and direct logout retire before awaited cleanup. Ordinary refresh does not.
- Chat suppresses old start completion after cleanup; fixed messages render without server content. Existing draft restoration and native-key release remain intact. Failed ciphertext/nonce/subscription is never replayed.

## 2. Implement pure policy and DmSocket after release

Implement sanitized error validation and whole-reason parsing, the two typed errors and the one-deadline gate. Preserve canonical optional-field/pair semantics. Inspect the verified React Native clock/type boundary during actual typecheck; use no Date.now fallback or package-global clock mutation.

Update SocketLike metadata and DmSocket options. Introduce bounded settled/closed state, early close capture, pending-open abort cleanup, late callback ownership checks and delayed one-shot drop notification on callback attachment. Keep current timeout argument/default and operation send/ack behavior. Validate before failing waiters. Do not add transport queues or reconnect/replay machinery.

## 3. Wire the actual sign-in and manual-reopen owner

Add the gate to ConcordApi; retire synchronously in direct logout and actual session-store ownership transitions. Do not retire/reset on token refresh. Pass owner/cancel options through Conversation's injectable factory; check before ticket, after ticket and before native construction. Close aborts before transport/key cleanup. Verify ownership before subscribe/history. Guard Chat effect completion and add only the fixed error mappings.

Adapt old structural test fakes deliberately to contain a real gate or explicit bounded test double. Do not bypass production checks to keep fixtures green. Factory call assertions now include the ownership options; test their behavior, not merely presence.

## 4. Verify, review and document

The coordinating owner runs focused Jest tests for parser, core, conversation, session and App; then the pinned project TypeScript and lint checks. Because shared core/session behavior changes, run the existing JS suite as warranted and retain the established coverage/review requirements. Treat any dependency/environment blocker separately from feature correctness. No native build, emulator, signing, production operation or release commission is implicit in this unit.

Independent review should check whole-input grammar, canonical pair parity, bounded state, token-refresh continuity, stale callback isolation, timer cleanup, immediate post-open close, manual-only reopening, no replay and safe UI text. If the proposed interface must change, coordinate both test writers before modifying it and record the reason; do not weaken accepted behavior to obtain green tests.

Update the README's actual DM behavior after implementation, with PR40 coordination; retain explicit absence of automatic reconnect. Record precise executed validation and source provenance. No release floor may be inferred from source/package version, and no passed JS test establishes Android/native delivery. Merge/release and server activation retain their separate approvals and delivery gates.

## Execution snapshot — 2026-11-01

The independent tests first failed on the missing parser/module and actual missing owner/options/retirement/UI behavior. Follow-up regressions exposed direct refresh401 retirement without a callback, uppercase max-UUID canonical parity, and stale send completion restoring an old draft over a replacement. Each production fix followed the coordinating owner's failing run; test writers corrected fixture-only overconstraints separately.

Implemented all planned production files and the narrow README manual-reopen/advisory paragraph; no native/dependency/server/release file changed. No CHANGELOG exists, so none was introduced. The coordinating owner will recheck PR40 documentation overlap before publication.

Owner-run validation: full JS suite **8/8 suites, 211/211 tests, 2.26 seconds**; TypeScript passed. The coverage summary gives `wsEventBudget.ts` **100% lines/statements/functions/branches** (47/47, 52/52, 12/12, 53/53 respectively). Final lint and TypeScript checks pass with zero diagnostics. Independent source review passed; the final integration-test review passed and normal repository hooks remain. No native runtime, release-floor selection or activation is implied.
