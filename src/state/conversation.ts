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
  /** Called after every change to lines. */
  onChange: (() => void) | null = null;
  private readonly keys = new Map<number, Promise<KeyHandle>>();
  private current: number | null = null;
  private socket: DmSocket | null = null;
  private closed = false;

  constructor(
    private readonly api: ConcordApi,
    private readonly identity: KeyHandle,
    readonly id: string,
    private readonly me: string,
    private readonly openSocket: (url: string) => Promise<DmSocket> = url =>
      DmSocket.open(url, createSocket),
  ) {}

  /** The key for an epoch, fetched and unwrapped once. */
  private keyFor(version: number): Promise<KeyHandle> {
    let key = this.keys.get(version);
    if (!key) {
      key = this.api
        .dmKey(this.id, version)
        .then(k => unwrapChannelKey(k.wrappedKey, this.identity));
      // A failed fetch is not cached, so the next message tries again.
      key.catch(() => this.keys.delete(version));
      this.keys.set(version, key);
    }
    return key;
  }

  private async decrypt(
    m: Pick<DmEncrypted, 'id' | 'userId' | 'content' | 'keyVersion'> & {
      sender?: string;
    },
  ): Promise<ChatLine> {
    const base = { id: m.id, userId: m.userId, sender: m.sender ?? '' };
    try {
      const plain = await decryptMessage(
        m.content,
        await this.keyFor(m.keyVersion),
      );
      return { ...base, text: messageText(plain) };
    } catch {
      return { ...base, text: UNREADABLE, unreadable: true };
    }
  }

  private add(line: ChatLine): void {
    if (this.closed || this.lines.some(l => l.id === line.id)) return;
    this.lines = [...this.lines, line];
    this.onChange?.();
  }

  /** Loads and decrypts the newest page, then follows new messages live. */
  async start(): Promise<void> {
    const history = await this.api.dmHistory(this.id);
    const lines = await Promise.all(history.map(m => this.decrypt(m)));
    if (this.closed) return;
    // Live messages may have arrived meanwhile; history goes before them.
    const seen = new Set(lines.map(l => l.id));
    this.lines = [...lines, ...this.lines.filter(l => !seen.has(l.id))];
    this.onChange?.();
    this.api.markDmRead(this.id).catch(() => {});

    const socket = await this.openSocket(
      this.api.wsUrl(await this.api.wsTicket()),
    );
    if (this.closed) return socket.close();
    this.socket = socket;
    socket.onMessage = (m: DmMessage) => {
      if (m.conversationId !== this.id) return;
      // A peer already on a newer epoch means the key rotated: send under it too.
      if (this.current !== null && m.keyVersion > this.current)
        this.current = m.keyVersion;
      this.decrypt(m).then(line => this.add(line));
    };
    // ponytail: no reconnect; a dropped socket fails the next send and reopening the conversation reconnects.
    await socket.subscribe(this.id);
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
    this.add({ id, userId: this.me, sender: 'You', text });
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
