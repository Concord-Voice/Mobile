import { create } from 'zustand';
import {
  type KeyHandle,
  nativeErrorCode,
  releaseAll,
  unlockIdentity,
} from '../ConcordCrypto';
import {
  ApiError,
  ConcordApi,
  type LoginKeys,
  type MfaCodeMethod,
} from '../core/ConcordApi';

export type Stage =
  | { kind: 'signed_out' }
  | { kind: 'mfa'; challengeToken: string; methods: string[] }
  | { kind: 'signed_in'; userId: string };

export type SessionState = {
  stage: Stage;
  busy: boolean;
  error: string | null;
  api: ConcordApi | null;
  identity: KeyHandle | null;
  signIn(server: string, email: string, password: string): Promise<void>;
  sendMfaEmail(): Promise<void>;
  verifyMfa(method: MfaCodeMethod, code: string): Promise<void>;
  signOut(): Promise<void>;
};

// ponytail: per-launch id; persist it with the session once a secure store exists.
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
  makeApi: (server: string, machineId: string) => ConcordApi = (s, m) =>
    new ConcordApi(s, m),
) {
  // Held only between the password step and the MFA step, never in state.
  let pendingPassword: string | null = null;

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
        await api.logout().catch(() => {});
        set({ stage: { kind: 'signed_out' }, api: null });
        throw error;
      }
      set({ identity, stage: { kind: 'signed_in', userId: api.userId } });
    };

    return {
      stage: { kind: 'signed_out' },
      busy: false,
      error: null,
      api: null,
      identity: null,

      signIn: (server, email, password) =>
        run(async () => {
          const api = makeApi(
            server.trim().replace(/\/+$/, ''),
            newMachineId(),
          );
          set({ api });
          const result = await api.login(email.trim(), password);
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
          if (!api || stage.kind !== 'mfa' || pendingPassword === null)
            throw new Error('No MFA challenge');
          const keys = await api.verifyMfa(
            stage.challengeToken,
            method,
            code.trim(),
          );
          await finish(api, keys, pendingPassword);
        }),

      signOut: async () => {
        const { api } = get();
        pendingPassword = null;
        set({
          stage: { kind: 'signed_out' },
          api: null,
          identity: null,
          error: null,
        });
        // Local state is gone first; server revocation and key release are best effort.
        await Promise.allSettled([api?.logout(), releaseAll()]);
      },
    };
  });
}

export const useSession = createSessionStore();
