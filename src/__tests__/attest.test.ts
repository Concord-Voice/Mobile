import { NativeModules } from 'react-native';
import {
  INVALID_KEY,
  type Attester,
  nativeAttester,
  wrapAttester,
} from '../ConcordAttest';
import { ApiError, ConcordApi } from '../core/ConcordApi';

const MACHINE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KEY = 'a2V5LWlkLW9sZA==';
const NEW_KEY = 'a2V5LWlkLW5ldw==';

type Call = {
  key: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
};

/** A server that requires attestation on /dm/conversations. */
function server(verify: (body: Record<string, unknown>) => [number, unknown]) {
  const calls: Call[] = [];
  let challenges = 0;
  const impl = jest.fn(
    async (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
      const key = `${init.method} ${path}`;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ key, headers: init.headers, body });
      let reply: [number, unknown];
      if (key === 'POST /auth/login') {
        reply = [
          200,
          {
            access_token: 'a1',
            refresh_token: 'r1',
            session_id: 's1',
            user: { id: 'u1' },
            e2ee_keys: {
              wrapped_private_key: 'V1JBUA==', // pragma: allowlist secret
              key_derivation_salt: 'U0FMVA==',
              key_derivation_alg: 'argon2id',
            },
          },
        ];
      } else if (key === 'POST /auth/logout') {
        reply = [200, {}];
      } else if (key === 'POST /attestation/challenge') {
        challenges += 1;
        reply = [200, { challenge: `ch${challenges}`, ttl_seconds: 300 }];
      } else if (key === 'POST /attestation/verify') {
        reply = verify(body);
      } else if (key === 'GET /dm/conversations') {
        reply =
          init.headers['X-Attestation-Token'] === 'tok'
            ? [200, { conversations: [] }]
            : [403, { code: 'ATTESTATION_MISSING' }];
      } else {
        reply = [404, {}];
      }
      return {
        ok: reply[0] < 300,
        status: reply[0],
        json: async () => reply[1],
      } as Response;
    },
  );
  return { impl: impl as unknown as typeof fetch, calls };
}

function attester(keyId: string | null, supported = true) {
  return {
    info: jest.fn(async () => ({ supported, version: '1.0.0(5)', keyId })),
    generateKey: jest.fn(async () => NEW_KEY),
    forgetKey: jest.fn(async () => {}),
    attestKey: jest.fn(async (k: string, c: string) => `att:${k}:${c}`),
    generateAssertion: jest.fn(async (k: string, c: string) => `as:${k}:${c}`),
  } satisfies Attester;
}

async function signedIn(
  impl: typeof fetch,
  a: Attester | null,
): Promise<ConcordApi> {
  const api = new ConcordApi('https://api.example.test', MACHINE, impl);
  api.attester = a;
  await api.login('me@example.test', 'pw');
  return api;
}

const verifyKeys = (calls: Call[]) =>
  calls.filter(c => c.key === 'POST /attestation/verify').map(c => c.body);

describe('App Attest', () => {
  it('attests a new key on first use, then retries the refused request', async () => {
    const { impl, calls } = server(() => [200, { attestation_token: 'tok' }]);
    const a = attester(null);
    const api = await signedIn(impl, a);

    await expect(api.conversations()).resolves.toEqual([]);
    expect(a.generateKey).toHaveBeenCalledTimes(1);
    expect(verifyKeys(calls)).toEqual([
      {
        version: '1.0.0(5)',
        platform: 'ios',
        machine_id: MACHINE,
        key_id: NEW_KEY,
        challenge: 'ch1',
        attestation: `att:${NEW_KEY}:ch1`,
      },
    ]);
    const challenge = calls.find(c => c.key === 'POST /attestation/challenge');
    expect(challenge?.headers['X-Session-ID']).toBe('s1');
    expect(challenge?.headers['X-Machine-Id']).toBe(MACHINE);

    // The token now rides on later requests without another proof.
    await api.conversations();
    expect(verifyKeys(calls)).toHaveLength(1);
  });

  it('asserts with the stored key', async () => {
    const { impl, calls } = server(() => [200, { attestation_token: 'tok' }]);
    const a = attester(KEY);
    await (await signedIn(impl, a)).conversations();
    expect(a.generateKey).not.toHaveBeenCalled();
    expect(verifyKeys(calls)[0]).toMatchObject({
      key_id: KEY,
      assertion: `as:${KEY}:ch1`,
    });
  });

  it('re-attests when the server no longer knows the key', async () => {
    const { impl, calls } = server(body =>
      body.assertion
        ? [403, { code: 'ATTESTATION_KEY_UNKNOWN' }]
        : [200, { attestation_token: 'tok' }],
    );
    const a = attester(KEY);
    await (await signedIn(impl, a)).conversations();
    expect(a.forgetKey).toHaveBeenCalledTimes(1);
    expect(verifyKeys(calls)[1]).toMatchObject({
      key_id: NEW_KEY,
      challenge: 'ch2',
    });
  });

  it('re-attests when Apple rejects the stored key', async () => {
    const { impl } = server(() => [200, { attestation_token: 'tok' }]);
    const a = attester(KEY);
    a.generateAssertion.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: INVALID_KEY }),
    );
    await (await signedIn(impl, a)).conversations();
    expect(a.forgetKey).toHaveBeenCalled();
    expect(a.attestKey).toHaveBeenCalled();
  });

  it('does not loop when the proof is refused', async () => {
    const { impl, calls } = server(() => [
      403,
      { code: 'ATTESTATION_INVALID' },
    ]);
    const api = await signedIn(impl, attester(KEY));
    await expect(api.conversations()).rejects.toEqual(
      new ApiError(403, 'ATTESTATION_INVALID'),
    );
    expect(verifyKeys(calls)).toHaveLength(1);
  });

  it('surfaces the refusal without an attester or App Attest support', async () => {
    for (const a of [null, attester(null, false)]) {
      const { impl, calls } = server(() => [200, { attestation_token: 'tok' }]);
      const api = await signedIn(impl, a);
      await expect(api.conversations()).rejects.toBeTruthy();
      expect(verifyKeys(calls)).toHaveLength(0);
    }
  });

  it('shares one proof between concurrent refused requests', async () => {
    const { impl, calls } = server(() => [200, { attestation_token: 'tok' }]);
    const api = await signedIn(impl, attester(null));
    await Promise.all([api.conversations(), api.conversations()]);
    expect(verifyKeys(calls)).toHaveLength(1);
  });

  it('drops the token on sign-out', async () => {
    const { impl, calls } = server(() => [200, { attestation_token: 'tok' }]);
    const api = await signedIn(impl, attester(null));
    await api.conversations();
    await api.logout();
    await api.login('me@example.test', 'pw');
    await api.conversations();
    expect(verifyKeys(calls)).toHaveLength(2);
  });
});

describe('wrapAttester', () => {
  const native = (info: unknown, out: unknown = 'QUJD') => ({
    info: async () => info,
    generateKey: async () => out,
    forgetKey: async () => null,
    attestKey: async () => out,
    generateAssertion: async () => out,
  });

  it('validates native output', async () => {
    const ok = wrapAttester(
      native({ supported: true, version: '1.0(1)', keyId: null }),
    );
    await expect(ok.info()).resolves.toEqual({
      supported: true,
      version: '1.0(1)',
      keyId: null,
    });
    await expect(ok.attestKey('k', 'c')).resolves.toBe('QUJD');
    await expect(ok.generateAssertion('k', 'c')).resolves.toBe('QUJD');
    await expect(ok.generateKey()).resolves.toBe('QUJD');
    await expect(ok.forgetKey()).resolves.toBeUndefined();

    const bad = wrapAttester(native({ supported: 'yes' }, 'not base64!'));
    await expect(bad.info()).rejects.toThrow('Invalid native attest output');
    await expect(bad.generateKey()).rejects.toThrow(
      'Invalid native attest output',
    );
  });
});

describe('nativeAttester', () => {
  it('is null without the native module and wraps it when present', () => {
    const modules = NativeModules as { ConcordAttestModule?: unknown };
    delete modules.ConcordAttestModule;
    expect(nativeAttester()).toBeNull();
    modules.ConcordAttestModule = {};
    expect(nativeAttester()).not.toBeNull();
    delete modules.ConcordAttestModule;
  });
});
