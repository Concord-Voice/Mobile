/**
 * Control-plane client for the mobile app, carried over from the #663 probe.
 * Holds tokens in memory only; key material never passes through here.
 * Not yet covered: WebAuthn MFA. The session store persists what `saved()` returns.
 */

import { INVALID_KEY, type Attester } from '../ConcordAttest';

export type Fetch = typeof fetch;

/** What survives a relaunch: enough to rotate back into the same server session. */
export type SavedSession = {
  refreshToken: string;
  sessionId: string;
  userId: string;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: string;
};

/** Code-based second factors; WebAuthn needs a native passkey bridge first. */
export type MfaCodeMethod = 'totp' | 'backup_code' | 'email';

export type LoginResult =
  | { kind: 'signed_in'; keys: LoginKeys }
  | { kind: 'mfa'; challengeToken: string; methods: string[] };

export type LoginKeys = {
  wrappedPrivateKey: string;
  keyDerivationSalt: string;
  keyDerivationAlg: string;
};

/** A DM conversation as the conversation list shows it. */
export type DmSummary = {
  id: string;
  title: string;
  unreadCount: number;
  lastActivity: string;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string | undefined) {
    // Status and error code only: response bodies may echo user data.
    super(`Concord API ${status}${code ? ` ${code}` : ''}`);
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const CREDENTIAL_ROUTE = /^\/auth\/(login|register|mfa\/|refresh|logout)/;

/** Attestation refusals that a fresh App Attest proof can cure (ADR-0010 D17). */
const ATTEST_AND_RETRY = new Set([
  'ATTESTATION_MISSING',
  'ATTESTATION_EXPIRED',
  'ATTESTATION_INVALID',
]);

/** http only for the local dev stack; anything else must be https. */
export function checkBaseUrl(base: string): string {
  const match = /^(https?):\/\/([A-Za-z0-9.-]+)(:\d+)?$/.exec(base);
  if (!match) throw new Error('Invalid API base URL');
  if (match[1] === 'http' && !LOCAL_HOSTS.has(match[2])) {
    throw new Error('Plain http is only allowed for the local dev stack');
  }
  return base;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid API response');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid API response');
  }
  return value;
}

export class ConcordApi {
  private session: Session | null = null;
  private readonly base: string;
  /** Called when the server refuses a rotation and the session ends on its own. */
  onExpired: (() => void) | null = null;
  /** Called whenever the token pair changes, so a persisted copy never holds a spent token. */
  onRotated: (() => void) | null = null;
  /** App Attest, used only when the server asks for attestation. Null: never attest. */
  attester: Attester | null = null;
  private attestation: { token: string; sessionId: string } | null = null;
  private attesting: Promise<void> | null = null;

  constructor(
    base: string,
    private readonly machineId: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly requestTimeoutMs = 15000,
  ) {
    this.base = `${checkBaseUrl(base)}/api/v1`;
  }

  get userId(): string {
    if (!this.session) throw new Error('Not signed in');
    return this.session.userId;
  }

  wsUrl(ticket: string): string {
    return `${this.base.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(
      ticket,
    )}`;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let refreshed = false;
    let attested = false;
    for (;;) {
      try {
        return await this.request(method, path, body);
      } catch (error) {
        // Credential routes never retry: their 401 means a wrong password or code.
        if (
          !(error instanceof ApiError) ||
          !this.session ||
          CREDENTIAL_ROUTE.test(path)
        ) {
          throw error;
        }
        // An expired access token gets one refresh, and a missing or stale
        // attestation one fresh proof; each retries the request once.
        if (error.status === 401 && !refreshed) {
          refreshed = true;
          await this.refresh();
        } else if (
          error.status === 403 &&
          !attested &&
          this.attester &&
          ATTEST_AND_RETRY.has(error.code ?? '')
        ) {
          attested = true;
          try {
            await this.attest();
          } catch (proofError) {
            // No App Attest here (simulator, old device): the caller sees the refusal.
            if (!(proofError instanceof ApiError)) throw error;
            // The access token can expire while the proof is generated: refresh once
            // and start over, which allows one more proof.
            if (proofError.status !== 401 || refreshed) throw proofError;
            refreshed = true;
            attested = false;
            await this.refresh();
          }
        } else {
          throw error;
        }
      }
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      ...extraHeaders,
      Accept: 'application/json',
      'X-Machine-Id': this.machineId,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.session) {
      // A resumed session has no access token until its first rotation.
      if (this.session.accessToken)
        headers.Authorization = `Bearer ${this.session.accessToken}`;
      headers['X-Session-ID'] = this.session.sessionId;
      // The token is bound to the session that minted it.
      if (this.attestation?.sessionId === this.session.sessionId)
        headers['X-Attestation-Token'] = this.attestation.token;
    }
    // A stalled server must not hold a caller (and its native key handles) forever:
    // the abort covers the headers and the body read.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.requestTimeoutMs);
    let response: Response;
    let parsed: unknown;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Tokens travel only in headers: an ambient cookie jar would take precedence
        // server-side over the refresh token this client actually holds.
        credentials: 'omit',
        signal: abort.signal,
      });
      // Only a malformed body counts as empty; an abort or a failed body read must surface.
      parsed = await response.json().catch((error: unknown) => {
        if (error instanceof SyntaxError) return {};
        throw error;
      });
    } catch (error) {
      if (abort.signal.aborted)
        throw new Error('Concord API request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const code = (parsed as { code?: unknown } | null)?.code;
      throw new ApiError(
        response.status,
        typeof code === 'string' ? code : undefined,
      );
    }
    return record(parsed);
  }

  private adopt(result: Record<string, unknown>, userId?: string): void {
    this.session = {
      accessToken: text(result.access_token),
      refreshToken: text(result.refresh_token),
      sessionId: text(result.session_id),
      userId: userId ?? text(record(result.user).id),
    };
    this.onRotated?.();
  }

  saved(): SavedSession | null {
    if (!this.session) return null;
    const { refreshToken, sessionId, userId } = this.session;
    return { refreshToken, sessionId, userId };
  }

  /**
   * Picks a persisted session back up and rotates it. Only a refusal (401) ends it; a
   * network failure keeps it, and the next call refreshes again.
   */
  async resume(saved: SavedSession): Promise<void> {
    this.session = { accessToken: '', ...saved };
    try {
      await this.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
    }
  }

  private refreshing: Promise<void> | null = null;

  /**
   * Rotates the token pair. Concurrent callers share one request, because the server
   * revokes the presented refresh token: a second parallel rotation would replay it.
   */
  refresh(): Promise<void> {
    if (!this.session) return Promise.reject(new Error('Not signed in'));
    if (!this.refreshing) {
      // A logout or new sign-in during the rotation wins: its outcome is not overwritten.
      const current = this.session;
      this.refreshing = this.request('POST', '/auth/refresh', undefined, {
        'X-Refresh-Token': current.refreshToken,
      })
        .then(
          result => {
            if (this.session === current) this.adopt(result, current.userId);
          },
          error => {
            // A refused rotation ends the session: the caller must sign in again.
            if (
              error instanceof ApiError &&
              error.status === 401 &&
              this.session === current
            ) {
              this.session = null;
              this.onExpired?.();
            }
            throw error;
          },
        )
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  /** Revokes this session server-side; the local session is cleared even if that fails. */
  async logout(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await this.request('POST', '/auth/logout', undefined, {
        'X-Refresh-Token': session.refreshToken,
      });
    } finally {
      this.session = null;
      this.attestation = null;
    }
  }

  /**
   * Proves this is the genuine app on a genuine device with App Attest and stores
   * the server's attestation token. Reuses the stored key (an assertion) and falls
   * back to a new key (an attestation) when the server or Apple no longer knows it.
   * Concurrent callers share one run, since each proof spends a challenge.
   */
  attest(): Promise<void> {
    if (!this.attesting) {
      this.attesting = this.runAttest().finally(() => {
        this.attesting = null;
      });
    }
    return this.attesting;
  }

  private async runAttest(): Promise<void> {
    const attester = this.attester;
    const session = this.session;
    if (!attester || !session) throw new Error('Not signed in');
    const info = await attester.info();
    if (!info.supported) throw new Error('App Attest is unavailable');

    let result: Record<string, unknown> | null = null;
    if (info.keyId) {
      try {
        result = await this.prove(info.keyId, info.version, 'assertion', c =>
          attester.generateAssertion(info.keyId as string, c),
        );
      } catch (error) {
        const stale =
          (error instanceof ApiError &&
            error.code === 'ATTESTATION_KEY_UNKNOWN') ||
          (error as { code?: unknown } | null)?.code === INVALID_KEY;
        if (!stale) throw error;
        await attester.forgetKey();
      }
    }
    if (!result) {
      const keyId = await attester.generateKey();
      result = await this.prove(keyId, info.version, 'attestation', c =>
        attester.attestKey(keyId, c),
      );
    }
    // A sign-out or new sign-in meanwhile wins: its state is not overwritten.
    // A token refresh keeps the session id, so the proof still holds.
    if (this.session?.sessionId === session.sessionId) {
      this.attestation = {
        token: text(result.attestation_token),
        sessionId: session.sessionId,
      };
    }
  }

  private async prove(
    keyId: string,
    version: string,
    field: 'attestation' | 'assertion',
    sign: (challenge: string) => Promise<string>,
  ): Promise<Record<string, unknown>> {
    const challenge = text(
      (await this.request('POST', '/attestation/challenge')).challenge,
    );
    return this.request('POST', '/attestation/verify', {
      version,
      platform: 'ios',
      machine_id: this.machineId,
      key_id: keyId,
      challenge,
      [field]: await sign(challenge),
    });
  }

  private loginKeys(result: Record<string, unknown>): LoginKeys {
    const keys = record(result.e2ee_keys);
    return {
      wrappedPrivateKey: text(keys.wrapped_private_key),
      keyDerivationSalt: text(keys.key_derivation_salt),
      keyDerivationAlg: text(keys.key_derivation_alg),
    };
  }

  async register(input: {
    email: string;
    username: string;
    password: string;
    publicKey: string;
    wrappedPrivateKey: string;
    keyDerivationSalt: string;
  }): Promise<string> {
    const result = await this.call('POST', '/auth/register', {
      email: input.email,
      username: input.username,
      password: input.password,
      age_confirmation: true,
      public_key: input.publicKey,
      wrapped_private_key: input.wrappedPrivateKey,
      key_derivation_salt: input.keyDerivationSalt,
      key_derivation_alg: 'argon2id',
    });
    return text(result.pending_id);
  }

  async confirm(pendingId: string, code: string): Promise<void> {
    this.adopt(
      await this.call('POST', '/auth/register/confirm', {
        pending_id: pendingId,
        code,
      }),
    );
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.call('POST', '/auth/login', {
      email,
      password,
      remember_me: true,
    });
    if (result.mfa_required === true) {
      const methods = Array.isArray(result.methods)
        ? result.methods.filter((m): m is string => typeof m === 'string')
        : [];
      return {
        kind: 'mfa',
        challengeToken: text(result.mfa_challenge_token),
        methods,
      };
    }
    const keys = this.loginKeys(result);
    this.adopt(result);
    return { kind: 'signed_in', keys };
  }

  /** Asks the server to email a login code for an MFA challenge. */
  async sendMfaEmail(challengeToken: string): Promise<void> {
    await this.call('POST', '/auth/mfa/email/send', {
      mfa_challenge_token: challengeToken,
    });
  }

  async verifyMfa(
    challengeToken: string,
    method: MfaCodeMethod,
    code: string,
  ): Promise<LoginKeys> {
    const result = await this.call('POST', '/auth/mfa/verify', {
      mfa_challenge_token: challengeToken,
      method,
      code,
    });
    const keys = this.loginKeys(result);
    this.adopt(result);
    return keys;
  }

  async findUserId(username: string): Promise<string> {
    const result = await this.call(
      'GET',
      `/users/search?q=${encodeURIComponent(username)}`,
    );
    const users = Array.isArray(result.users) ? result.users.map(record) : [];
    const hit = users.find(u => u.username === username);
    if (!hit) throw new Error('User not found');
    return text(hit.id);
  }

  /** The current public key and its key_version, which a wrap must be reported against. */
  async publicKey(
    userId: string,
  ): Promise<{ publicKey: string; keyVersion: number }> {
    const result = await this.call(
      'GET',
      `/users/${encodeURIComponent(userId)}/public-key`,
    );
    const keyVersion = result.key_version;
    if (
      typeof keyVersion !== 'number' ||
      !Number.isSafeInteger(keyVersion) ||
      keyVersion < 1
    )
      throw new Error('Invalid API response');
    return { publicKey: text(result.public_key), keyVersion };
  }

  async openDm(userId: string): Promise<string> {
    const result = await this.call('POST', '/dm/conversations', {
      user_id: userId,
    });
    return text(record(result.conversation).id);
  }

  async distributeDmKey(
    conversationId: string,
    wrappedKeys: Record<string, string>,
    wrappedKeyVersions: Record<string, number>,
  ): Promise<void> {
    // The versions let the server refuse a wrap made against a key that rotated meanwhile.
    await this.call(
      'POST',
      `/e2ee/keys/${encodeURIComponent(conversationId)}`,
      {
        wrapped_keys: wrappedKeys,
        wrapped_key_versions: wrappedKeyVersions,
      },
    );
  }

  async dmMessages(
    conversationId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.call(
      'GET',
      `/dm/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    return Array.isArray(result.messages) ? result.messages.map(record) : [];
  }

  /** The caller's DM conversations, newest activity first as the server orders them. */
  async conversations(): Promise<DmSummary[]> {
    const me = this.userId;
    const result = await this.call('GET', '/dm/conversations');
    const list = Array.isArray(result.conversations)
      ? result.conversations.map(record)
      : [];
    return list.map(c => {
      const others = (Array.isArray(c.participants) ? c.participants : [])
        .map(record)
        .filter(p => p.user_id !== me)
        .map(p =>
          typeof p.display_name === 'string' && p.display_name
            ? p.display_name
            : text(p.username),
        );
      const last = c.last_message ? record(c.last_message) : null;
      return {
        id: text(c.id),
        title:
          typeof c.name === 'string' && c.name
            ? c.name
            : others.join(', ') || 'Notes to self',
        unreadCount: Number.isSafeInteger(c.unread_count)
          ? (c.unread_count as number)
          : 0,
        lastActivity: text(last ? last.created_at : c.created_at),
      };
    });
  }

  async wsTicket(): Promise<string> {
    return text((await this.call('POST', '/auth/ws-ticket')).ticket);
  }
}
