import type { ConcordApi } from '../core/ConcordApi';
import type { DmMessage, DmSocket } from '../core/DmSocket';
import { Conversation } from '../state/conversation';
import type { KeyHandle } from '../ConcordCrypto';

// Fake crypto: a key handle is "K<version>", ciphertext is "<version>:<plaintext>".
jest.mock('../ConcordCrypto', () => ({
  unwrapChannelKey: jest.fn(async (wrapped: string) => `K${wrapped}`),
  decryptMessage: jest.fn(async (ct: string, key: string) => {
    const [v, ...rest] = ct.split(':');
    if (`Kw${v}` !== key) throw new Error('auth');
    return rest.join(':');
  }),
  encryptMessage: jest.fn(
    async (pt: string, key: string) => `${key.slice(2)}:${pt}`,
  ),
  releaseKey: jest.fn(async () => {}),
}));
const crypto = jest.requireMock('../ConcordCrypto') as Record<
  string,
  jest.Mock
>;

const ME = 'me';
const PEER = 'peer';
const row = (id: string, content: string, keyVersion = 1, userId = PEER) => ({
  id,
  userId,
  sender: 'Peer',
  content,
  keyVersion,
  createdAt: 't',
});

function setup(history = [row('m1', '1:hi'), row('m2', '2:rotated', 2)]) {
  const api = {
    dmHistory: jest.fn(async () => history),
    dmKey: jest.fn(async (_id: string, version?: number) => ({
      wrappedKey: `w${version ?? 2}`,
      keyVersion: version ?? 2,
    })),
    markDmRead: jest.fn(async () => {}),
    wsTicket: jest.fn(async () => 'tkt'),
    wsUrl: (t: string) => `wss://x/ws?ticket=${t}`,
  };
  const socket = {
    onMessage: null as ((m: DmMessage) => void) | null,
    onDropped: null as (() => void) | null,
    subscribe: jest.fn(async () => {}),
    send: jest.fn(async () => 'sent-1'),
    close: jest.fn(),
  };
  const openSocket = jest.fn(async () => socket as unknown as DmSocket);
  const conv = new Conversation(
    api as unknown as ConcordApi,
    'ID' as KeyHandle,
    'c1',
    ME,
    openSocket,
  );
  const changes = jest.fn();
  conv.onChange = changes;
  return { api, socket, openSocket, conv, changes };
}

const flush = () => new Promise(setImmediate);

beforeEach(() => jest.clearAllMocks());

test('decrypts history under each message epoch and follows live', async () => {
  const { api, socket, openSocket, conv, changes } = setup();
  await conv.start();
  expect(conv.lines.map(l => l.text)).toEqual(['hi', 'rotated']);
  expect(api.dmKey).toHaveBeenCalledWith('c1', 1);
  expect(api.dmKey).toHaveBeenCalledWith('c1', 2);
  expect(crypto.unwrapChannelKey).toHaveBeenCalledWith('w1', 'ID');
  expect(api.markDmRead).toHaveBeenCalledWith('c1');
  expect(openSocket).toHaveBeenCalledWith('wss://x/ws?ticket=tkt');
  expect(socket.subscribe).toHaveBeenCalledWith('c1');

  socket.onMessage?.({
    id: 'm3',
    conversationId: 'c1',
    userId: PEER,
    content: '1:again',
    keyVersion: 1,
  });
  socket.onMessage?.({
    id: 'x',
    conversationId: 'other',
    userId: PEER,
    content: '1:no',
    keyVersion: 1,
  });
  await flush();
  expect(conv.lines.map(l => l.text)).toEqual(['hi', 'rotated', 'again']);
  // One key fetch per epoch, however many messages use it.
  expect(api.dmKey).toHaveBeenCalledTimes(2);
  expect(changes).toHaveBeenCalled();
});

test('marks what it cannot decrypt and unwraps GIF envelopes', async () => {
  const { conv } = setup([
    row('m0', '2:legacy', 1),
    row('m1', '3:garbage', 2),
    row('m2', `2:${JSON.stringify({ text: 'look', gif_slug: 'g' })}`, 2),
    row('m3', `2:${JSON.stringify({ text: '', gif_slug: 'g' })}`, 2),
    row('m4', '2:{"just":"json"}', 2),
  ]);
  await conv.start();
  expect(conv.lines.map(l => [l.text, !!l.unreadable])).toEqual([
    // Older clients labelled every write 1: the current key opens it.
    ['legacy', false],
    ['This message could not be decrypted.', true],
    ['look', false],
    ['GIF', false],
    ['{"just":"json"}', false],
  ]);
});

test('sends under the current epoch and shows the stored message once', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  await conv.send('hello');
  expect(api.dmKey).toHaveBeenCalledWith('c1');
  expect(socket.send).toHaveBeenCalledWith(
    'c1',
    '2:hello',
    2,
    expect.stringMatching(/^[0-9a-f]{32}$/),
  );
  // The server's echo of the same message is not shown twice.
  socket.onMessage?.({
    id: 'sent-1',
    conversationId: 'c1',
    userId: ME,
    content: '2:hello',
    keyVersion: 2,
  });
  await flush();
  expect(conv.lines).toEqual([
    { id: 'sent-1', userId: ME, sender: 'You', text: 'hello' },
  ]);
  // Our own echo is not a read receipt; start() sent the only one.
  expect(api.markDmRead).toHaveBeenCalledTimes(1);
});

test('moves to a newer epoch a peer uses and retries the lookup after a failure', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  await conv.send('a');
  socket.onMessage?.({
    id: 'p',
    conversationId: 'c1',
    userId: PEER,
    content: '3:new',
    keyVersion: 3,
  });
  await flush();
  await conv.send('b');
  expect(socket.send).toHaveBeenLastCalledWith(
    'c1',
    '3:b',
    3,
    expect.any(String),
  );

  socket.send.mockRejectedValueOnce(new Error('stale epoch'));
  await expect(conv.send('c')).rejects.toThrow('stale epoch');
  api.dmKey.mockClear();
  await conv.send('d');
  expect(api.dmKey).toHaveBeenCalledWith('c1');
});

test('refuses to send before connecting and releases keys on close', async () => {
  const { socket, conv } = setup();
  await expect(conv.send('x')).rejects.toThrow('Not connected');
  await conv.start();
  conv.close();
  await flush();
  expect(socket.close).toHaveBeenCalled();
  expect(crypto.releaseKey).toHaveBeenCalledWith('Kw1');
  expect(crypto.releaseKey).toHaveBeenCalledWith('Kw2');
  // Nothing arrives after close.
  socket.onMessage?.({
    id: 'late',
    conversationId: 'c1',
    userId: PEER,
    content: '1:late',
    keyVersion: 1,
  });
  await flush();
  expect(conv.lines.map(l => l.id)).toEqual(['m1', 'm2']);
});

test('closes a socket that opens after the conversation closed', async () => {
  const { socket, conv, openSocket } = setup();
  let release!: () => void;
  openSocket.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = () => resolve(socket as unknown as DmSocket);
      }),
  );
  const starting = conv.start();
  await flush();
  conv.close();
  release();
  await starting;
  expect(socket.close).toHaveBeenCalled();
  expect(socket.subscribe).not.toHaveBeenCalled();
});

test('subscribes before reading history, so a message sent in between is kept', async () => {
  const { api, socket, conv } = setup([row('m1', '1:hi')]);
  const order: string[] = [];
  socket.subscribe.mockImplementationOnce(async () => {
    order.push('subscribe');
  });
  api.dmHistory.mockImplementationOnce(async () => {
    order.push('history');
    // Arrives after the subscription, before the history page is decrypted.
    socket.onMessage?.({
      id: 'm2',
      conversationId: 'c1',
      userId: PEER,
      content: '1:between',
      keyVersion: 1,
    });
    return [row('m1', '1:hi')];
  });
  await conv.start();
  await flush();
  expect(order).toEqual(['subscribe', 'history']);
  expect(conv.lines.map(l => l.text)).toEqual(['hi', 'between']);
});

test('allocates no key after close, even mid-fetch', async () => {
  const { api, conv } = setup();
  let resolveKey!: (k: { wrappedKey: string; keyVersion: number }) => void;
  api.dmKey.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveKey = resolve;
      }),
  );
  const starting = conv.start();
  await flush();
  conv.close();
  resolveKey({ wrappedKey: 'w1', keyVersion: 1 });
  await starting;
  await flush();
  // Epoch 1's wrap arrived after close and was never unwrapped; epoch 2's, unwrapped
  // before close, was released by it.
  expect(crypto.unwrapChannelKey).not.toHaveBeenCalledWith('w1', 'ID');
  expect(crypto.releaseKey).toHaveBeenCalledWith('Kw2');

  // A key whose unwrap finishes after close is released at once.
  const late = setup();
  let finishUnwrap!: (h: string) => void;
  crypto.unwrapChannelKey.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishUnwrap = resolve;
      }),
  );
  const lateStart = late.conv.start();
  await flush();
  late.conv.close();
  finishUnwrap('Kw1');
  await lateStart;
  await flush();
  expect(crypto.releaseKey).toHaveBeenCalledWith('Kw1');
});

test('keeps live arrival order across a slow key lookup and marks them read', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  api.markDmRead.mockClear();
  let releaseKey3!: () => void;
  api.dmKey.mockImplementationOnce(
    (_id: string, version?: number) =>
      new Promise(resolve => {
        releaseKey3 = () =>
          resolve({ wrappedKey: `w${version}`, keyVersion: version as number });
      }),
  );
  socket.onMessage?.({
    id: 'a',
    conversationId: 'c1',
    userId: PEER,
    content: '3:first',
    keyVersion: 3,
  });
  socket.onMessage?.({
    id: 'b',
    conversationId: 'c1',
    userId: PEER,
    content: '2:second',
    keyVersion: 2,
  });
  await flush();
  releaseKey3();
  await flush();
  await flush();
  expect(conv.lines.map(l => l.text)).toEqual(['first', 'second']);
  // Both arrived together, so one receipt covers them.
  expect(api.markDmRead).toHaveBeenCalledTimes(1);
});

test('keeps an acknowledged send below an earlier message still decrypting', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  let releaseKey1!: () => void;
  api.dmKey.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        releaseKey1 = () => resolve({ wrappedKey: 'w1', keyVersion: 1 });
      }),
  );
  socket.onMessage?.({
    id: 'early',
    conversationId: 'c1',
    userId: PEER,
    content: '1:earlier',
    keyVersion: 1,
  });
  await flush();
  const sending = conv.send('later');
  await flush();
  releaseKey1();
  await sending;
  expect(conv.lines.map(l => l.text)).toEqual(['earlier', 'later']);
});

const live = (id: string, content: string, keyVersion: number): DmMessage => ({
  id,
  conversationId: 'c1',
  userId: PEER,
  content,
  keyVersion,
});

test('backs off a refused epoch, then fetches it again', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  api.dmKey.mockRejectedValueOnce(new Error('404'));
  socket.onMessage?.(live('a', '2:one', 2));
  socket.onMessage?.(live('b', '2:two', 2));
  await flush();
  expect(conv.lines.map(l => [l.text, !!l.unreadable])).toEqual([
    [expect.stringMatching(/could not be loaded/), true],
    [expect.stringMatching(/could not be loaded/), true],
  ]);
  // Refused once: the second message did not ask again.
  expect(api.dmKey).toHaveBeenCalledTimes(1);
  now.mockReturnValue(40_000);
  socket.onMessage?.(live('c', '2:three', 2));
  await flush();
  expect(conv.lines.at(-1)?.text).toBe('three');
  expect(api.dmKey).toHaveBeenCalledTimes(2);
  expect(api.dmKey).toHaveBeenLastCalledWith('c1', 2);
  now.mockRestore();
});

test('refuses a key the server serves for another epoch', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  api.dmKey.mockResolvedValueOnce({ wrappedKey: 'w9', keyVersion: 9 });
  socket.onMessage?.(live('a', '3:x', 3));
  await flush();
  expect(conv.lines[0].unreadable).toBe(true);
  expect(crypto.unwrapChannelKey).not.toHaveBeenCalled();
});

test('moves epochs only on a message that decrypts, and skips far-off labels', async () => {
  const { api, socket, conv } = setup([row('m1', '2:hi', 2)]);
  await conv.start();
  await conv.send('a');
  api.dmKey.mockClear();
  api.markDmRead.mockClear();
  // Within one of the epoch seen: fetched, but it does not decrypt.
  socket.onMessage?.(live('x', '2:forged', 3));
  // Far past it: not even fetched.
  socket.onMessage?.(live('y', '9:far', 9));
  await flush();
  expect(conv.lines.slice(-2).map(l => l.unreadable)).toEqual([true, true]);
  expect(api.dmKey).toHaveBeenCalledTimes(1);
  expect(api.dmKey).toHaveBeenCalledWith('c1', 3);
  // No read receipt for what could not be shown, and sends stay on epoch 2.
  expect(api.markDmRead).not.toHaveBeenCalled();
  await conv.send('b');
  expect(socket.send).toHaveBeenLastCalledWith(
    'c1',
    '2:b',
    2,
    expect.any(String),
  );
});

test('opens an unlabelled row with the current key', async () => {
  const { api, conv } = setup([row('m1', '2:old', 0)]);
  await conv.start();
  expect(conv.lines[0].text).toBe('old');
  expect(api.dmKey).toHaveBeenCalledWith('c1');
});

test('puts live messages older than the history page before it', async () => {
  const { api, socket, conv } = setup([]);
  api.dmHistory.mockImplementationOnce(async () => {
    for (const id of ['a', 'b', 'c', 'd'])
      socket.onMessage?.(live(id, `1:${id}`, 1));
    await flush();
    // The page already ends at c; a fell off its start and d came after it.
    return [row('b', '1:b'), row('c', '1:c')];
  });
  await conv.start();
  await flush();
  expect(conv.lines.map(l => l.id)).toEqual(['a', 'b', 'c', 'd']);
});

test('shows a dropped socket until reopened', async () => {
  const { socket, conv, changes } = setup([]);
  await conv.start();
  changes.mockClear();
  socket.onDropped?.();
  expect(conv.dropped).toBe(true);
  expect(changes).toHaveBeenCalled();
});

test('follows the newest proven epoch for unlabelled and legacy rows', async () => {
  const { api, socket, conv } = setup([row('m1', '2:old', 0)]);
  await conv.start();
  // The current key is proven as epoch 2; a peer then proves epoch 3.
  socket.onMessage?.(live('a', '3:new', 3));
  // A legacy row labelled 1 but written under epoch 3 opens with the newest key.
  socket.onMessage?.(live('b', '3:legacy', 1));
  await flush();
  expect(conv.lines.map(l => l.text)).toEqual(['old', 'new', 'legacy']);
  // Current (no version), then 2, 3 and 1 by version; the fallback reuses 3.
  expect(api.dmKey).toHaveBeenCalledTimes(4);
});

test('sends no startup read receipt when the newest line is unreadable', async () => {
  const { api, conv } = setup([row('m1', '1:hi'), row('m2', '9:bad', 2)]);
  await conv.start();
  expect(conv.lines.at(-1)?.unreadable).toBe(true);
  expect(api.markDmRead).not.toHaveBeenCalled();
});

test('asks the server for the current epoch when only an old key is proven', async () => {
  // Labelled 1 but written under the current epoch 2; the epoch-1 key unwraps fine.
  const { api, conv } = setup([row('m1', '2:legacy', 1)]);
  await conv.start();
  expect(conv.lines[0].text).toBe('legacy');
  expect(api.dmKey).toHaveBeenCalledWith('c1');
});

test('looks the current epoch up again when a legacy fallback stops working', async () => {
  const { api, socket, conv } = setup([row('m1', '2:old', 1)]);
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  await conv.start();
  expect(conv.lines[0].text).toBe('old');
  // The server rotates to 3; a legacy peer still labels its writes 1.
  api.dmKey.mockImplementation(async (_id: string, version?: number) => ({
    wrappedKey: `w${version ?? 3}`,
    keyVersion: version ?? 3,
  }));
  socket.onMessage?.(live('a', '3:soon', 1));
  await flush();
  // Within the back-off: no new lookup, so it stays unreadable.
  expect(conv.lines[1].unreadable).toBe(true);
  now.mockReturnValue(40_000);
  socket.onMessage?.(live('b', '3:later', 1));
  await flush();
  expect(conv.lines[2].text).toBe('later');
  now.mockRestore();
});

test('waits for live messages still decrypting before the startup read receipt', async () => {
  const { api, socket, conv } = setup([row('m1', '1:hi')]);
  let release!: () => void;
  api.dmHistory.mockImplementationOnce(async () => {
    // A newer live message whose key arrives late and then fails.
    api.dmKey.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          release = () => reject(new Error('404'));
        }),
    );
    socket.onMessage?.(live('m2', '5:late', 5));
    return [row('m1', '1:hi')];
  });
  const starting = conv.start();
  await flush();
  release();
  await starting;
  expect(conv.lines.at(-1)?.unreadable).toBe(true);
  expect(api.markDmRead).not.toHaveBeenCalled();
});

test('sends a live read receipt only once queued messages settle', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  api.markDmRead.mockClear();
  let release!: () => void;
  api.dmKey.mockImplementationOnce(async () => ({
    wrappedKey: 'w1',
    keyVersion: 1,
  }));
  api.dmKey.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        release = () => reject(new Error('404'));
      }),
  );
  socket.onMessage?.(live('a', '1:first', 1));
  socket.onMessage?.(live('b', '2:second', 2));
  await flush();
  // The first is shown, but the second is still pending: no receipt yet.
  expect(conv.lines.map(l => l.id)).toEqual(['a']);
  expect(api.markDmRead).not.toHaveBeenCalled();
  release();
  await flush();
  expect(conv.lines[1].unreadable).toBe(true);
  expect(api.markDmRead).not.toHaveBeenCalled();
  socket.onMessage?.(live('c', '1:third', 1));
  await flush();
  expect(api.markDmRead).toHaveBeenCalledTimes(1);
});

test('flushes a pending read receipt after a queued send', async () => {
  const { api, socket, conv } = setup([]);
  await conv.start();
  api.markDmRead.mockClear();
  let release!: () => void;
  api.dmKey.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = () => resolve({ wrappedKey: 'w1', keyVersion: 1 });
      }),
  );
  socket.onMessage?.(live('in', '1:incoming', 1));
  await flush();
  const sending = conv.send('reply');
  await flush();
  release();
  await sending;
  expect(conv.lines.map(l => l.id)).toEqual(['in', 'sent-1']);
  expect(api.markDmRead).toHaveBeenCalledTimes(1);
});
