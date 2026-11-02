import {
  parseBudgetError,
  parseWsRetryAfterMs,
  WsRateLimitedError,
  WsReconnectCooldownError,
  WsReconnectGate,
} from '../core/wsEventBudget';

const CLASSES = [
  'content',
  'typing',
  'subscription',
  'presence',
  'profile',
  'server',
  'ready',
  'renewal',
] as const;

describe('WebSocket event-budget wire compatibility', () => {
  it.each([100, 1000, 30000])(
    'accepts the entire canonical reason for %i ms',
    ms => {
      expect(parseWsRetryAfterMs(`retry_after_ms=${ms}`)).toBe(ms);
    },
  );

  it.each([
    undefined,
    null,
    100,
    {},
    '',
    'retry_after_ms=99',
    'retry_after_ms=30001',
    'retry_after_ms=0100',
    'retry_after_ms=+100',
    'retry_after_ms=-100',
    'retry_after_ms=100.0',
    'retry_after_ms=1e3',
    ' retry_after_ms=100',
    'retry_after_ms=100 ',
    'retry_after_ms=100\n',
    'retry_after_ms=100\r\n',
    'retry_after_ms=100suffix',
    'retry_after_ms=１００',
    'retry_after_ms=١٠٠',
    'retry_after_ms=99999999999999999999999999999999999',
  ])('defaults an invalid reason (%#) without coercion', reason => {
    expect(parseWsRetryAfterMs(reason)).toBe(1000);
  });

  it.each(CLASSES)(
    'accepts both bounded advisory delays for %s',
    eventClass => {
      for (const retry of [100, 30000]) {
        expect(
          parseBudgetError({
            code: 'ws_rate_limited',
            event_class: eventClass,
            retry_after_ms: retry,
            message: 'server prose must not escape',
            extra: { arbitrary: true },
          }),
        ).toEqual({
          code: 'ws_rate_limited',
          event_class: eventClass,
          retry_after_ms: retry,
        });
      }
    },
  );

  it('accepts legacy errors and a complete budget pair with another or absent code', () => {
    expect(parseBudgetError({ message: 'private server text' })).toEqual({});
    expect(parseBudgetError({ message: { untrusted: true } })).toEqual({});
    expect(
      parseBudgetError({
        code: 'legacy_code',
        event_class: 'content',
        retry_after_ms: 100,
      }),
    ).toEqual({
      code: 'legacy_code',
      event_class: 'content',
      retry_after_ms: 100,
    });
    expect(
      parseBudgetError({ event_class: 'typing', retry_after_ms: 30000 }),
    ).toEqual({ event_class: 'typing', retry_after_ms: 30000 });
    expect(
      parseBudgetError({
        code: 'legacy_code',
        channel_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
        current_epoch: 0,
        other: 'discard',
      }),
    ).toEqual({
      code: 'legacy_code',
      channel_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      current_epoch: 0,
    });
  });

  it('preserves canonical UUID case handling including the lowercase-only max special value', () => {
    // Canonical E uses optional z.string().uuid(); Zod 4.6.7's published
    // v4/core/regexes.js uuid() permits mixed-case RFC UUIDs but lowercase max.
    for (const channelId of [
      '6F1c2A3b-4D5e-4F60-8a7B-9c0D1E2f3A4b',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]) {
      expect(parseBudgetError({ channel_id: channelId })).toEqual({
        channel_id: channelId,
      });
    }
    expect(
      parseBudgetError({ channel_id: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF' }),
    ).toBeNull();
  });

  it.each([
    null,
    [],
    'error',
    4,
    { code: 1013 },
    { code: null },
    { code: 'ws_rate_limited' },
    { code: 'ws_rate_limited', event_class: 'content' },
    { code: 'ws_rate_limited', retry_after_ms: 100 },
    { code: 'legacy_code', event_class: 'content' },
    { retry_after_ms: 100 },
    { event_class: 'unknown', retry_after_ms: 100 },
    ...[99, 30001, 100.5, '100', NaN, Infinity, -Infinity, null].map(retry => ({
      event_class: 'content',
      retry_after_ms: retry,
    })),
    { channel_id: 'not-a-uuid' },
    { channel_id: null },
    { current_epoch: -1 },
    { current_epoch: 0.5 },
    { current_epoch: '0' },
    { current_epoch: Infinity },
  ])('rejects malformed known fields or partial budget pairs (%#)', value => {
    expect(parseBudgetError(value)).toBeNull();
  });

  it('retains only fixed local text and bounded typed advisory data', () => {
    const error = new WsRateLimitedError('renewal', 30000);
    expect(error).toBeInstanceOf(Error);
    expect(error.eventClass).toBe('renewal');
    expect(error.retryAfterMs).toBe(30000);
    expect(error.message).not.toContain('renewal');
    expect(error.message).not.toContain('30000');
    const cooldown = new WsReconnectCooldownError(100);
    expect(cooldown).toBeInstanceOf(Error);
    expect(cooldown.retryAfterMs).toBe(100);
  });
});

describe('WsReconnectGate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('allows exactly at expiry, never schedules an opening, and does not accumulate elapsed floors', () => {
    let now = 10000;
    const gate = new WsReconnectGate(() => now);
    expect(gate.active).toBe(true);
    expect(() => gate.assertCanOpen()).not.toThrow();
    gate.recordOverload(1000);
    now = 10999;
    let error: unknown;
    try {
      gate.assertCanOpen();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WsReconnectCooldownError);
    expect(error).toMatchObject({ retryAfterMs: 1 });
    expect(jest.getTimerCount()).toBe(0);
    now = 11000;
    expect(() => gate.assertCanOpen()).not.toThrow();
    now = 20000;
    gate.recordOverload(100);
    now = 20100;
    expect(() => gate.assertCanOpen()).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('extends by max(now + delay), never adds onto the previous deadline', () => {
    let now = 0;
    const gate = new WsReconnectGate(() => now);
    gate.recordOverload(3000);
    now = 100;
    gate.recordOverload(100);
    now = 2999;
    expect(() => gate.assertCanOpen()).toThrow(WsReconnectCooldownError);
    now = 3000;
    expect(() => gate.assertCanOpen()).not.toThrow();
    gate.recordOverload(1000);
    now = 3500;
    gate.recordOverload(1000);
    now = 4500;
    expect(() => gate.assertCanOpen()).not.toThrow();
  });

  it('retirement is permanent and isolated from a fresh owner', () => {
    let now = 0;
    const previous = new WsReconnectGate(() => now);
    previous.recordOverload(30000);
    previous.retire();
    previous.retire();
    expect(previous.active).toBe(false);
    const current = new WsReconnectGate(() => now);
    previous.recordOverload(30000);
    expect(current.active).toBe(true);
    expect(() => current.assertCanOpen()).not.toThrow();
    now = 100000;
    expect(() => previous.assertCanOpen()).toThrow();
    expect(() => current.assertCanOpen()).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
