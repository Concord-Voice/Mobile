import { create } from 'zustand';
import {
  deleteIdentity,
  deleteSession,
  type KeyHandle,
  loadIdentity,
  loadSession,
  nativeErrorCode,
  persistIdentity,
  releaseAll,
  releaseKey,
  saveSession,
  unlockIdentity,
} from '../ConcordCrypto';
import { nativeAttester } from '../ConcordAttest';
import {
  ApiError,
  ConcordApi,
  type LoginKeys,
  type MfaCodeMethod,
  type SavedSession,
} from '../core/ConcordApi';

export type Stage =
  | { kind: 'starting' }
  | { kind: 'signed_out' }
  | { kind: 'mfa'; challengeToken: string; methods: string[] }
  | { kind: 'signed_in'; userId: string };

export type SessionState = {
  stage: Stage;
  busy: boolean;
  error: string | null;
  api: ConcordApi | null;
  identity: KeyHandle | null;
  /** A saved session exists that Face ID can reopen. */
  canResume: boolean;
  restore(): Promise<void>;
  signIn(server: string, email: string, password: string): Promise<void>;
  sendMfaEmail(): Promise<void>;
  verifyMfa(method: MfaCodeMethod, code: string): Promise<void>;
  signOut(): Promise<void>;
};

/** Where a session lives; the machine id must match the one the server session was minted for. */
type Origin = { server: string; machineId: string };
type Persisted = Origin & SavedSession;

const UNLOCK_REASON = 'Unlock your Concord messages';

function account(p: { server: string; userId: string }): string {
  return `${p.userId}@${p.server}`;
}

function parsePersisted(raw: string): Persisted | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const keys = ['server', 'machineId', 'refreshToken', 'sessionId', 'userId'];
    if (!keys.every(k => typeof v[k] === 'string' && v[k] !== '')) return null;
    return v as unknown as Persisted;
  } catch {
    return null;
  }
}

// One id per sign-in, persisted with the session it belongs to.
function newMachineId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c =>
    c === 'x' ? hex() : '89ab'[Math.floor(Math.random() * 4)],
  );
}

/** What a person sees: never a raw server body, which may echo their input. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Wrong email, password or code.';
    if (error.status === 429) return 'Too many attempts. Try again later.';
    if (error.status === 403 && error.code === 'ATTESTATION_REVOKED')
      return 'This version of the app is no longer supported. Update it to continue.';
    if (error.status === 403)
      return 'This server does not accept this app yet.';
    return 'The server could not complete that. Try again.';
  }
  if (nativeErrorCode(error) === 'E_CONCORD_CRYPTO_WRONGPASSWORD') {
    return 'Your password could not unlock your encryption key.';
  }
  if (
    error instanceof Error &&
    /^(Invalid API base URL|Plain http)/.test(error.message)
  ) {
    return 'Enter a server address like https://chat.example.com.';
  }
  if (
    error instanceof Error &&
    error.message.startsWith('Unsupported key derivation')
  ) {
    return 'This account uses an older key format the app cannot open yet.';
  }
  return 'Could not reach the server. Check your connection.';
}

export function createSessionStore(
  makeApi: (server: string, machineId: string) => ConcordApi = (s, m) => {
    const api = new ConcordApi(s, m);
    api.attester = nativeAttester();
    return api;
  },
) {
  // Held only between the password step and the MFA step, never in state.
  let pendingPassword: string | null = null;
  // Where the current api points, for persisting and forgetting its session.
  let origin: Origin | null = null;

  /** Drops the saved session and the Face ID copy of the identity; best effort. */
  const forget = (p: { server: string; userId: string }) =>
    Promise.allSettled([deleteSession(), deleteIdentity(account(p))]);

  return create<SessionState>((set, get) => {
    const run = async (work: () => Promise<void>) => {
      set({ busy: true, error: null });
      try {
        await work();
      } catch (error) {
        set({ error: describeError(error) });
      } finally {
        set({ busy: false });
      }
    };

    const connect = (at: Origin): ConcordApi => {
      const api = makeApi(at.server, at.machineId);
      api.onExpired = () => {
        if (get().api !== api) return;
        pendingPassword = null;
        set({
          stage: { kind: 'signed_out' },
          api: null,
          identity: null,
          canResume: false,
          error: 'Your session ended. Log in again.',
        });
        releaseAll().catch(() => {});
        forget({ ...at, userId: api.userId }).catch(() => {});
      };
      origin = at;
      set({ api });
      return api;
    };

    /** Saves the current token pair, so the persisted copy never holds a spent refresh token. */
    const writer = (api: ConcordApi, at: Origin) => () => {
      const saved = api.saved();
      // ponytail: a write racing a sign-out can outlive it; the next launch's refresh is refused and cleans up.
      if (saved && get().api === api)
        saveSession(
          JSON.stringify({
            server: at.server,
            machineId: at.machineId,
            ...saved,
          }),
        ).catch(() => {});
    };

    /** Keeps the session across launches: the identity behind Face ID, the tokens beside it. */
    const remember = async (api: ConcordApi, identity: KeyHandle) => {
      const at = origin;
      if (!at) return;
      try {
        await persistIdentity(identity, account({ ...at, userId: api.userId }));
      } catch {
        return; // No biometrics enrolled: this device signs in on every launch.
      }
      api.onRotated = writer(api, at);
      api.onRotated();
    };

    const finish = async (
      api: ConcordApi,
      keys: LoginKeys,
      password: string,
    ) => {
      pendingPassword = null;
      let identity: KeyHandle;
      try {
        identity = await unlockIdentity(
          password,
          keys.keyDerivationSalt,
          keys.wrappedPrivateKey,
          keys.keyDerivationAlg,
        );
      } catch (error) {
        // Without the key the app is useless, so the fresh server session goes too.
        if (get().api !== api) return;
        await api.logout().catch(() => {});
        set({ stage: { kind: 'signed_out' }, api: null });
        throw error;
      }
      // Signed out (or signed in elsewhere) while unlocking: drop this key.
      if (get().api !== api) {
        await Promise.allSettled([releaseKey(identity), api.logout()]);
        return;
      }
      set({ identity, stage: { kind: 'signed_in', userId: api.userId } });
      await remember(api, identity);
    };

    return {
      stage: { kind: 'starting' },
      busy: false,
      error: null,
      api: null,
      identity: null,
      canResume: false,

      restore: () =>
        run(async () => {
          // Only from launch or the sign-in screen: never over a live session or MFA step.
          const { kind } = get().stage;
          if (kind !== 'starting' && kind !== 'signed_out') return;
          const raw = await loadSession().catch(() => null);
          const saved = raw === null ? null : parsePersisted(raw);
          if (!saved) {
            set({ stage: { kind: 'signed_out' }, canResume: false });
            return;
          }
          set({ canResume: true });
          let identity: KeyHandle;
          try {
            identity = await loadIdentity(account(saved), UNLOCK_REASON);
          } catch (error) {
            set({ stage: { kind: 'signed_out' } });
            // Cancelled: keep everything, so "Unlock" can try again.
            if (nativeErrorCode(error) !== 'E_CONCORD_CRYPTO_NOTFOUND') return;
            // Face ID set changed, so the key copy is gone: end the server session too.
            const api = makeApi(saved.server, saved.machineId);
            await api
              .resume(saved)
              .then(() => api.logout())
              .catch(() => {});
            await forget(saved);
            set({
              canResume: false,
              error: 'Log in again to unlock your messages on this device.',
            });
            return;
          }
          const api = connect(saved);
          try {
            await api.resume(saved);
          } catch (error) {
            await releaseKey(identity).catch(() => {});
            // A refused rotation already reset the store through onExpired.
            if (error instanceof ApiError && error.status === 401) return;
            throw error;
          }
          if (get().api !== api) {
            await releaseKey(identity).catch(() => {});
            return;
          }
          api.onRotated = writer(api, saved);
          api.onRotated();
          set({ identity, stage: { kind: 'signed_in', userId: api.userId } });
        }),

      signIn: (server, email, password) =>
        run(async () => {
          const api = connect({
            server: server.trim().replace(/\/+$/, ''),
            machineId: newMachineId(),
          });
          const result = await api.login(email.trim(), password);
          if (get().api !== api) return api.logout().catch(() => {});
          if (result.kind === 'mfa') {
            pendingPassword = password;
            set({
              stage: {
                kind: 'mfa',
                challengeToken: result.challengeToken,
                methods: result.methods,
              },
            });
            return;
          }
          await finish(api, result.keys, password);
        }),

      sendMfaEmail: () =>
        run(async () => {
          const { api, stage } = get();
          if (!api || stage.kind !== 'mfa') throw new Error('No MFA challenge');
          await api.sendMfaEmail(stage.challengeToken);
        }),

      verifyMfa: (method, code) =>
        run(async () => {
          const { api, stage } = get();
          const password = pendingPassword;
          if (!api || stage.kind !== 'mfa' || password === null)
            throw new Error('No MFA challenge');
          const keys = await api.verifyMfa(
            stage.challengeToken,
            method,
            code.trim(),
          );
          if (get().api !== api) return api.logout().catch(() => {});
          await finish(api, keys, password);
        }),

      signOut: async () => {
        const { api, stage } = get();
        const at = origin;
        pendingPassword = null;
        set({
          stage: { kind: 'signed_out' },
          api: null,
          identity: null,
          canResume: false,
          error: null,
        });
        // Local state is gone first; server revocation and key release are best effort.
        await Promise.allSettled([
          api?.logout(),
          releaseAll(),
          at && stage.kind === 'signed_in'
            ? forget({ ...at, userId: stage.userId })
            : deleteSession(),
        ]);
      },
    };
  });
}

export const useSession = createSessionStore();
