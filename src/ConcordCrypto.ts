import { NativeModules } from 'react-native';

/**
 * Opaque native key handle. Key bytes never cross into JavaScript, and the identity key
 * never leaves native code. JS can still ask native code to wrap a channel key to any
 * 4096-bit public key it passes, so the JS bundle is part of the trust boundary.
 */
export type KeyHandle = string & { readonly __brand: 'ConcordKeyHandle' };

export type CreatedIdentity = {
  privateKeyHandle: KeyHandle;
  publicKeySpkiBase64: string;
  wrappedPrivateKeyBase64: string;
  keyDerivationSalt: string;
  keyDerivationAlg: 'argon2id';
};

type NativeCrypto = {
  unlockIdentity(
    password: string,
    saltBase64: string,
    wrapped: string,
  ): Promise<unknown>;
  createIdentity(password: string): Promise<unknown>;
  generateChannelKey(): Promise<unknown>;
  unwrapChannelKey(wrapped: string, privateKeyHandle: string): Promise<unknown>;
  wrapChannelKey(
    channelKeyHandle: string,
    publicKeySpkiBase64: string,
  ): Promise<unknown>;
  encryptMessage(plaintext: string, channelKeyHandle: string): Promise<unknown>;
  decryptMessage(
    ciphertextBase64: string,
    channelKeyHandle: string,
  ): Promise<unknown>;
  releaseKey(handle: string): Promise<unknown>;
  releaseAll(): Promise<unknown>;
  persistIdentity(privateKeyHandle: string, account: string): Promise<unknown>;
  loadIdentity(
    account: string,
    reason: string,
    allowUI: boolean,
  ): Promise<unknown>;
  deleteIdentity(account: string): Promise<unknown>;
  saveSession(record: string): Promise<unknown>;
  loadSession(): Promise<unknown>;
  deleteSession(): Promise<unknown>;
  randomId(): Promise<unknown>;
  downloadAttachment(
    url: string,
    headers: Record<string, string>,
    maxBytes: number,
  ): Promise<unknown>;
  decryptAttachment(
    id: string,
    channelKeyHandle: string,
    fileExtension: string,
  ): Promise<unknown>;
  readAttachmentText(uri: string, maxBytes: number): Promise<unknown>;
  clearAttachments(): Promise<unknown>;
  attachmentImageSize(uri: string): Promise<unknown>;
  deleteAttachment(uri: string): Promise<unknown>;
  /** Android only; iOS shares through React Native's Share. */
  shareAttachment?(uri: string): Promise<unknown>;
  /** iOS only: the system previewer inside the app. */
  previewAttachment?(uri: string): Promise<unknown>;
  /** Android only: the system "save as" picker. */
  saveAttachment?(uri: string): Promise<unknown>;
};

const HANDLE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
// Non-empty: native crypto output is never empty.
const BASE64 =
  /^(?=.)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function native(): NativeCrypto {
  const module = (NativeModules as { ConcordCryptoModule?: NativeCrypto })
    .ConcordCryptoModule;
  // No JavaScript fallback: without the native module there is no crypto at all.
  if (!module) throw new Error('Concord native crypto is unavailable');
  return module;
}

function handle(value: unknown): KeyHandle {
  if (typeof value !== 'string' || !HANDLE.test(value)) {
    throw new Error('Invalid native key handle');
  }
  return value as KeyHandle;
}

function base64(value: unknown): string {
  if (typeof value !== 'string' || !BASE64.test(value)) {
    throw new Error('Invalid native crypto output');
  }
  return value;
}

export async function unlockIdentity(
  password: string,
  saltBase64: string,
  wrappedPrivateKeyBase64: string,
  keyDerivationAlg: string,
): Promise<KeyHandle> {
  // Only Argon2id is implemented natively. Say so, rather than letting a legacy
  // account fail as a wrong password.
  if (keyDerivationAlg !== 'argon2id') {
    throw new Error(
      `Unsupported key derivation: ${keyDerivationAlg || 'none'}`,
    );
  }
  return handle(
    await native().unlockIdentity(
      password,
      saltBase64,
      wrappedPrivateKeyBase64,
    ),
  );
}

export async function createIdentity(
  password: string,
): Promise<CreatedIdentity> {
  const value = await native().createIdentity(password);
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid native crypto output');
  }
  const record = value as Record<string, unknown>;
  if (record.keyDerivationAlg !== 'argon2id') {
    throw new Error('Invalid native crypto output');
  }
  return {
    privateKeyHandle: handle(record.privateKeyHandle),
    publicKeySpkiBase64: base64(record.publicKeySpkiBase64),
    wrappedPrivateKeyBase64: base64(record.wrappedPrivateKeyBase64),
    keyDerivationSalt: base64(record.keyDerivationSalt),
    keyDerivationAlg: 'argon2id',
  };
}

export async function generateChannelKey(): Promise<KeyHandle> {
  return handle(await native().generateChannelKey());
}

export async function unwrapChannelKey(
  wrappedKeyBase64: string,
  privateKey: KeyHandle,
): Promise<KeyHandle> {
  return handle(await native().unwrapChannelKey(wrappedKeyBase64, privateKey));
}

export async function wrapChannelKey(
  channelKey: KeyHandle,
  publicKeySpkiBase64: string,
): Promise<string> {
  return base64(await native().wrapChannelKey(channelKey, publicKeySpkiBase64));
}

export async function encryptMessage(
  plaintext: string,
  channelKey: KeyHandle,
): Promise<string> {
  return base64(await native().encryptMessage(plaintext, channelKey));
}

export async function decryptMessage(
  ciphertextBase64: string,
  channelKey: KeyHandle,
): Promise<string> {
  const value = await native().decryptMessage(ciphertextBase64, channelKey);
  if (typeof value !== 'string')
    throw new Error('Invalid native crypto output');
  return value;
}

/** Stores an unlocked identity behind Face ID / Touch ID (device-only, current biometric set). */
export async function persistIdentity(
  privateKey: KeyHandle,
  account: string,
): Promise<void> {
  await native().persistIdentity(privateKey, account);
}

/** Reads the identity back; allowUI false must fail rather than show the biometric prompt. */
export async function loadIdentity(
  account: string,
  reason: string,
  allowUI = true,
): Promise<KeyHandle> {
  return handle(await native().loadIdentity(account, reason, allowUI));
}

export async function deleteIdentity(account: string): Promise<void> {
  await native().deleteIdentity(account);
}

/** Stores the session record (no prompt, device-only); it opens nothing without the identity. */
export async function saveSession(record: string): Promise<void> {
  await native().saveSession(record);
}

/** The stored session record, or null when there is none. */
export async function loadSession(): Promise<string | null> {
  const value = await native().loadSession();
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new Error('Invalid native crypto output');
  return value;
}

export async function deleteSession(): Promise<void> {
  await native().deleteSession();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A random lowercase UUID from the platform CSPRNG, e.g. for the machine id. */
export async function randomId(): Promise<string> {
  const value = await native().randomId();
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('Invalid native crypto output');
  return value;
}

/** The stable native rejection code, e.g. E_CONCORD_CRYPTO_NOTFOUND, or null. */
export function nativeErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('E_CONCORD_CRYPTO')
    ? code
    : null;
}

export async function releaseKey(key: KeyHandle): Promise<void> {
  await native().releaseKey(key);
}

export async function releaseAll(): Promise<void> {
  await native().releaseAll();
}

/** Downloaded ciphertext, kept natively; only its id and the response headers come back. */
export type DownloadedAttachment = {
  id: string;
  mimeType: string | null;
  /** The raw X-File-Key-Version header, or null when the server sent none. */
  keyVersion: string | null;
};

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new Error('Invalid native crypto output');
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid native crypto output');
  return value;
}

/**
 * Downloads an attachment's ciphertext natively (https only, no redirects, at most
 * `maxBytes`). The bytes never enter JavaScript.
 */
export async function downloadAttachment(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<DownloadedAttachment> {
  const value = await native().downloadAttachment(url, headers, maxBytes);
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    id: handle(record.id),
    mimeType: optionalString(record.mimeType),
    keyVersion: optionalString(record.keyVersion),
  };
}

/**
 * Decrypts a download to a private cache file and returns its file:// URI. The ciphertext is
 * deleted either way; a failure leaves no plaintext behind.
 */
export async function decryptAttachment(
  id: string,
  channelKey: KeyHandle,
  fileExtension: string,
): Promise<{ uri: string; size: number }> {
  const value = await native().decryptAttachment(id, channelKey, fileExtension);
  const record = (value ?? {}) as Record<string, unknown>;
  if (typeof record.uri !== 'string' || !record.uri.startsWith('file://'))
    throw new Error('Invalid native crypto output');
  return { uri: record.uri, size: count(record.size) };
}

/** The text of a decrypted attachment file, at most `maxBytes`, decoded as UTF-8. */
export async function readAttachmentText(
  uri: string,
  maxBytes: number,
): Promise<string> {
  const value = await native().readAttachmentText(uri, maxBytes);
  if (typeof value !== 'string')
    throw new Error('Invalid native crypto output');
  return value;
}

/** Deletes every attachment file. Native code also does this at launch. */
export async function clearAttachments(): Promise<void> {
  await native().clearAttachments();
}

/**
 * A decrypted image's pixel size, read from its header without decoding it; zero when the file
 * is not an image.
 */
export async function attachmentImageSize(
  uri: string,
): Promise<{ width: number; height: number }> {
  const value = await native().attachmentImageSize(uri);
  const record = (value ?? {}) as Record<string, unknown>;
  return { width: count(record.width), height: count(record.height) };
}

/** Deletes one decrypted attachment file. */
export async function deleteAttachment(uri: string): Promise<void> {
  await native().deleteAttachment(uri);
}

/** Android: the share sheet for a decrypted attachment file, typed by its extension. */
export async function shareAttachment(uri: string): Promise<void> {
  const module = native();
  if (!module.shareAttachment) throw new Error('Sharing is not available');
  await module.shareAttachment(uri);
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new Error('Invalid native crypto output');
  return value;
}

/**
 * iOS: shows a decrypted attachment in the system previewer. True after it opens; false when
 * the file can't be previewed or a previewer is already showing.
 */
export async function previewAttachment(uri: string): Promise<boolean> {
  const module = native();
  if (!module.previewAttachment) throw new Error('Preview is not available');
  return flag(await module.previewAttachment(uri));
}

/** Android: saves a decrypted attachment where the person picks. False when they cancel. */
export async function saveAttachment(uri: string): Promise<boolean> {
  const module = native();
  if (!module.saveAttachment) throw new Error('Saving is not available');
  return flag(await module.saveAttachment(uri));
}
