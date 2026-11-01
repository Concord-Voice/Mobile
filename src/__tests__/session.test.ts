import { ApiError, type ConcordApi } from '../core/ConcordApi';
import {
  WsRateLimitedError,
  WsReconnectCooldownError,
} from '../core/wsEventBudget';
import { createSessionStore, describeError } from '../state/session';

jest.mock('../ConcordCrypto', () => ({
  unlockIdentity: jest.fn(async () => 'HANDLE'),
  releaseAll: jest.fn(async () => {}),
  releaseKey: jest.fn(async () => {}),
  persistIdentity: jest.fn(async () => {}),
  loadIdentity: jest.fn(async () => 'SAVED_HANDLE'),
  deleteIdentity: jest.fn(async () => {}),
  saveSession: jest.fn(async () => {}),
  loadSession: jest.fn(async () => null),
  deleteSession: jest.fn(async () => {}),
  randomId: jest.fn(async () => '00000000-0000-4000-8000-000000000001'),
  nativeErrorCode: (e: unknown) =>
    (e as { code?: string } | null)?.code ?? null,
}));
const crypto = jest.requireMock('../ConcordCrypto') as {
  unlockIdentity: jest.Mock;
  releaseAll: jest.Mock;
  releaseKey: jest.Mock;
  persistIdentity: jest.Mock;
  loadIdentity: jest.Mock;
  deleteIdentity: jest.Mock;
  saveSession: jest.Mock;
  loadSession: jest.Mock;
  deleteSession: jest.Mock;
};

const SAVED = {
  server: 'https://c.test',
  machineId: 'machine-1',
  refreshToken: 'rt-old', // pragma: allowlist secret
  sessionId: 'sess-1',
  userId: 'user-1',
};
const lastSaved = () =>
  JSON.parse(crypto.saveSession.mock.calls.at(-1)[0]) as typeof SAVED;

const KEYS = {
  wrappedPrivateKey: 'V1JBUA==', // pragma: allowlist secret
  keyDerivationSalt: 'U0FMVA==',
  keyDerivationAlg: 'argon2id',
};

function fakeApi(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const wsReconnect = {
    active: true,
    assertCanOpen: jest.fn(),
    recordOverload: jest.fn(),
    retire: jest.fn(function (this: { active: boolean }) {
      this.active = false;
    }),
  };
  const api = {
    userId: 'user-1',
    wsReconnect,
    onExpired: null as (() => void) | null,
    onRotated: null as (() => void) | null,
    tokens: { refreshToken: 'rt-1', sessionId: 'sess-1', userId: 'user-1' },
    saved: jest.fn((): unknown => api.tokens),
    resume: jest.fn(async () => {}),
    login: jest.fn(async () => ({ kind: 'signed_in', keys: KEYS })),
    verifyMfa: jest.fn(async () => KEYS),
    sendMfaEmail: jest.fn(async () => {}),
    logout: jest.fn(async () => {}),
    ...overrides,
  };
  return api;
}

function store(api: ReturnType<typeof fakeApi>) {
  const makeApi = jest.fn(() => api as unknown as ConcordApi);
  const useStore = createSessionStore(makeApi);
  expect(useStore.getState().stage.kind).toBe('starting');
  // As after a launch with nothing saved.
  useStore.setState({ stage: { kind: 'signed_out' } });
  return { useStore, makeApi };
}

beforeEach(() => jest.clearAllMocks());

describe('session store', () => {
  it('signs in and unlocks the identity with the password', async () => {
    const api = fakeApi();
    const { useStore, makeApi } = store(api);
    await useStore
      .getState()
      .signIn(' https://chat.example.test/ ', ' m@x.test ', 'pw');
    expect(makeApi).toHaveBeenCalledWith(
      'https://chat.example.test',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    );
    expect(api.login).toHaveBeenCalledWith('m@x.test', 'pw');
    expect(crypto.unlockIdentity).toHaveBeenCalledWith(
      'pw',
      KEYS.keyDerivationSalt,
      KEYS.wrappedPrivateKey,
      'argon2id',
    );
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_in', userId: 'user-1' },
      identity: 'HANDLE',
      busy: false,
      error: null,
    });
  });

  it('carries the password through an MFA step', async () => {
    const api = fakeApi({
      login: jest.fn(async () => ({
        kind: 'mfa',
        challengeToken: 'chal',
        methods: ['totp', 'email'],
      })),
    });
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    expect(useStore.getState().stage).toEqual({
      kind: 'mfa',
      challengeToken: 'chal',
      methods: ['totp', 'email'],
    });
    expect(JSON.stringify(useStore.getState())).not.toContain('pw');
    await useStore.getState().sendMfaEmail();
    expect(api.sendMfaEmail).toHaveBeenCalledWith('chal');
    await useStore.getState().verifyMfa('totp', ' 123456 ');
    expect(api.verifyMfa).toHaveBeenCalledWith('chal', 'totp', '123456');
    expect(crypto.unlockIdentity.mock.calls[0][0]).toBe('pw');
    expect(useStore.getState().stage.kind).toBe('signed_in');
  });

  it('shows a plain error and stays signed out on a wrong password', async () => {
    const api = fakeApi({
      login: jest.fn(async () => {
        throw new ApiError(401, 'invalid_credentials');
      }),
    });
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'bad');
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      error: 'Wrong email, password or code.',
      busy: false,
    });
  });

  it('logs the server session out when the key will not unlock', async () => {
    crypto.unlockIdentity.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'E_CONCORD_CRYPTO_WRONGPASSWORD' }),
    );
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    expect(api.logout).toHaveBeenCalled();
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      api: null,
      error: 'Your password could not unlock your encryption key.',
    });
  });

  it('refuses MFA actions without a challenge', async () => {
    const { useStore } = store(fakeApi());
    await useStore.getState().verifyMfa('totp', '1');
    expect(useStore.getState().error).toBe(
      'Could not reach the server. Check your connection.',
    );
  });

  it('signs out locally even if revocation fails', async () => {
    const api = fakeApi({
      logout: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    await useStore.getState().signOut();
    expect(api.logout).toHaveBeenCalled();
    expect(crypto.releaseAll).toHaveBeenCalled();
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      api: null,
      identity: null,
    });
  });

  it('drops a key that finishes unlocking after sign-out', async () => {
    let unlock!: (handle: string) => void;
    crypto.unlockIdentity.mockReturnValueOnce(
      new Promise(resolve => {
        unlock = resolve;
      }),
    );
    const { useStore } = store(fakeApi());
    const signingIn = useStore.getState().signIn('https://c.test', 'm', 'pw');
    await new Promise(setImmediate);
    await useStore.getState().signOut();
    unlock('LATE');
    await signingIn;
    expect(crypto.releaseKey).toHaveBeenCalledWith('LATE');
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      identity: null,
    });
  });

  it('returns to sign-in when the server ends the session', async () => {
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    api.onExpired?.();
    expect(crypto.releaseAll).toHaveBeenCalled();
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      api: null,
      identity: null,
      error: 'Your session ended. Log in again.',
    });
  });

  it('keeps the session behind Face ID and saves every rotation', async () => {
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    expect(crypto.persistIdentity).toHaveBeenCalledWith(
      'HANDLE',
      'user-1@https://c.test',
    );
    expect(lastSaved()).toMatchObject({
      server: 'https://c.test',
      refreshToken: 'rt-1',
      userId: 'user-1',
    });
    api.tokens = { ...api.tokens, refreshToken: 'rt-2' };
    api.onRotated?.();
    expect(lastSaved().refreshToken).toBe('rt-2');
    expect(useStore.getState().api).toBe(api);
    expect(api.wsReconnect.active).toBe(true);
    expect(api.wsReconnect.retire).not.toHaveBeenCalled();
  });

  it('retires the old reconnect owner before publishing a replacement API', async () => {
    const first = fakeApi();
    const second = fakeApi();
    const makeApi = jest
      .fn<ConcordApi, [string, string]>()
      .mockReturnValueOnce(first as unknown as ConcordApi)
      .mockReturnValueOnce(second as unknown as ConcordApi);
    const useStore = createSessionStore(makeApi);
    useStore.setState({ stage: { kind: 'signed_out' } });
    await useStore.getState().signIn('https://first.test', 'a', 'pw');
    expect(useStore.getState().api).toBe(first);
    const published: boolean[] = [];
    const unsubscribe = useStore.subscribe(state => {
      if (state.api === (second as unknown as ConcordApi))
        published.push(first.wsReconnect.active);
    });
    await useStore.getState().signIn('https://second.test', 'b', 'pw');
    unsubscribe();
    expect(first.wsReconnect.retire).toHaveBeenCalledTimes(1);
    expect(published.length).toBeGreaterThan(0);
    expect(published.every(active => active === false)).toBe(true);
    expect(second.wsReconnect.active).toBe(true);
    expect(second.wsReconnect.retire).not.toHaveBeenCalled();
  });

  it('retires the owned reconnect gate before expiry publishes signed-out state', async () => {
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    const published: boolean[] = [];
    const unsubscribe = useStore.subscribe(state => {
      if (state.stage.kind === 'signed_out' && state.api === null)
        published.push(api.wsReconnect.active);
    });
    api.onExpired?.();
    unsubscribe();
    expect(api.wsReconnect.retire).toHaveBeenCalledTimes(1);
    expect(published).toEqual([false]);
  });

  it('retires the reconnect owner synchronously when sign-out begins', async () => {
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    let finishLogout!: () => void;
    api.logout.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishLogout = resolve;
        }),
    );
    const pending = useStore.getState().signOut();
    expect(api.wsReconnect.retire).toHaveBeenCalledTimes(1);
    expect(api.wsReconnect.active).toBe(false);
    expect(useStore.getState().api).toBeNull();
    finishLogout();
    await pending;
  });

  it('saves nothing when the device has no biometrics', async () => {
    crypto.persistIdentity.mockRejectedValueOnce(new Error('no biometrics'));
    const { useStore } = store(fakeApi());
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    expect(crypto.saveSession).not.toHaveBeenCalled();
    expect(useStore.getState().stage.kind).toBe('signed_in');
  });

  it('resumes a saved session with Face ID on launch', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    const api = fakeApi();
    const { useStore, makeApi } = store(api);
    await useStore.getState().restore();
    expect(makeApi).toHaveBeenCalledWith('https://c.test', 'machine-1');
    expect(crypto.loadIdentity).toHaveBeenCalledWith(
      'user-1@https://c.test',
      expect.any(String),
    );
    expect(api.resume).toHaveBeenCalledWith(SAVED);
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_in', userId: 'user-1' },
      identity: 'SAVED_HANDLE',
    });
    expect(lastSaved()).toMatchObject({
      machineId: 'machine-1',
      refreshToken: 'rt-1',
    });
  });

  it('starts signed out with nothing or garbage saved', async () => {
    for (const raw of [null, '{"server":"x"}', 'not json']) {
      crypto.loadSession.mockResolvedValueOnce(raw);
      const { useStore } = store(fakeApi());
      await useStore.getState().restore();
      expect(useStore.getState()).toMatchObject({
        stage: { kind: 'signed_out' },
        canResume: false,
      });
    }
    expect(crypto.loadIdentity).not.toHaveBeenCalled();
  });

  it('keeps the saved session when Face ID is cancelled', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    crypto.loadIdentity.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'E_CONCORD_CRYPTO_USERCANCELLED' }),
    );
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().restore();
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      canResume: true,
    });
    expect(crypto.deleteSession).not.toHaveBeenCalled();
    expect(api.resume).not.toHaveBeenCalled();
  });

  it('revokes and forgets a session whose Face ID key is gone', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    crypto.loadIdentity.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'E_CONCORD_CRYPTO_NOTFOUND' }),
    );
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().restore();
    expect(api.resume).toHaveBeenCalledWith(SAVED);
    expect(api.logout).toHaveBeenCalled();
    expect(crypto.deleteSession).toHaveBeenCalled();
    expect(crypto.deleteIdentity).toHaveBeenCalledWith('user-1@https://c.test');
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      canResume: false,
      error: expect.stringMatching(/Log in again/),
    });
  });

  it('forgets a saved session the server refuses', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    const api = fakeApi();
    api.resume.mockImplementationOnce(async () => {
      api.onExpired?.();
      throw new ApiError(401, undefined);
    });
    const { useStore } = store(api);
    await useStore.getState().restore();
    expect(crypto.releaseKey).toHaveBeenCalledWith('SAVED_HANDLE');
    expect(crypto.deleteSession).toHaveBeenCalled();
    // No stage names the account yet: the saved record does.
    expect(crypto.deleteIdentity).toHaveBeenCalledWith('user-1@https://c.test');
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      api: null,
      error: 'Your session ended. Log in again.',
    });
  });

  it('forgets the right account when a resumed session expires later', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().restore();
    // Like ConcordApi: the session (and its userId) is gone before onExpired runs.
    Object.defineProperty(api, 'userId', {
      get: () => {
        throw new Error('Not signed in');
      },
    });
    api.onExpired?.();
    await new Promise(setImmediate);
    expect(crypto.deleteSession).toHaveBeenCalled();
    expect(crypto.deleteIdentity).toHaveBeenCalledWith('user-1@https://c.test');
    expect(useStore.getState().stage).toEqual({ kind: 'signed_out' });
  });

  it('never restores over a live session', async () => {
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    await useStore.getState().restore();
    expect(crypto.loadSession).not.toHaveBeenCalled();
  });

  it('forgets the saved session on sign-out', async () => {
    const { useStore } = store(fakeApi());
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    await useStore.getState().signOut();
    expect(crypto.deleteSession).toHaveBeenCalled();
    expect(crypto.deleteIdentity).toHaveBeenCalledWith('user-1@https://c.test');
  });
});

describe('session store edges', () => {
  it('writes no token that rotates after sign-out', async () => {
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    const rotated = api.onRotated;
    await useStore.getState().signOut();
    crypto.saveSession.mockClear();
    rotated?.();
    expect(crypto.saveSession).not.toHaveBeenCalled();
  });

  it('retries a failed wipe on sign-out and says when it still fails', async () => {
    crypto.deleteSession.mockRejectedValue(new Error('keychain'));
    const { useStore } = store(fakeApi());
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    await useStore.getState().signOut();
    expect(crypto.deleteSession).toHaveBeenCalledTimes(2);
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      error: expect.stringMatching(/could not remove your saved sign-in/),
    });
    crypto.deleteSession.mockResolvedValue(undefined);
  });

  it('drops only the session record when signing out mid-MFA', async () => {
    const api = fakeApi({
      login: jest.fn(async () => ({
        kind: 'mfa',
        challengeToken: 'c',
        methods: ['totp'],
      })),
    });
    const { useStore } = store(api);
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    await useStore.getState().signOut();
    expect(crypto.deleteSession).toHaveBeenCalled();
    expect(crypto.deleteIdentity).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBeNull();
  });

  it('keeps the rotated record when the old session cannot be revoked offline', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    crypto.loadIdentity.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'E_CONCORD_CRYPTO_NOTFOUND' }),
    );
    const api = fakeApi({
      logout: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    api.resume.mockImplementationOnce(async () => {
      api.tokens = { ...api.tokens, refreshToken: 'rt-2' };
      api.onRotated?.();
    });
    const { useStore } = store(api);
    await useStore.getState().restore();
    expect(lastSaved().refreshToken).toBe('rt-2');
    expect(crypto.deleteSession).not.toHaveBeenCalled();
    expect(crypto.deleteIdentity).toHaveBeenCalledWith('user-1@https://c.test');
    expect(useStore.getState().canResume).toBe(false);
  });

  it('passes only known fields from a tampered record', async () => {
    crypto.loadSession.mockResolvedValueOnce(
      JSON.stringify({ ...SAVED, accessToken: 'INJECTED' }),
    );
    const api = fakeApi();
    const { useStore } = store(api);
    await useStore.getState().restore();
    expect(api.resume).toHaveBeenCalledWith(SAVED);
  });

  it('starts signed out when the Keychain read fails', async () => {
    crypto.loadSession.mockRejectedValueOnce(new Error('locked'));
    const { useStore } = store(fakeApi());
    await useStore.getState().restore();
    expect(useStore.getState().stage).toEqual({ kind: 'signed_out' });
  });

  it('drops an older record when this sign-in cannot be kept', async () => {
    crypto.persistIdentity.mockRejectedValueOnce(new Error('no biometrics'));
    const { useStore } = store(fakeApi());
    await useStore.getState().signIn('https://c.test', 'm', 'pw');
    expect(crypto.deleteSession).toHaveBeenCalled();
  });

  it('lets a sign-in made during resume win', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    let finishResume!: () => void;
    const api = fakeApi();
    api.resume.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishResume = resolve;
        }),
    );
    const { useStore } = store(api);
    const restoring = useStore.getState().restore();
    await new Promise(setImmediate);
    useStore.setState({ api: null });
    finishResume();
    await restoring;
    expect(crypto.releaseKey).toHaveBeenCalledWith('SAVED_HANDLE');
    expect(useStore.getState().stage.kind).not.toBe('signed_in');
  });
});

describe('session store unlock failures and races', () => {
  it('says so when Face ID is locked out, and keeps the record', async () => {
    crypto.loadSession.mockResolvedValueOnce(JSON.stringify(SAVED));
    crypto.loadIdentity.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        code: 'E_CONCORD_CRYPTO_AUTHENTICATIONFAILED',
      }),
    );
    const { useStore } = store(fakeApi());
    await useStore.getState().restore();
    expect(useStore.getState()).toMatchObject({
      stage: { kind: 'signed_out' },
      canResume: true,
      error: expect.stringMatching(/Face ID could not unlock/),
    });
    expect(crypto.deleteSession).not.toHaveBeenCalled();
  });

  it('undoes an identity save that finishes after sign-out', async () => {
    let saved!: () => void;
    crypto.persistIdentity.mockReturnValueOnce(
      new Promise<void>(resolve => {
        saved = resolve;
      }),
    );
    const { useStore } = store(fakeApi());
    const signingIn = useStore.getState().signIn('https://c.test', 'm', 'pw');
    await new Promise(setImmediate);
    await useStore.getState().signOut();
    crypto.deleteIdentity.mockClear();
    crypto.saveSession.mockClear();
    saved();
    await signingIn;
    expect(crypto.deleteIdentity).toHaveBeenCalledWith('user-1@https://c.test');
    expect(crypto.saveSession).not.toHaveBeenCalled();
  });
});

describe('describeError', () => {
  it('maps failures to plain messages', () => {
    expect(describeError(new WsReconnectCooldownError(1000))).toBe(
      'The server is busy. Wait a moment, then go back and reopen this conversation.',
    );
    expect(describeError(new WsRateLimitedError('content', 30000))).toBe(
      'The server is busy. Try again later.',
    );
    expect(describeError(new ApiError(429, undefined))).toMatch(/Too many/);
    expect(describeError(new ApiError(403, 'ATTESTATION_MISSING'))).toMatch(
      /does not accept this app/,
    );
    expect(describeError(new ApiError(403, 'ATTESTATION_REVOKED'))).toMatch(
      /Update it to continue/,
    );
    expect(describeError(new ApiError(403, 'CLIENT_VERSION_TOO_OLD'))).toMatch(
      /Update it to continue/,
    );
    expect(describeError(new ApiError(500, undefined))).toMatch(
      /could not complete/,
    );
    expect(describeError(new Error('Plain http is only allowed'))).toMatch(
      /server address/,
    );
    expect(
      describeError(new Error('Unsupported key derivation: pbkdf2')),
    ).toMatch(/older key format/);
  });
});
