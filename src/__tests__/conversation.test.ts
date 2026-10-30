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
    row('m1', '2:garbage', 1),
    row('m2', `2:${JSON.stringify({ text: 'look', gif_slug: 'g' })}`, 2),
    row('m3', `2:${JSON.stringify({ text: '', gif_slug: 'g' })}`, 2),
    row('m4', '2:{"just":"json"}', 2),
  ]);
  await conv.start();
  expect(conv.lines.map(l => [l.text, !!l.unreadable])).toEqual([
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
