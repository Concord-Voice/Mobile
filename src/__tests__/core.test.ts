import {
  ApiError,
  ConcordApi,
  checkBaseUrl,
  clientVersion,
} from '../core/ConcordApi';
import { DmSocket, type SocketLike } from '../core/DmSocket';
import { MOBILE_ORIGIN, createSocket } from '../core/socket';

const ME = 'user-mobile';
const PEER = 'user-peer';
const CONV = 'conv-1';
const MACHINE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

type Route = (body: Record<string, unknown> | undefined) => [number, unknown];

function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{
    key: string;
    headers: Record<string, string>;
    credentials?: string;
    body?: Record<string, unknown>;
  }> = [];
  const impl = jest.fn(
    async (
      url: string,
      init: {
        method: string;
        headers: Record<string, string>;
        credentials?: string;
        body?: string;
      },
    ) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
      const key = `${init.method} ${path}`;
      const body = init.body
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
      calls.push({
        key,
        headers: init.headers,
        credentials: init.credentials,
        body,
      });
      const route = routes[key];
      const [status, json] = route ? route(body) : [404, { code: 'not_found' }];
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
      } as Response;
    },
  );
  return { impl: impl as unknown as typeof fetch, calls };
}

class FakeSocket implements SocketLike {
  sent: Array<{ type: string; data: Record<string, unknown> }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(
    private readonly respond: (
      frame: { type: string; data: Record<string, unknown> },
      socket: FakeSocket,
    ) => void,
    autoOpen = true,
  ) {
    if (autoOpen) setTimeout(() => this.onopen?.(), 0);
  }
  send(raw: string) {
    // Like a real WebSocket, sending on a closed socket throws.
    if (this.closed) throw new Error('Socket is not open');
    const frame = JSON.parse(raw);
    this.sent.push(frame);
    setTimeout(() => this.respond(frame, this), 0);
  }
  emit(type: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }
  close() {
    this.closed = true;
  }
}

describe('ConcordApi', () => {
  it('signs up, logs in and distributes a DM key with recipient versions', async () => {
    const { impl, calls } = fakeFetch({
      'POST /auth/register': () => [201, { pending_id: 'pending-1' }],
      'POST /auth/register/confirm': () => [
        200,
        {
          access_token: 'a1',
          refresh_token: 'r1',
          session_id: 's1',
          user: { id: ME },
        },
      ],
      'POST /auth/login': () => [
        200,
        {
          access_token: 'a2',
          refresh_token: 'r2',
          session_id: 's2',
          user: { id: ME },
          e2ee_keys: {
            wrapped_private_key: 'V1JBUA==', // pragma: allowlist secret
            key_derivation_salt: 'U0FMVA==',
            key_derivation_alg: 'argon2id',
          },
        },
      ],
      'GET /users/search?q=peer': () => [
        200,
        { users: [{ id: PEER, username: 'peer' }] },
      ],
      'POST /dm/conversations': () => [201, { conversation: { id: CONV } }],
      'GET /users/user-peer/public-key': () => [
        200,
        { public_key: 'UEs=', key_version: 3 },
      ],
      'POST /e2ee/keys/conv-1': () => [200, {}],
      'GET /dm/conversations/conv-1/messages': () => [
        200,
        { messages: [{ id: 'm1' }] },
      ],
      'POST /auth/ws-ticket': () => [200, { ticket: 'tkt' }],
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, impl);
    const pending = await api.register({
      email: 'm@example.test',
      username: 'mobile',
      password: 'synthetic-pass', // pragma: allowlist secret
      publicKey: 'UEs=',
      wrappedPrivateKey: 'V1JBUA==', // pragma: allowlist secret
      keyDerivationSalt: 'U0FMVA==',
    });
    await api.confirm(pending, '123456');
    expect(api.userId).toBe(ME);
    expect(await api.login('m@example.test', 'synthetic-pass')).toEqual({
      kind: 'signed_in',
      keys: {
        wrappedPrivateKey: 'V1JBUA==', // pragma: allowlist secret
        keyDerivationSalt: 'U0FMVA==',
        keyDerivationAlg: 'argon2id',
      },
    });
    expect(calls.find(c => c.key === 'POST /auth/login')?.body).toMatchObject({
      remember_me: true,
    });
    const peer = await api.findUserId('peer');
    const conv = await api.openDm(peer);
    expect(await api.publicKey(peer)).toEqual({
      publicKey: 'UEs=',
      keyVersion: 3,
    });
    await api.distributeDmKey(conv, { [peer]: 'd3JhcA==' }, { [peer]: 3 });
    expect(await api.dmMessages(conv)).toEqual([{ id: 'm1' }]);
    expect(await api.wsTicket()).toBe('tkt');

    expect(calls.find(c => c.key === 'POST /e2ee/keys/conv-1')?.body).toEqual({
      wrapped_keys: { [PEER]: 'd3JhcA==' },
      wrapped_key_versions: { [PEER]: 3 },
    });
    expect(calls.every(c => c.headers['X-Machine-Id'] === MACHINE)).toBe(true);
    expect(calls.every(c => c.credentials === 'omit')).toBe(true);
    expect(
      calls.find(c => c.key === 'POST /auth/ws-ticket')?.headers.Authorization,
    ).toBe('Bearer a2');
  });

  it('completes an MFA login with an emailed code', async () => {
    const { impl, calls } = fakeFetch({
      'POST /auth/login': () => [
        200,
        {
          mfa_required: true,
          mfa_challenge_token: 'chal',
          methods: ['totp', 'email', 7],
        },
      ],
      'POST /auth/mfa/email/send': () => [200, {}],
      'POST /auth/mfa/verify': body =>
        body?.code === '424242'
          ? [
              200,
              {
                access_token: 'a1',
                refresh_token: 'r1',
                session_id: 's1',
                user: { id: ME },
                e2ee_keys: {
                  wrapped_private_key: 'V1JBUA==', // pragma: allowlist secret
                  key_derivation_salt: 'U0FMVA==',
                  key_derivation_alg: 'argon2id',
                },
              },
            ]
          : [401, { code: 'invalid_code' }],
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, impl);
    expect(await api.login('e', 'p')).toEqual({
      kind: 'mfa',
      challengeToken: 'chal',
      methods: ['totp', 'email'],
    });
    expect(() => api.userId).toThrow('Not signed in');
    await api.sendMfaEmail('chal');
    await expect(
      api.verifyMfa('chal', 'email', '000000'),
    ).rejects.toMatchObject({ status: 401 });
    const keys = await api.verifyMfa('chal', 'email', '424242');
    expect(keys.keyDerivationAlg).toBe('argon2id');
    expect(api.userId).toBe(ME);
    expect(calls.find(c => c.key === 'POST /auth/mfa/verify')?.body).toEqual({
      mfa_challenge_token: 'chal',
      method: 'email',
      code: '000000',
    });
  });

  it('refuses an invalid key version', async () => {
    const { impl } = fakeFetch({
      'GET /users/u/public-key': () => [
        200,
        { public_key: 'UEs=', key_version: 0 },
      ],
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, impl);
    await expect(api.publicKey('u')).rejects.toThrow('Invalid API response');
  });

  const signedIn = (routes: Record<string, Route>) => {
    const fake = fakeFetch({
      'POST /auth/login': () => [
        200,
        {
          access_token: 'a1',
          refresh_token: 'r1',
          session_id: 's1',
          user: { id: ME },
          e2ee_keys: {
            wrapped_private_key: 'V1JBUA==', // pragma: allowlist secret
            key_derivation_salt: 'U0FMVA==',
            key_derivation_alg: 'argon2id',
          },
        },
      ],
      ...routes,
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, fake.impl);
    return { api, ...fake };
  };

  it('summarises DM conversations for the list', async () => {
    const { api } = signedIn({
      'GET /dm/conversations': () => [
        200,
        {
          conversations: [
            {
              id: 'd1',
              created_at: 't0',
              unread_count: 3,
              participants: [
                { user_id: ME, username: 'me' },
                { user_id: PEER, username: 'peer', display_name: 'Peer P' },
              ],
              last_message: { created_at: 't1' },
            },
            {
              id: 'd2',
              name: 'Team',
              created_at: 't2',
              unread_count: 'x',
              participants: [],
            },
            {
              id: 'd3',
              created_at: 't3',
              participants: [{ user_id: ME, username: 'me' }],
            },
          ],
        },
      ],
    });
    await expect(api.conversations()).rejects.toThrow('Not signed in');
    await api.login('e', 'p');
    expect(await api.conversations()).toEqual([
      { id: 'd1', title: 'Peer P', unreadCount: 3, lastActivity: 't1' },
      { id: 'd2', title: 'Team', unreadCount: 0, lastActivity: 't2' },
      { id: 'd3', title: 'Notes to self', unreadCount: 0, lastActivity: 't3' },
    ]);
  });

  it('refreshes once on 401, shares the rotation and retries', async () => {
    let refreshes = 0;
    const { api, calls } = signedIn({
      'POST /auth/refresh': () => {
        refreshes += 1;
        return [
          200,
          { access_token: 'a2', refresh_token: 'r2', session_id: 's2' },
        ];
      },
      'POST /auth/ws-ticket': () =>
        calls.at(-1)?.headers.Authorization === 'Bearer a2'
          ? [200, { ticket: 'tkt' }]
          : [401, { code: 'token_expired' }],
    });
    await api.login('e', 'p');
    expect(await Promise.all([api.wsTicket(), api.wsTicket()])).toEqual([
      'tkt',
      'tkt',
    ]);
    expect(refreshes).toBe(1);
    const refresh = calls.find(c => c.key === 'POST /auth/refresh');
    expect(refresh?.headers['X-Refresh-Token']).toBe('r1');
    expect(api.userId).toBe(ME);
  });

  it('fetches DM keys and history for decryption', async () => {
    const { api, calls } = signedIn({
      'GET /e2ee/keys/c1': () => [
        200,
        { key: { wrapped_key: 'd3JhcA==', key_version: 4 } },
      ],
      'GET /e2ee/keys/c1?version=2': () => [
        200,
        { key: { wrapped_key: 'b2xk', key_version: 2 } },
      ],
      'GET /e2ee/keys/bad': () => [
        200,
        { key: { wrapped_key: 'x', key_version: 0 } },
      ],
      'GET /dm/conversations/c1/messages': () => [
        200,
        {
          messages: [
            {
              id: 'm3',
              user_id: ME,
              username: 'me',
              content: 'Yw==',
              type: 'text',
              key_version: 4,
              created_at: 't3',
            },
            {
              id: 'call',
              user_id: PEER,
              username: 'peer',
              content: '',
              type: 'call_event',
              key_version: 4,
              created_at: 't2',
            },
            {
              id: 'm1',
              user_id: PEER,
              username: 'peer',
              display_name: 'Peer P',
              content: 'Yg==',
              key_version: 2,
              created_at: 't1',
            },
            {
              id: 'm0',
              user_id: PEER,
              username: 'peer',
              display_name: '',
              content: 'YQ==',
              created_at: 't0',
            },
          ],
        },
      ],
      'POST /dm/conversations/c1/read': () => [200, {}],
    });
    await api.login('e', 'p');
    expect(await api.dmKey('c1')).toEqual({
      wrappedKey: 'd3JhcA==',
      keyVersion: 4,
    });
    expect(await api.dmKey('c1', 2)).toEqual({
      wrappedKey: 'b2xk',
      keyVersion: 2,
    });
    await expect(api.dmKey('bad')).rejects.toThrow('Invalid API response');
    // Oldest first, server-authored rows left out, an unlabelled row kept as epoch 0.
    expect(await api.dmHistory('c1')).toEqual([
      {
        id: 'm0',
        userId: PEER,
        sender: 'peer',
        content: 'YQ==',
        keyVersion: 0,
        createdAt: 't0',
      },
      {
        id: 'm1',
        userId: PEER,
        sender: 'Peer P',
        content: 'Yg==',
        keyVersion: 2,
        createdAt: 't1',
      },
      {
        id: 'm3',
        userId: ME,
        sender: 'me',
        content: 'Yw==',
        keyVersion: 4,
        createdAt: 't3',
      },
    ]);
    await api.markDmRead('c1');
    expect(calls.at(-1)?.key).toBe('POST /dm/conversations/c1/read');
  });

  it('reports every rotation and resumes a saved session', async () => {
    const { api } = signedIn({
      'POST /auth/refresh': () => [
        200,
        { access_token: 'a2', refresh_token: 'r2', session_id: 's1' },
      ],
    });
    expect(api.saved()).toBeNull();
    const rotated = jest.fn();
    api.onRotated = rotated;
    await api.login('e', 'p');
    await api.refresh();
    expect(rotated).toHaveBeenCalledTimes(2);
    const saved = api.saved();
    expect(saved).toEqual({
      refreshToken: 'r2',
      sessionId: 's1',
      userId: ME,
    });

    const { api: next, calls } = signedIn({
      'POST /auth/refresh': () => [
        200,
        { access_token: 'a3', refresh_token: 'r3', session_id: 's1' },
      ],
      'POST /auth/ws-ticket': () => [200, { ticket: 'tkt' }],
    });
    // A tampered record's extra fields are not picked up.
    await next.resume({
      ...(saved as NonNullable<typeof saved>),
      accessToken: 'INJECTED',
    } as NonNullable<typeof saved>);
    const refresh = calls.find(c => c.key === 'POST /auth/refresh');
    expect(refresh?.headers['X-Refresh-Token']).toBe('r2');
    // No access token yet, so none is sent.
    expect(refresh?.headers.Authorization).toBeUndefined();
    await next.wsTicket();
    expect(calls.at(-1)?.headers.Authorization).toBe('Bearer a3');
    expect(next.userId).toBe(ME);
  });

  it('keeps a resumed session through a network failure, not a refusal', async () => {
    const saved = { refreshToken: 'r1', sessionId: 's1', userId: ME };
    const offline = new ConcordApi(
      'https://api.example.test',
      MACHINE,
      (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
    );
    await offline.resume(saved);
    expect(offline.saved()).toEqual(saved);

    const { api } = signedIn({
      'POST /auth/refresh': () => [401, { code: 'invalid_refresh' }],
    });
    const expired = jest.fn();
    api.onExpired = expired;
    await expect(api.resume(saved)).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(api.saved()).toBeNull();
  });

  it('ends the session when the refresh token is refused', async () => {
    const { api } = signedIn({
      'POST /auth/refresh': () => [401, { code: 'invalid_refresh' }],
      'POST /auth/ws-ticket': () => [401, { code: 'token_expired' }],
    });
    await api.login('e', 'p');
    const expired = jest.fn();
    api.onExpired = expired;
    await expect(api.wsTicket()).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(() => api.userId).toThrow('Not signed in');
    await expect(api.refresh()).rejects.toThrow('Not signed in');
  });

  it('retries only once and never on credential routes', async () => {
    let tickets = 0;
    let refreshes = 0;
    const { api } = signedIn({
      'POST /auth/refresh': () => {
        refreshes += 1;
        return [
          200,
          { access_token: 'a2', refresh_token: 'r2', session_id: 's2' },
        ];
      },
      'POST /auth/ws-ticket': () => {
        tickets += 1;
        return [401, { code: 'token_expired' }];
      },
      'POST /auth/mfa/verify': () => [401, { code: 'invalid_code' }],
    });
    await api.login('e', 'p');
    await expect(api.wsTicket()).rejects.toMatchObject({ status: 401 });
    expect(tickets).toBe(2);
    await expect(api.verifyMfa('c', 'totp', '1')).rejects.toMatchObject({
      status: 401,
    });
    expect(refreshes).toBe(1);
    expect(api.userId).toBe(ME);
  });

  it('does not revive a session logged out during a rotation', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const { impl } = signedIn({
      'POST /auth/logout': () => [200, {}],
    });
    const slow = jest.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        await gate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'a2',
            refresh_token: 'r2',
            session_id: 's2',
          }),
        } as Response;
      }
      return impl(url, init);
    });
    const racing = new ConcordApi(
      'https://api.example.test',
      MACHINE,
      slow as unknown as typeof fetch,
    );
    await racing.login('e', 'p');
    const rotation = racing.refresh();
    await racing.logout();
    release();
    await rotation;
    expect(() => racing.userId).toThrow('Not signed in');
  });

  it('logs out with its refresh token and clears the session even on failure', async () => {
    const { api, calls } = signedIn({
      'POST /auth/logout': () => [500, {}],
    });
    await api.logout();
    await api.login('e', 'p');
    await expect(api.logout()).rejects.toMatchObject({ status: 500 });
    expect(() => api.userId).toThrow('Not signed in');
    const logout = calls.find(c => c.key === 'POST /auth/logout');
    expect(logout?.headers['X-Refresh-Token']).toBe('r1');
    expect(logout?.headers.Authorization).toBe('Bearer a1');
  });

  it('allows plain http only for localhost', () => {
    expect(checkBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(checkBaseUrl('https://api.example.test')).toBe(
      'https://api.example.test',
    );
    expect(() => checkBaseUrl('http://10.0.0.5:8080')).toThrow(
      'local dev stack',
    );
    expect(() => checkBaseUrl('ftp://x')).toThrow('Invalid');
    expect(() => checkBaseUrl('https://a@b')).toThrow('Invalid');
    expect(() => checkBaseUrl('https://evil.test?x')).toThrow('Invalid');
    expect(() => checkBaseUrl('http://localhost@evil.test')).toThrow('Invalid');
  });

  it('aborts a request that stalls past its deadline', async () => {
    const stalled = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    );
    const api = new ConcordApi(
      'http://localhost:8080',
      MACHINE,
      stalled as unknown as typeof fetch,
      10,
    );
    await expect(api.findUserId('anyone')).rejects.toThrow('timed out');
  });

  it('times out when headers arrive but the body stalls', async () => {
    const stalledBody = jest.fn(
      async (_url: string, init: { signal: AbortSignal }) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) =>
              init.signal.addEventListener('abort', () =>
                reject(new Error('aborted')),
              ),
            ),
        } as unknown as Response),
    );
    const api = new ConcordApi(
      'http://localhost:8080',
      MACHINE,
      stalledBody as unknown as typeof fetch,
      10,
    );
    await expect(api.distributeDmKey('c', {}, {})).rejects.toThrow('timed out');
  });

  it('surfaces a failed body read instead of treating it as empty', async () => {
    const broken = jest.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: () => Promise.reject(new TypeError('network lost')),
        } as unknown as Response),
    );
    const api = new ConcordApi(
      'http://localhost:8080',
      MACHINE,
      broken as unknown as typeof fetch,
    );
    await expect(api.distributeDmKey('c', {}, {})).rejects.toThrow(
      'network lost',
    );
  });

  it('builds the WS URL, reports API errors by status and refuses unknown peers', async () => {
    const { impl } = fakeFetch({
      'GET /users/search?q=nobody': () => [200, { users: [] }],
      'POST /auth/ws-ticket': () => [401, { code: 'unauthorized' }],
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, impl);
    expect(api.wsUrl('a b')).toBe(
      'wss://api.example.test/api/v1/ws?ticket=a%20b',
    );
    expect(() => api.userId).toThrow('Not signed in');
    await expect(api.findUserId('nobody')).rejects.toThrow('User not found');
    const error = await api.wsTicket().catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(error.message).toBe('Concord API 401 unauthorized');
  });

  it('sends the app version and platform on requests and the socket URL', async () => {
    const { impl, calls } = fakeFetch({
      'POST /auth/ws-ticket': () => [200, { ticket: 't' }],
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, impl);
    api.client = async () => ({ platform: 'ios', version: '1.0.0' });
    await api.wsTicket().catch(() => {});
    expect(calls[0].headers).toMatchObject({
      'X-Concord-Client-Version': '1.0.0',
      'X-Concord-Client-Platform': 'ios',
    });
    expect(api.wsUrl('t')).toBe(
      'wss://api.example.test/api/v1/ws?ticket=t&client_version=1.0.0&client_platform=ios',
    );
  });

  it('normalises the bundle version to major.minor.patch', () => {
    expect(clientVersion('1.0(5)')).toBe('1.0.0');
    expect(clientVersion('2.3.4(17)')).toBe('2.3.4');
    expect(clientVersion('1')).toBe('1.0.0');
  });

  it('treats a malformed body as empty and rejects invalid shapes', async () => {
    const malformed = (status: number) =>
      jest.fn(
        async () =>
          ({
            ok: status < 300,
            status,
            json: () => Promise.reject(new SyntaxError('Unexpected token')),
          } as unknown as Response),
      ) as unknown as typeof fetch;
    const failing = new ConcordApi(
      'http://localhost:8080',
      MACHINE,
      malformed(500),
    );
    const error = await failing.wsTicket().catch(e => e);
    expect(error).toMatchObject({ status: 500, code: undefined });
    const empty = new ConcordApi(
      'http://localhost:8080',
      MACHINE,
      malformed(200),
    );
    await expect(empty.distributeDmKey('c', {}, {})).resolves.toBeUndefined();

    const { impl, calls } = fakeFetch({
      'POST /auth/login': () => [200, { access_token: '', user: { id: ME } }],
      'GET /users/search?q=x': () => [200, { users: ['not-an-object'] }],
    });
    const api = new ConcordApi('https://api.example.test', MACHINE, impl);
    await expect(api.login('e', 'p')).rejects.toThrow('Invalid API response');
    await expect(api.findUserId('x')).rejects.toThrow('Invalid API response');
    expect(calls.every(c => c.headers.Authorization === undefined)).toBe(true);
  });
});

describe('DmSocket', () => {
  it('subscribes, sends with an ack and receives the peer message', async () => {
    let fake!: FakeSocket;
    const dm = await DmSocket.open(
      'ws://x',
      () =>
        (fake = new FakeSocket((frame, socket) => {
          if (frame.type === 'subscribe_dm') {
            // A reply for another conversation must not settle this subscribe.
            socket.emit('dm_subscribed', { conversation_id: 'other' });
            socket.emit('dm_subscribed', frame.data);
          }
          if (frame.type === 'dm_message') {
            socket.emit('dm_message_ack', { nonce: 'n0', id: 'wrong' });
            socket.emit('dm_message_ack', {
              nonce: frame.data.nonce,
              id: 'm1',
            });
            socket.emit('dm_message', {
              id: 'spoof',
              conversation_id: CONV,
              user_id: 'intruder',
              content: 'cipher',
              key_version: 1,
            });
            socket.emit('dm_message', {
              id: 'm2',
              conversation_id: CONV,
              user_id: PEER,
              content: 'cipher',
              key_version: 1,
            });
          }
        })),
    );
    await dm.subscribe(CONV);
    const live: string[] = [];
    dm.onMessage = m => live.push(m.id);
    const reply = dm.nextMessage(CONV, PEER);
    expect(await dm.send(CONV, 'c', 1, 'n1')).toBe('m1');
    expect(await reply).toEqual({
      id: 'm2',
      conversationId: CONV,
      userId: PEER,
      content: 'cipher',
      keyVersion: 1,
    });
    // The live listener sees every valid frame; filtering is the caller's job.
    expect(live).toEqual(['spoof', 'm2']);
    const pending = dm.nextMessage(CONV, PEER);
    dm.close();
    await expect(pending).rejects.toThrow('Socket closed');
    expect(fake.closed).toBe(true);
    // Sending after close rejects with the socket's error and leaves no waiter behind.
    await expect(dm.send(CONV, 'c', 1, 'n2')).rejects.toThrow('not open');
    await expect(dm.subscribe(CONV)).rejects.toThrow('not open');
  });

  it('closes and silences a socket that never opens', async () => {
    jest.useFakeTimers();
    try {
      const socket = new FakeSocket(() => undefined, false);
      const opening = DmSocket.open('ws://x', () => socket, 50);
      const lateOpen = socket.onopen;
      expect(lateOpen).not.toBeNull();
      const failure = opening.catch(e => e);
      jest.advanceTimersByTime(50);
      expect(String(await failure)).toContain('timed out');
      expect(socket.closed).toBe(true);
      expect(socket.onopen).toBeNull();
      expect(socket.onerror).toBeNull();
      // A late open from the old handler cannot turn the failure into a socket.
      lateOpen?.();
      expect(String(await opening.catch(e => e))).toContain('timed out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps the sender and time of live messages', async () => {
    let socket!: FakeSocket;
    const dm = await DmSocket.open(
      'ws://x',
      () => (socket = new FakeSocket(() => undefined)),
    );
    const got: Array<[string | undefined, string | undefined]> = [];
    dm.onMessage = m => got.push([m.sender, m.createdAt]);
    const frame = { conversation_id: CONV, user_id: PEER, content: 'c' };
    socket.emit('dm_message', {
      ...frame,
      id: 'a',
      key_version: 1,
      display_name: 'Peer P',
      username: 'peer',
      created_at: 't',
    });
    socket.emit('dm_message', {
      ...frame,
      id: 'b',
      key_version: 1,
      display_name: '',
      username: 'peer',
    });
    socket.emit('dm_message', { ...frame, id: 'c', key_version: 1 });
    expect(got).toEqual([
      ['Peer P', 't'],
      ['peer', undefined],
      [undefined, undefined],
    ]);
  });

  it('ignores malformed and unrelated frames and fails waiters on error frames', async () => {
    let socket!: FakeSocket;
    const dm = await DmSocket.open(
      'ws://x',
      () => (socket = new FakeSocket(() => undefined)),
    );
    const pending = dm.nextMessage(CONV, PEER);
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: 42 });
    socket.emit('dm_message', {
      id: 'x',
      conversation_id: CONV,
      user_id: PEER,
      content: 'c',
      key_version: 0,
    });
    socket.emit('dm_message', {
      id: 'x',
      conversation_id: 'other',
      user_id: PEER,
      content: 'c',
      key_version: 1,
    });
    socket.emit('error', { message: 'nope' });
    await expect(pending).rejects.toThrow('Server error frame');
    const closed = dm.nextMessage(CONV, PEER);
    const dropped = jest.fn();
    dm.onDropped = dropped;
    socket.onclose?.();
    await expect(closed).rejects.toThrow('Socket closed');
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it('times out waits and failed opens', async () => {
    const dm = await DmSocket.open(
      'ws://x',
      () => new FakeSocket(() => undefined),
      10,
    );
    await expect(dm.nextMessage(CONV, PEER)).rejects.toThrow(
      'Timed out waiting for dm_message',
    );
    let failingClosed = false;
    const failing = {
      send() {},
      close() {
        failingClosed = true;
      },
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    } as SocketLike;
    const opening = DmSocket.open('ws://x', () => failing, 1000);
    failing.onerror?.();
    await expect(opening).rejects.toThrow('failed to open');
    expect(failingClosed).toBe(true);
    await expect(
      DmSocket.open('ws://x', () => ({ ...failing }), 5),
    ).rejects.toThrow('open timed out');
  });
});

describe('createSocket', () => {
  it('opens a native WebSocket with the mobile origin header', () => {
    const created: unknown[][] = [];
    const original = globalThis.WebSocket;
    globalThis.WebSocket = jest.fn(function (
      this: unknown,
      ...args: unknown[]
    ) {
      created.push(args);
    }) as unknown as typeof WebSocket;
    try {
      createSocket('wss://api.example.test/api/v1/ws?ticket=t');
    } finally {
      globalThis.WebSocket = original;
    }
    expect(MOBILE_ORIGIN).toBe('app://concord-mobile');
    expect(created).toEqual([
      [
        'wss://api.example.test/api/v1/ws?ticket=t',
        undefined,
        { headers: { Origin: 'app://concord-mobile' } },
      ],
    ]);
  });
});
