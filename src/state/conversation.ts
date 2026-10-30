import {
  decryptMessage,
  encryptMessage,
  type KeyHandle,
  releaseKey,
  unwrapChannelKey,
} from '../ConcordCrypto';
import type { ConcordApi, DmEncrypted } from '../core/ConcordApi';
import { DmSocket, type DmMessage } from '../core/DmSocket';
import { createSocket } from '../core/socket';

/** One decrypted line of a conversation. */
export type ChatLine = {
  id: string;
  userId: string;
  sender: string;
  text: string;
  /** True when the message could not be decrypted; text then says so. */
  unreadable?: boolean;
};

const UNREADABLE = 'This message could not be decrypted.';
const NO_KEY =
  'The key for this message could not be loaded. Reopen the conversation to retry.';
/** How long a refused epoch is not asked for again: labels are the sender's choice. */
const REFUSED_MS = 30_000;

/** The key could not be fetched or unwrapped, as opposed to a message that will not decrypt. */
class KeyUnavailable extends Error {}

/** Desktop wraps a message with a GIF as {"text", "gif_slug"} before encrypting it. */
function messageText(plaintext: string): string {
  if (!plaintext.startsWith('{')) return plaintext;
  try {
    const v = JSON.parse(plaintext) as { text?: unknown; gif_slug?: unknown };
    if (typeof v.gif_slug === 'string' && typeof v.text === 'string')
      return v.text || 'GIF';
  } catch {
    // Not an envelope: plain text that starts with a brace.
  }
  return plaintext;
}

// ponytail: Math.random is enough here; the nonce only pairs a send with its ack and is no secret.
function randomNonce(): string {
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0'),
  ).join('');
}

/**
 * One open DM conversation: decrypted history, live messages and sending. Keys stay
 * native; this holds only handles, released on close.
 */
export class Conversation {
  lines: ChatLine[] = [];
  /** The socket dropped: nothing new arrives until the conversation is reopened. */
  dropped = false;
  /** Called after every change to lines. */
  onChange: (() => void) | null = null;
  private readonly keys = new Map<number, Promise<KeyHandle>>();
  /** Epochs whose fetch failed, by when: not asked for again until REFUSED_MS passes. */
  private readonly refused = new Map<number, number>();
  /** Highest epoch whose key unwrapped; live labels far beyond it are not fetched. */
  private confirmed = 0;
  private current: number | null = null;
  private socket: DmSocket | null = null;
  private closed = false;
  /** Live messages decrypt one at a time, so a slow key lookup cannot reorder them. */
  private live: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: ConcordApi,
    private readonly identity: KeyHandle,
    readonly id: string,
    private readonly me: string,
    private readonly openSocket: (url: string) => Promise<DmSocket> = url =>
      DmSocket.open(url, createSocket),
  ) {}

  /** The key for an epoch (0: the current one), fetched and unwrapped once. */
  private keyFor(version: number): Promise<KeyHandle> {
    if (this.closed) return Promise.reject(new Error('Conversation closed'));
    let key = this.keys.get(version);
    if (key) return key;
    const failedAt = this.refused.get(version);
    if (failedAt !== undefined && Date.now() - failedAt < REFUSED_MS)
      return Promise.reject(new KeyUnavailable());
    key = this.api.dmKey(this.id, version || undefined).then(
      async k => {
        if (this.closed) throw new Error('Conversation closed');
        // The server is authoritative: a key served for another epoch must not be used under this label.
        if (version && k.keyVersion !== version) throw new KeyUnavailable();
        const handle = await unwrapChannelKey(k.wrappedKey, this.identity);
        // Closed while unwrapping: close() could not see this handle, so release it here.
        if (this.closed) {
          await releaseKey(handle).catch(() => {});
          throw new Error('Conversation closed');
        }
        this.confirmed = Math.max(this.confirmed, k.keyVersion);
        return handle;
      },
      () => {
        throw new KeyUnavailable();
      },
    );
    // A failed fetch is not cached, but is not retried for a while either.
    key.catch(() => {
      this.keys.delete(version);
      this.refused.set(version, Date.now());
    });
    this.keys.set(version, key);
    return key;
  }

  private async decrypt(
    m: Pick<DmEncrypted, 'id' | 'userId' | 'content' | 'keyVersion'> & {
      sender?: string;
    },
  ): Promise<ChatLine> {
    const base = { id: m.id, userId: m.userId, sender: m.sender ?? '' };
    const open = async (version: number) =>
      messageText(await decryptMessage(m.content, await this.keyFor(version)));
    try {
      return { ...base, text: await open(m.keyVersion) };
    } catch (error) {
      // Older clients labelled every write 1 whatever key they used: try the current key too.
      if (m.keyVersion === 1) {
        try {
          return { ...base, text: await open(0) };
        } catch {
          // Report the labelled epoch's failure below.
        }
      }
      const text = error instanceof KeyUnavailable ? NO_KEY : UNREADABLE;
      return { ...base, text, unreadable: true };
    }
  }

  private unreadable(m: DmMessage): ChatLine {
    return {
      id: m.id,
      userId: m.userId,
      sender: m.sender ?? '',
      text: UNREADABLE,
      unreadable: true,
    };
  }

  private add(line: ChatLine): void {
    if (this.closed || this.lines.some(l => l.id === line.id)) return;
    this.lines = [...this.lines, line];
    this.onChange?.();
  }

  /**
   * Subscribes first, buffering live messages, then loads and decrypts the newest page,
   * so nothing sent in between is missed. History and live lines merge by id.
   */
  async start(): Promise<void> {
    const socket = await this.openSocket(
      this.api.wsUrl(await this.api.wsTicket()),
    );
    if (this.closed) return socket.close();
    this.socket = socket;
    socket.onDropped = () => {
      if (this.closed) return;
      this.dropped = true;
      this.onChange?.();
    };
    socket.onMessage = (m: DmMessage) => {
      if (m.conversationId !== this.id) return;
      this.live = this.live
        .then(() =>
          // A label far past any epoch seen is not worth a fetch (and a key handle).
          this.confirmed && m.keyVersion > this.confirmed + 1
            ? this.unreadable(m)
            : this.decrypt(m),
        )
        .then(line => {
          this.add(line);
          if (line.unreadable || this.closed) return;
          // A peer proven on a newer epoch means the key rotated: send under it too.
          if (this.current !== null && m.keyVersion > this.current)
            this.current = m.keyVersion;
          // Shown while open, so it is read; the list's unread badge follows.
          if (m.userId !== this.me)
            this.api.markDmRead(this.id).catch(() => {});
        });
    };
    // ponytail: no reconnect; a dropped socket fails the next send and reopening the conversation reconnects.
    await socket.subscribe(this.id);

    const history = await this.api.dmHistory(this.id);
    if (this.closed) return;
    const lines = await Promise.all(history.map(m => this.decrypt(m)));
    if (this.closed) return;
    // Live messages may have arrived meanwhile. Those that arrived before the last one the
    // page also holds are older than the page's end and go before it; the rest after it.
    const seen = new Set(lines.map(l => l.id));
    let split = this.lines.length;
    while (split > 0 && !seen.has(this.lines[split - 1].id)) split--;
    const older = this.lines.slice(0, split).filter(l => !seen.has(l.id));
    const newer = this.lines.slice(split);
    this.lines = [...older, ...lines, ...newer];
    this.onChange?.();
    this.api.markDmRead(this.id).catch(() => {});
  }

  /** Encrypts under the current key and sends; resolves once the server stores it. */
  async send(text: string): Promise<void> {
    const socket = this.socket;
    if (!socket) throw new Error('Not connected');
    // ponytail: one extra key request per conversation; keyFor fetches the wrap by version.
    if (this.current === null)
      this.current = (await this.api.dmKey(this.id)).keyVersion;
    const version = this.current;
    let id: string;
    try {
      const ciphertext = await encryptMessage(text, await this.keyFor(version));
      id = await socket.send(this.id, ciphertext, version, randomNonce());
    } catch (error) {
      // Perhaps a rotated key: look the current epoch up again next time.
      this.current = null;
      throw error;
    }
    // Queued behind live messages still decrypting, so an earlier arrival stays above it.
    const line = { id, userId: this.me, sender: 'You', text };
    this.live = this.live.then(() => this.add(line));
    await this.live;
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
    const keys = [...this.keys.values()];
    this.keys.clear();
    keys.forEach(k => k.then(releaseKey).catch(() => {}));
  }
}
