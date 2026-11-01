import { create } from 'zustand';
import {
  deleteIdentity,
  deleteSession,
  type KeyHandle,
  loadIdentity,
  loadSession,
  nativeErrorCode,
  persistIdentity,
  randomId,
  releaseAll,
  releaseKey,
  saveSession,
  unlockIdentity,
} from '../ConcordCrypto';
import { Platform } from 'react-native';
import { nativeAttester } from '../ConcordAttest';
import {
  WsRateLimitedError,
  WsReconnectCooldownError,
} from '../core/wsEventBudget';
import {
  ApiError,
  type ClientInfo,
  clientVersion,
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
    const field = (k: string) =>
      typeof v[k] === 'string' && v[k] !== '' ? (v[k] as string) : null;
    const [server, machineId, refreshToken, sessionId, userId] = [
      'server',
      'machineId',
      'refreshToken',
      'sessionId',
      'userId',
    ].map(field);
    if (!server || !machineId || !refreshToken || !sessionId || !userId)
      return null;
    // Only the known fields: anything else in the record never reaches the api.
    return { server, machineId, refreshToken, sessionId, userId };
  } catch {
    return null;
  }
}

/** Writes the session record; best effort, since a lost write only costs a sign-in later. */
function persist(at: Origin, saved: SavedSession | null): void {
  if (saved)
    saveSession(
      JSON.stringify({
        server: at.server,
        machineId: at.machineId,
        ...saved,
      }),
    ).catch(() => {});
}

/** What a person sees: never a raw server body, which may echo their input. */
export function describeError(error: unknown): string {
  if (error instanceof WsReconnectCooldownError)
    return 'The server is busy. Wait a moment, then go back and reopen this conversation.';
  if (error instanceof WsRateLimitedError)
    return 'The server is busy. Try again later.';
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Wrong email, password or code.';
    if (error.status === 429) return 'Too many attempts. Try again later.';
    if (
      error.status === 403 &&
      (error.code === 'ATTESTATION_REVOKED' ||
        error.code === 'CLIENT_VERSION_TOO_OLD')
    )
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

/**
 * This build's platform and version, read from the bundle via the attest module.
 * A failed lookup is not cached, so the next request retries it.
 * ponytail: Android has no native module yet, so it sends no version until one lands.
 */
let client: Promise<ClientInfo | null> | null = null;
export function appClient(): Promise<ClientInfo | null> {
  client ??= (nativeAttester()?.info() ?? Promise.resolve(null)).then(
    info =>
      info
        ? { platform: Platform.OS, version: clientVersion(info.version) }
        : null,
    () => {
      client = null;
      return null;
    },
  );
  return client;
}

export function createSessionStore(
  makeApi: (server: string, machineId: string) => ConcordApi = (s, m) => {
    const api = new ConcordApi(s, m);
    api.attester = nativeAttester();
    api.client = appClient;
    return api;
  },
) {
  // Held only between the password step and the MFA step, never in state.
  let pendingPassword: string | null = null;
  // Where the current api points, for persisting and forgetting its session.
  let origin: Origin | null = null;

  /** Drops the saved session and the Face ID copy of the identity, retrying once; rejects if either survives. */
  const forget = async (p?: { server: string; userId: string }) => {
    const wipe = () =>
      Promise.all([deleteSession(), p && deleteIdentity(account(p))]);
    await wipe().catch(wipe);
  };

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

    /** knownUserId: the account a resumed session belongs to, before any stage says so. */
    const connect = (at: Origin, knownUserId?: string): ConcordApi => {
      const api = makeApi(at.server, at.machineId);
      get().api?.wsReconnect.retire();
      api.onExpired = () => {
        if (get().api !== api) return;
        api.wsReconnect.retire();
        // The api has already dropped its session, so its userId is gone: read ours.
        const { stage } = get();
        const userId = stage.kind === 'signed_in' ? stage.userId : knownUserId;
        pendingPassword = null;
        set({
          stage: { kind: 'signed_out' },
          api: null,
          identity: null,
          canResume: false,
          error: 'Your session ended. Log in again.',
        });
        releaseAll().catch(() => {});
        // A record that survives is refused again next launch, which retries this.
        forget(userId ? { ...at, userId } : undefined).catch(() => {});
      };
      origin = at;
      set({ api });
      return api;
    };

    /** Saves each rotated token pair while this api is the live one, best effort. */
    const writer = (api: ConcordApi, at: Origin) => () => {
      // ponytail: a write racing a sign-out can outlive it; the next launch finds no identity and cleans up.
      if (get().api === api) persist(at, api.saved());
    };

    /** Keeps the session across launches: the identity behind Face ID, the tokens beside it. */
    const remember = async (api: ConcordApi, identity: KeyHandle) => {
      const at = origin;
      if (!at) return;
      try {
        const userId = api.userId;
        await persistIdentity(identity, account({ ...at, userId }));
        // Signed out while saving: the sign-out's wipe may have run first, so undo the save.
        if (get().api === null) {
          await forget({ ...at, userId }).catch(() => {});
          return;
        }
        if (get().api !== api) return;
      } catch {
        // No biometrics enrolled (native reports it as a Keychain failure, so the two look
        // alike): sign in on every launch, and drop any older record so it is not offered.
        await deleteSession().catch(() => {});
        return;
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
            const code = nativeErrorCode(error);
            // Anything but a missing key: keep everything, so "Unlock" can try again.
            if (code === 'E_CONCORD_CRYPTO_USERCANCELLED') return;
            if (code !== 'E_CONCORD_CRYPTO_NOTFOUND') {
              // Lockout or a Keychain fault: say so, and leave the password as the way in.
              set({
                error:
                  'Face ID could not unlock your saved sign-in. Try again, or log in with your password.',
              });
              return;
            }
            // Face ID set changed, so the key copy is gone: end the server session too.
            const api = makeApi(saved.server, saved.machineId);
            api.onRotated = () => persist(saved, api.saved());
            let revoked = true;
            try {
              await api.resume(saved);
              await api.logout();
            } catch (e) {
              revoked = e instanceof ApiError && e.status === 401;
            }
            // Not revoked (offline): keep the rotated record, so the next launch tries again.
            await (revoked
              ? forget(saved)
              : deleteIdentity(account(saved))
            ).catch(() => {});
            set({
              canResume: false,
              error: 'Log in again to unlock your messages on this device.',
            });
            return;
          }
          const api = connect(saved, saved.userId);
          try {
            await api.resume(saved);
          } catch {
            // Only a refusal (401) gets here, and onExpired has already reset the store.
            await releaseKey(identity).catch(() => {});
            return;
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
            // One id per sign-in, persisted with the session it belongs to.
            machineId: await randomId(),
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
        api?.wsReconnect.retire();
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
        const [, , wiped] = await Promise.allSettled([
          api?.logout(),
          releaseAll(),
          forget(
            at && stage.kind === 'signed_in'
              ? { ...at, userId: stage.userId }
              : undefined,
          ),
        ]);
        // The saved sign-in survived: say so rather than reopen it silently next launch.
        if (wiped.status === 'rejected')
          set({
            error:
              'Signed out, but this device could not remove your saved sign-in. If the app reopens it, sign out again.',
          });
      },
    };
  });
}

export const useSession = createSessionStore();
