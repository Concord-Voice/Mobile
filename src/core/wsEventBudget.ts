/**
 * Canonical #2270 error/close contract: Self-Hosted PR144,
 * eb29e9702d8f07d9919992803c35ca5a9d507fca. Keep parity with its ErrorSchema.
 */
const EVENT_CLASSES = [
  'content',
  'typing',
  'subscription',
  'presence',
  'profile',
  'server',
  'ready',
  'renewal',
] as const;
export type WsEventClass = (typeof EVENT_CLASSES)[number];

export type WsErrorData = {
  code?: string;
  channel_id?: string;
  current_epoch?: number;
  event_class?: WsEventClass;
  retry_after_ms?: number;
};

const validDelay = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 100 &&
  value <= 30000;

export function parseWsRetryAfterMs(reason: unknown): number {
  if (typeof reason !== 'string') return 1000;
  const match = /^retry_after_ms=([1-9][0-9]{2,4})$/.exec(reason);
  // `$` also matches before a final newline: require the whole native reason.
  if (!match || match[0].length !== reason.length) return 1000;
  const value = Number(match[1]);
  return validDelay(value) ? value : 1000;
}

// Zod's canonical UUID grammar: RFC variant/version, plus nil and max UUIDs.
const UUID =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export function parseBudgetError(data: unknown): WsErrorData | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return null;
  const input = data as Record<string, unknown>;
  const result: WsErrorData = {};
  if ('code' in input) {
    if (typeof input.code !== 'string') return null;
    result.code = input.code;
  }
  if ('channel_id' in input) {
    if (
      typeof input.channel_id !== 'string' ||
      input.channel_id.length !== 36 ||
      !UUID.test(input.channel_id)
    )
      return null;
    result.channel_id = input.channel_id;
  }
  if ('current_epoch' in input) {
    if (
      typeof input.current_epoch !== 'number' ||
      !Number.isSafeInteger(input.current_epoch) ||
      input.current_epoch < 0
    )
      return null;
    result.current_epoch = input.current_epoch;
  }
  if (
    input.code === 'ws_rate_limited' ||
    'event_class' in input ||
    'retry_after_ms' in input
  ) {
    if (
      !EVENT_CLASSES.some(value => value === input.event_class) ||
      !validDelay(input.retry_after_ms)
    )
      return null;
    result.event_class = input.event_class as WsEventClass;
    result.retry_after_ms = input.retry_after_ms;
  }
  return result;
}

export class WsReconnectCooldownError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('WebSocket reopening is cooling down');
    this.name = 'WsReconnectCooldownError';
  }
}

export class WsRateLimitedError extends Error {
  constructor(
    readonly eventClass: WsEventClass,
    readonly retryAfterMs: number,
  ) {
    super('WebSocket operation rate limited');
    this.name = 'WsRateLimitedError';
  }
}

// RN 0.88 installs this native monotonic clock, but its globals omit the type.
// Keep the assertion local instead of adding DOM globals or a wall-clock fallback.
const monotonicNow = () =>
  (
    globalThis as typeof globalThis & { performance: { now(): number } }
  ).performance.now();

/** One sign-in's manual-reopen deadline. Expiry never schedules a connection. */
export class WsReconnectGate {
  private retryNotBefore = 0;
  private retired = false;

  constructor(private readonly now: () => number = monotonicNow) {}

  get active(): boolean {
    return !this.retired;
  }

  assertCanOpen(): void {
    if (this.retired) throw new Error('Socket owner closed');
    const remaining = this.retryNotBefore - this.now();
    if (remaining > 0) throw new WsReconnectCooldownError(Math.ceil(remaining));
  }

  recordOverload(retryAfterMs: number): void {
    if (this.retired || !validDelay(retryAfterMs)) return;
    this.retryNotBefore = Math.max(
      this.retryNotBefore,
      this.now() + retryAfterMs,
    );
  }

  retire(): void {
    this.retired = true;
  }
}
