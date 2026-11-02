/**
 * One-conversation DM socket, carried over from the #663 probe.
 * Frames are validated here, at the dispatch boundary, before anything uses them.
 */

import {
  parseBudgetError,
  parseWsRetryAfterMs,
  WsRateLimitedError,
} from './wsEventBudget';

export type DmMessage = {
  id: string;
  conversationId: string;
  userId: string;
  content: string;
  keyVersion: number;
  /** Display name, else username; absent on frames that omit both. */
  sender?: string;
  createdAt?: string;
};

const optionalText = (v: unknown) =>
  typeof v === 'string' && v ? v : undefined;

type Waiter<T> = {
  accept: (frame: Frame) => T | undefined;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};
type Frame = { type: string; data: Record<string, unknown> };

export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event?: { code?: unknown; reason?: unknown }) => void) | null;
};

export type DmSocketOpenOptions = {
  isCurrent?: () => boolean;
  onOverload?: (retryAfterMs: number) => void;
  signal?: AbortSignal;
};

function detach(socket: SocketLike): void {
  socket.onopen = null;
  socket.onerror = null;
  socket.onclose = null;
  socket.onmessage = null;
}

function isCurrent(options: DmSocketOpenOptions): boolean {
  return !options.signal?.aborted && (options.isCurrent?.() ?? true);
}

function parseFrame(raw: unknown): Frame | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return null;
    const { type, data } = value as Record<string, unknown>;
    if (
      typeof type !== 'string' ||
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data)
    )
      return null;
    return { type, data: data as Record<string, unknown> };
  } catch {
    return null;
  }
}

function dmMessage(frame: Frame): DmMessage | undefined {
  if (frame.type !== 'dm_message') return undefined;
  const d = frame.data;
  if (
    typeof d.id !== 'string' ||
    typeof d.conversation_id !== 'string' ||
    typeof d.user_id !== 'string' ||
    typeof d.content !== 'string' ||
    !Number.isSafeInteger(d.key_version) ||
    (d.key_version as number) < 1
  ) {
    return undefined;
  }
  return {
    id: d.id,
    conversationId: d.conversation_id,
    userId: d.user_id,
    content: d.content,
    keyVersion: d.key_version as number,
    sender: optionalText(d.display_name) ?? optionalText(d.username),
    createdAt: optionalText(d.created_at),
  };
}

export class DmSocket {
  private waiters: Array<Waiter<unknown>> = [];
  private closed = false;
  private dropped = false;
  private dropNotified = false;
  private dropListener: (() => void) | null = null;
  private readonly abort = () => this.close();
  /** Every valid incoming DM, for a live conversation view. */
  onMessage: ((message: DmMessage) => void) | null = null;
  /** Called when the server or network drops the socket (not on close()). */
  get onDropped(): (() => void) | null {
    return this.dropListener;
  }

  set onDropped(listener: (() => void) | null) {
    this.dropListener = listener;
    this.notifyDrop();
  }

  private constructor(
    private readonly socket: SocketLike,
    private readonly timeoutMs: number,
    private readonly options: DmSocketOpenOptions,
  ) {
    socket.onmessage = event => {
      if (!this.usable()) return;
      const frame = parseFrame(event.data);
      if (!frame) return;
      if (frame.type === 'error') {
        const error = parseBudgetError(frame.data);
        if (!error) return;
        this.failAll(
          error.code === 'ws_rate_limited' &&
            error.event_class !== undefined &&
            error.retry_after_ms !== undefined
            ? new WsRateLimitedError(error.event_class, error.retry_after_ms)
            : new Error('Server error frame'),
        );
        return;
      }
      const message = dmMessage(frame);
      if (message) this.onMessage?.(message);
      if (!this.usable()) return;
      for (const waiter of [...this.waiters]) {
        const value = waiter.accept(frame);
        if (value !== undefined) {
          this.waiters = this.waiters.filter(w => w !== waiter);
          waiter.resolve(value);
        }
      }
    };
    socket.onclose = event => {
      if (!this.usable()) return;
      this.closed = true;
      this.dropped = true;
      this.cleanup();
      if (event?.code === 1013)
        options.onOverload?.(parseWsRetryAfterMs(event.reason));
      this.failAll(new Error('Socket closed'));
      this.notifyDrop();
    };
    options.signal?.addEventListener('abort', this.abort);
  }

  private notifyDrop(): void {
    if (
      !this.dropped ||
      this.dropNotified ||
      !this.dropListener ||
      !isCurrent(this.options)
    )
      return;
    this.dropNotified = true;
    this.dropListener();
  }

  private cleanup(): void {
    detach(this.socket);
    this.options.signal?.removeEventListener('abort', this.abort);
  }

  private usable(): boolean {
    if (!isCurrent(this.options)) this.close();
    return !this.closed;
  }

  static open(
    url: string,
    create: (url: string) => SocketLike,
    timeoutMs = 15000,
    options: DmSocketOpenOptions = {},
  ): Promise<DmSocket> {
    return new Promise((resolve, reject) => {
      if (!isCurrent(options)) {
        reject(new Error('Socket owner closed'));
        return;
      }
      const socket = create(url);
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        detach(socket);
        options.signal?.removeEventListener('abort', abort);
      };
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.close();
        reject(new Error(message));
      };
      const abort = () => fail('Socket opening aborted');
      const timer = setTimeout(() => fail('Socket open timed out'), timeoutMs);
      socket.onerror = () => fail('Socket failed to open');
      socket.onclose = event => {
        if (settled) return;
        const owned = isCurrent(options);
        // Settle/clean up before external callbacks, but record before rejection.
        settled = true;
        cleanup();
        socket.close();
        if (owned && event?.code === 1013)
          options.onOverload?.(parseWsRetryAfterMs(event.reason));
        reject(new Error('Socket closed'));
      };
      socket.onopen = () => {
        if (settled) return;
        if (!isCurrent(options)) {
          fail('Socket owner closed');
          return;
        }
        settled = true;
        cleanup();
        resolve(new DmSocket(socket, timeoutMs, options));
      };
      options.signal?.addEventListener('abort', abort);
      if (!isCurrent(options)) fail('Socket owner closed');
    });
  }

  private failAll(error: Error): void {
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach(w => w.reject(error));
  }

  private wait<T>(
    accept: (frame: Frame) => T | undefined,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.usable()) {
        reject(new Error('Socket closed'));
        return;
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== waiter);
        reject(new Error(`Timed out waiting for ${label}`));
      }, this.timeoutMs);
      const waiter: Waiter<T> = {
        accept,
        resolve: v => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: e => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.waiters.push(waiter as Waiter<unknown>);
    });
  }

  private sendFrame(type: string, data: Record<string, unknown>): void {
    if (!this.usable()) throw new Error('Socket is not open');
    this.socket.send(JSON.stringify({ type, data }));
  }

  async subscribe(conversationId: string): Promise<void> {
    // Send before registering the waiter: a throwing send leaves nothing orphaned,
    // and the reply cannot arrive before this synchronous block finishes.
    this.sendFrame('subscribe_dm', { conversation_id: conversationId });
    await this.wait(
      f =>
        f.type === 'dm_subscribed' && f.data.conversation_id === conversationId
          ? true
          : undefined,
      'dm_subscribed',
    );
  }

  /** Sends ciphertext and resolves with the server-assigned message id. */
  async send(
    conversationId: string,
    ciphertext: string,
    keyVersion: number,
    nonce: string,
  ): Promise<string> {
    this.sendFrame('dm_message', {
      conversation_id: conversationId,
      content: ciphertext,
      key_version: keyVersion,
      nonce,
    });
    return this.wait(
      f =>
        f.type === 'dm_message_ack' &&
        f.data.nonce === nonce &&
        typeof f.data.id === 'string'
          ? f.data.id
          : undefined,
      'dm_message_ack',
    );
  }

  nextMessage(conversationId: string, fromUserId: string): Promise<DmMessage> {
    return this.wait(f => {
      const message = dmMessage(f);
      return message &&
        message.conversationId === conversationId &&
        message.userId === fromUserId
        ? message
        : undefined;
    }, 'dm_message');
  }

  close(): void {
    this.dropped = false;
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    this.failAll(new Error('Socket closed'));
    this.socket.close();
  }
}
