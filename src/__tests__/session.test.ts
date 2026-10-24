import { ApiError, type ConcordApi } from '../core/ConcordApi';
import { createSessionStore, describeError } from '../state/session';

jest.mock('../ConcordCrypto', () => ({
  unlockIdentity: jest.fn(async () => 'HANDLE'),
  releaseAll: jest.fn(async () => {}),
  releaseKey: jest.fn(async () => {}),
  nativeErrorCode: (e: unknown) =>
    (e as { code?: string } | null)?.code ?? null,
}));
const crypto = jest.requireMock('../ConcordCrypto') as {
  unlockIdentity: jest.Mock;
  releaseAll: jest.Mock;
  releaseKey: jest.Mock;
};

const KEYS = {
  wrappedPrivateKey: 'V1JBUA==', // pragma: allowlist secret
  keyDerivationSalt: 'U0FMVA==',
  keyDerivationAlg: 'argon2id',
};

function fakeApi(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const api = {
    userId: 'user-1',
    onExpired: null as (() => void) | null,
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
  return { useStore: createSessionStore(makeApi), makeApi };
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
});

describe('describeError', () => {
  it('maps failures to plain messages', () => {
    expect(describeError(new ApiError(429, undefined))).toMatch(/Too many/);
    expect(describeError(new ApiError(403, 'ATTESTATION_MISSING'))).toMatch(
      /does not accept this app/,
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
