# Mobile WebSocket event-budget compatibility

Status: implemented after independent failing tests; independent source and test reviews passed. Source baseline: `741898aeef21c24500ffc97bb2dbcdd222b3322b`. Scope: consume the canonical #2270 close/advisory contract without adding automatic reconnect or replaying operations. This is source validation, not client delivery or server activation.

## Existing behavior and intended result

`Home` mounts one `Chat`, which creates a `Conversation`. Back closes it; reopening creates another conversation and obtains a new ticket/socket. `ConcordApi` survives these screen changes within a sign-in. Refresh can replace the server session ID while retaining that API instance. Sign-in/restoration creates a fresh API with an immutable server base.

An actual owned 1013 close establishes a bounded cooldown on the current API instance. A manual reopen during it fails before ticket acquisition or socket construction. Expiry causes no action. For a 3000 ms close at monotonic time T, Back/reopen before T+3000 makes no ticket request; a new user-initiated reopen at or after T+3000 may make one ticket/open/subscribe attempt.

The deadline survives changing DMs, returning to Messages and ordinary token refresh. Logout, expiry or replacement sign-in retires the old owner synchronously. A fresh API/server starts clean. There is one deadline per live API, with no global registry, persistence, connection timer, queued reopen, per-operation retry policy or automatic replay.

## Wire contract and provenance

The canonical error schema is [Self-Hosted commit eb29e9702d8f07d9919992803c35ca5a9d507fca](https://github.com/Concord-Voice/Self-Hosted/commit/eb29e9702d8f07d9919992803c35ca5a9d507fca), PR144. Desktop's `desktop/src/renderer/types/ws-events.ts` carries the matching E schema; `desktop/src/renderer/services/messaging/wsEventBudget.ts` supplies the whole-reason parser precedent. This consumer ports the narrow contract and parity fixtures without adding a new schema dependency or relying on the unpublished private protocol package.

- Only numeric close code 1013 establishes a floor. Its entire reason must be `retry_after_ms=<canonical ASCII decimal>`, with integer value 100..30000 inclusive. Reject leading zero, signs, whitespace/newlines, suffixes, fractions, exponents and non-ASCII digits. Invalid/missing/non-string reason on 1013 means 1000 ms. Other close codes neither install nor clear a floor. Do not coerce a string close code.
- Frame/data must be non-null, non-array objects. Error data permits optional string `code`, UUID `channel_id`, nonnegative integer `current_epoch`, closed-enum `event_class`, and finite integer `retry_after_ms` in 100..30000. Classes are `content`, `typing`, `subscription`, `presence`, `profile`, `server`, `ready`, `renewal`.
- Code `ws_rate_limited`, or either budget field being present, requires both valid budget fields. A complete pair with another/missing code remains valid under canonical E, but is not promoted to a rate-limit error. Unknown extras, including `message`, are ignored and stripped.
- Invalid envelopes have no effects. Valid `ws_rate_limited` fails existing waiters with a typed error carrying only the bounded class/retry pair. Other valid errors retain generic local failure. No request correlation exists in this envelope, so existing fail-all semantics remain.
- Advisories do not advance the reconnect gate, close the socket, mark it dropped, or cause sends. No server prose, raw close reason, payload or identifier is logged/rendered by this feature. Existing DM ciphertext, ack and nonce semantics remain.

## Frozen interfaces

These interfaces are shared by the independent core/socket and session/conversation/UI test writers. Production implementation follows the captured failing tests.

New `src/core/wsEventBudget.ts` exports:

```ts
export type WsEventClass =
  | 'content'
  | 'typing'
  | 'subscription'
  | 'presence'
  | 'profile'
  | 'server'
  | 'ready'
  | 'renewal';

export type WsErrorData = {
  code?: string;
  channel_id?: string;
  current_epoch?: number;
  event_class?: WsEventClass;
  retry_after_ms?: number;
};

export function parseWsRetryAfterMs(reason: unknown): number;
export function parseBudgetError(data: unknown): WsErrorData | null;

export class WsReconnectCooldownError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number);
}
export class WsRateLimitedError extends Error {
  readonly eventClass: WsEventClass;
  readonly retryAfterMs: number;
  constructor(eventClass: WsEventClass, retryAfterMs: number);
}
export class WsReconnectGate {
  constructor(now?: () => number);
  get active(): boolean;
  assertCanOpen(): void;
  recordOverload(retryAfterMs: number): void;
  retire(): void;
}
```

`parseBudgetError` returns sanitized wire-shaped fields, `{}` for a legacy error containing only unknown extras, or `null` for invalid input. It does not add a discriminant or classify another code as rate-limited. Known optional properties explicitly present with invalid values are rejected; JSON cannot carry undefined. The adapter checks `code === 'ws_rate_limited'` after validation.

The gate defaults to `() => performance.now()` and accepts an instance clock for deterministic tests. Store only a deadline and retired state. Recording a validated delay sets `max(oldDeadline, now + delay)`; it never adds delay to the old deadline. Invalid direct delay values must not corrupt the gate. An unexpired deadline throws `WsReconnectCooldownError` with positive outward-rounded remaining milliseconds; a retired gate rejects as a closed owner, not overload. Equality permits opening. Retirement is idempotent and irreversible. No timer belongs to the gate.

`ConcordApi` adds `readonly wsReconnect: WsReconnectGate`. Successful refresh/adopt preserve it. A refused refresh retires before clearing the session or invoking onExpired, including when no callback is installed. Logout retires before its first await, including when there is no session. Session-store replacement, guarded expiry and signOut retire the outgoing gate synchronously before publishing the new state. The actual store already creates a new API for the next sign-in; no session persistence or HTTP retry behavior changes.

`src/core/DmSocket.ts` exports:

```ts
export type DmSocketOpenOptions = {
  isCurrent?: () => boolean;
  onOverload?: (retryAfterMs: number) => void;
  signal?: AbortSignal;
};
// SocketLike member:
onclose: ((event?: {code?: unknown; reason?: unknown}) => void) | null;
// Existing arguments retained, optional fourth argument added:
DmSocket.open(url, create, timeoutMs = 15000, options = {});
```

The injectable Conversation factory becomes `(url: string, options: DmSocketOpenOptions) => Promise<DmSocket>`; its default forwards `DmSocket.open(url, createSocket, 15000, options)`. Conversation owns an AbortController. Its `isCurrent` checks `!closed && api.wsReconnect.active`; its overload callback records only while current. Closed/owner/gate checks run before ticket acquisition, after awaiting the ticket and immediately before invoking the factory. A floor established while a ticket is outstanding prevents construction. No automatic replacement ticket is requested.

## Transport and view lifecycle

Connecting handlers are installed before returning control. Native 1013 close handling records the floor before rejecting an opening or notifying drop. Successful open installs live handlers synchronously before resolving. If close arrives immediately after open but before the caller resumes, subscribe/send reject without emitting frames; attaching `onDropped` later reports that genuine drop once. This uses the existing callback surface rather than adding an `isDropped` API.

A settled-opening latch and closed-transport latch prevent duplicate/captured callbacks from acting. Every external callback checks ownership. Error, timeout or abort settles a pending opening once, clears its timer/listeners and closes transport. Later callbacks from that retired attempt do nothing. A raw error is not evidence of 1013. An actual 1013 delivered before cleanup records its floor; a later error cannot erase it.

Live close records before failing waiters and notifying drop. Explicit local close is silent, clears handlers/timers and fails waiters. Captured callbacks still self-guard after handlers are removed. Conversation close marks closed and aborts first, then closes transport and releases keys. Owner retirement blocks stale effects; view cleanup aborts any pending open. No terminal callback can start another socket or acknowledge an operation.

Before subscribe/history work, verify the Conversation and transport still belong to the owner. Preserve existing native-key release checks. Chat guards start's error/loading callbacks with an effect-local live flag. An effect-owned conversation reference also guards send catch/finally: an old send cannot restore its draft/error or finish a replacement's pending send. Cleanup clears ownership, replacement resets sending state, and same-conversation failed-draft restoration remains intact.

`describeError` uses fixed local messages:

- Cooldown: `The server is busy. Wait a moment, then go back and reopen this conversation.`
- Valid rate-limit advisory: `The server is busy. Try again later.`

The existing dropped message and Back navigation remain. There is no countdown or timer-driven action. A restored failed draft remains unsent until another user action.

## React Native evidence

`package-lock.json` pins React Native and its TypeScript config to 0.88.0. The published package's generated index references `src/types/globals.d.ts`. At [v0.88.0 globals](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/src/types/globals.d.ts), `WebSocketCloseEvent` declares optional numeric code/string reason and the native constructor permits the existing options/header argument. The broader defensive adapter type is deliberate.

[WebSocket.js](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/Libraries/WebSocket/WebSocket.js) forwards `websocketClosed` code/reason into CloseEvent. Its failure path emits error followed by abnormal close1006. This supports cleaning up error-first attempts without treating that error as overload. [setUpPerformance](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/src/private/setup/setUpPerformance.js) installs global performance; [Performance.js](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/src/private/webapis/performance/Performance.js) delegates now to NativePerformance and documents milliseconds. Existing HTTP code already uses AbortController.

These sources were reviewed read-only, including published-package declarations. The subsequent project typecheck confirmed the React Native config lacks a performance declaration. Implementation uses a narrow local structural assertion for the verified runtime global and passes typecheck, without adding DOM globals, a wall-clock fallback, a native bridge or dependency. No native launch or runtime clock measurement is claimed.

## Recorded source validation

The coordinating owner ran `npm test -- --runInBand --coverage --coverageReporters=json-summary --coverageReporters=text-summary`: **8 suites and 211 tests passed in 2.26 seconds**. `npm run typecheck` passed. Final `npm run lint` and TypeScript checks pass with zero diagnostics. Independent source review passed; the final integration-test review passed.

The generated coverage summary records the new `wsEventBudget.ts` module at 47/47 lines, 52/52 statements, 12/12 functions and 53/53 branches (**100% each**). Full-suite coverage is 97.09% lines, 95.04% statements, 88.75% functions and 91.23% branches. These are executed JS coverage results, not native-platform, release or deployment evidence.

## Exclusions and delivery

Android platform/version declaration, absent native crypto, native/store/signing work and release-floor selection are separate units. Package/native version metadata is not evidence of a distributed compatible client. Source completion does not establish the supported Mobile population or permit server activation. Actual artifact/version/distribution evidence and platform-aware minimum enforcement remain required, alongside the existing Desktop, Admin, canonical server/ACL delivery and workload gates. Budget defaults/rates remain UNMEASURED. No production settings, supported-population decisions or server policy change belongs to this implementation.
