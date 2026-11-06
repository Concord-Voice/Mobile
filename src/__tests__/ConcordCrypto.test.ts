import { NativeModules } from 'react-native';
import {
  attachmentImageSize,
  clearAttachments,
  createIdentity,
  decryptAttachment,
  decryptMessage,
  deleteAttachment,
  deleteIdentity,
  deleteSession,
  downloadAttachment,
  encryptMessage,
  generateChannelKey,
  loadIdentity,
  loadSession,
  nativeErrorCode,
  persistIdentity,
  randomId,
  readAttachmentText,
  releaseAll,
  releaseKey,
  saveSession,
  shareAttachment,
  unlockIdentity,
  unwrapChannelKey,
  wrapChannelKey,
  type KeyHandle,
} from '../ConcordCrypto';

const HANDLE = '0F8FAD5B-D9CB-469F-A165-70867728950E';
const nativeModules = NativeModules as typeof NativeModules & {
  ConcordCryptoModule?: Record<string, jest.Mock>;
};

function install(overrides: Record<string, jest.Mock> = {}) {
  nativeModules.ConcordCryptoModule = {
    unlockIdentity: jest.fn().mockResolvedValue(HANDLE),
    createIdentity: jest.fn().mockResolvedValue({
      privateKeyHandle: HANDLE,
      publicKeySpkiBase64: 'AAAA',
      wrappedPrivateKeyBase64: 'AAE=', // pragma: allowlist secret
      keyDerivationSalt: 'AA==',
      keyDerivationAlg: 'argon2id',
    }),
    generateChannelKey: jest.fn().mockResolvedValue(HANDLE),
    unwrapChannelKey: jest.fn().mockResolvedValue(HANDLE),
    wrapChannelKey: jest.fn().mockResolvedValue('AAAA'),
    encryptMessage: jest.fn().mockResolvedValue('AAAA'),
    decryptMessage: jest.fn().mockResolvedValue('hello'),
    releaseKey: jest.fn().mockResolvedValue(null),
    releaseAll: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  return nativeModules.ConcordCryptoModule;
}

const key = HANDLE as KeyHandle;

afterEach(() => {
  delete nativeModules.ConcordCryptoModule;
});

describe('ConcordCrypto', () => {
  it('passes calls through and returns validated handles and base64', async () => {
    const module = install();
    expect(await unlockIdentity('pw', 'AA==', 'AAAA', 'argon2id')).toBe(HANDLE);
    expect(module.unlockIdentity).toHaveBeenCalledWith('pw', 'AA==', 'AAAA');
    expect((await createIdentity('pw')).privateKeyHandle).toBe(HANDLE);
    expect(await generateChannelKey()).toBe(HANDLE);
    expect(await unwrapChannelKey('AAAB', key)).toBe(HANDLE);
    expect(module.unwrapChannelKey).toHaveBeenCalledWith('AAAB', HANDLE);
    expect(await wrapChannelKey(key, 'AAAC')).toBe('AAAA');
    expect(module.wrapChannelKey).toHaveBeenCalledWith(HANDLE, 'AAAC');
    expect(await encryptMessage('hello', key)).toBe('AAAA');
    expect(await decryptMessage('AAAA', key)).toBe('hello');
    await releaseKey(key);
    await releaseAll();
    expect(module.releaseKey).toHaveBeenCalledWith(HANDLE);
    expect(module.releaseAll).toHaveBeenCalled();
  });

  it('fails closed when the native module is missing', async () => {
    await expect(generateChannelKey()).rejects.toThrow(
      'Concord native crypto is unavailable',
    );
  });

  it('rejects malformed native output', async () => {
    install({
      generateChannelKey: jest.fn().mockResolvedValue('not-a-handle'),
      encryptMessage: jest.fn().mockResolvedValue('***'),
      decryptMessage: jest.fn().mockResolvedValue(42),
      createIdentity: jest
        .fn()
        .mockResolvedValue({ keyDerivationAlg: 'pbkdf2' }),
    });
    await expect(generateChannelKey()).rejects.toThrow(
      'Invalid native key handle',
    );
    await expect(encryptMessage('x', key)).rejects.toThrow(
      'Invalid native crypto output',
    );
    await expect(decryptMessage('AAAA', key)).rejects.toThrow(
      'Invalid native crypto output',
    );
    await expect(createIdentity('pw')).rejects.toThrow(
      'Invalid native crypto output',
    );
  });

  it('rejects a non-object identity and propagates native rejections', async () => {
    install({
      createIdentity: jest.fn().mockResolvedValue(null),
      unlockIdentity: jest
        .fn()
        .mockRejectedValue(new Error('E_CONCORD_CRYPTO')),
    });
    await expect(createIdentity('pw')).rejects.toThrow(
      'Invalid native crypto output',
    );
    await expect(
      unlockIdentity('pw', 'AA==', 'AAAA', 'argon2id'),
    ).rejects.toThrow('E_CONCORD_CRYPTO');
  });

  it('refuses a key derivation it does not implement before calling native', async () => {
    const module = install();
    await expect(
      unlockIdentity('pw', 'AA==', 'AAAA', 'pbkdf2'),
    ).rejects.toThrow('Unsupported key derivation: pbkdf2');
    await expect(unlockIdentity('pw', 'AA==', 'AAAA', '')).rejects.toThrow(
      'Unsupported key derivation: none',
    );
    expect(module.unlockIdentity).not.toHaveBeenCalled();
  });

  it('rejects empty native output', async () => {
    install({ encryptMessage: jest.fn().mockResolvedValue('') });
    await expect(encryptMessage('hello', key)).rejects.toThrow(
      'Invalid native crypto output',
    );
  });

  it('stores, loads and deletes the identity through the native Keychain', async () => {
    const module = install({
      persistIdentity: jest.fn().mockResolvedValue(null),
      loadIdentity: jest.fn().mockResolvedValue(HANDLE),
      deleteIdentity: jest.fn().mockResolvedValue(null),
    });
    await persistIdentity(key, 'acct');
    expect(await loadIdentity('acct', 'Unlock', false)).toBe(HANDLE);
    await deleteIdentity('acct');
    expect(module.persistIdentity).toHaveBeenCalledWith(HANDLE, 'acct');
    expect(module.loadIdentity).toHaveBeenCalledWith('acct', 'Unlock', false);
    expect(module.deleteIdentity).toHaveBeenCalledWith('acct');
    expect(nativeErrorCode({ code: 'E_CONCORD_CRYPTO_NOTFOUND' })).toBe(
      'E_CONCORD_CRYPTO_NOTFOUND',
    );
    expect(nativeErrorCode({ code: 'ENOENT' })).toBeNull();
  });

  it('passes the session record through and checks native output', async () => {
    const module = install({
      saveSession: jest.fn().mockResolvedValue(null),
      loadSession: jest.fn().mockResolvedValueOnce('{"a":1}'),
      deleteSession: jest.fn().mockResolvedValue(null),
      randomId: jest
        .fn()
        .mockResolvedValueOnce('0f8fad5b-d9cb-469f-a165-70867728950e')
        .mockResolvedValueOnce('nope'),
    });
    await saveSession('rec');
    expect(module.saveSession).toHaveBeenCalledWith('rec');
    expect(await loadSession()).toBe('{"a":1}');
    module.loadSession.mockResolvedValueOnce(undefined);
    expect(await loadSession()).toBeNull();
    module.loadSession.mockResolvedValueOnce(42);
    await expect(loadSession()).rejects.toThrow('Invalid native crypto output');
    await deleteSession();
    expect(module.deleteSession).toHaveBeenCalled();
    expect(await randomId()).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    await expect(randomId()).rejects.toThrow('Invalid native crypto output');
  });

  it('keeps attachment bytes native and checks what comes back', async () => {
    const download = { id: HANDLE, mimeType: null, keyVersion: '3' };
    const module = install({
      downloadAttachment: jest.fn().mockResolvedValue(download),
      decryptAttachment: jest
        .fn()
        .mockResolvedValue({ uri: 'file:///c/a.png', size: 12 }),
      clearAttachments: jest.fn().mockResolvedValue(null),
      attachmentImageSize: jest
        .fn()
        .mockResolvedValue({ width: 640, height: 480 }),
      deleteAttachment: jest.fn().mockResolvedValue(null),
      shareAttachment: jest.fn().mockResolvedValue(null),
    });
    expect(await downloadAttachment('https://h/a', { A: 'b' }, 40)).toEqual(
      download,
    );
    expect(module.downloadAttachment).toHaveBeenCalledWith(
      'https://h/a',
      { A: 'b' },
      40,
    );
    for (const bad of [
      { ...download, id: '../x' },
      { ...download, mimeType: 7 },
      { ...download, keyVersion: 3 },
      null,
    ]) {
      module.downloadAttachment.mockResolvedValueOnce(bad);
      await expect(downloadAttachment('https://h/a', {}, 40)).rejects.toThrow();
    }
    expect(await decryptAttachment(HANDLE, key, 'png')).toEqual({
      uri: 'file:///c/a.png',
      size: 12,
    });
    expect(module.decryptAttachment).toHaveBeenCalledWith(HANDLE, key, 'png');
    // Plaintext is only ever a local file, with a whole size.
    for (const bad of [
      { uri: 'https://h/a', size: 1 },
      { uri: 'file:///c/a.png' },
      { uri: 'file:///c/a.png', size: -1 },
    ]) {
      module.decryptAttachment.mockResolvedValueOnce(bad);
      await expect(decryptAttachment(HANDLE, key, 'png')).rejects.toThrow(
        'Invalid native crypto output',
      );
    }
    module.readAttachmentText = jest
      .fn()
      .mockResolvedValueOnce('hi')
      .mockResolvedValueOnce(7);
    expect(await readAttachmentText('file:///c/a.txt', 10)).toBe('hi');
    expect(module.readAttachmentText).toHaveBeenCalledWith(
      'file:///c/a.txt',
      10,
    );
    await expect(readAttachmentText('file:///c/a.txt', 10)).rejects.toThrow(
      'Invalid native crypto output',
    );
    await clearAttachments();
    expect(module.clearAttachments).toHaveBeenCalled();
    expect(await attachmentImageSize('file:///c/a.png')).toEqual({
      width: 640,
      height: 480,
    });
    for (const bad of [{ width: -1, height: 1 }, { width: 1.5 }, null]) {
      module.attachmentImageSize.mockResolvedValueOnce(bad);
      await expect(attachmentImageSize('file:///c/a.png')).rejects.toThrow(
        'Invalid native crypto output',
      );
    }
    await deleteAttachment('file:///c/a.png');
    expect(module.deleteAttachment).toHaveBeenCalledWith('file:///c/a.png');
    await shareAttachment('file:///c/a.png');
    expect(module.shareAttachment).toHaveBeenCalledWith('file:///c/a.png');
    // iOS has no native share; it uses React Native's.
    delete module.shareAttachment;
    await expect(shareAttachment('file:///c/a.png')).rejects.toThrow(
      'Sharing is not available',
    );
  });

  it('rejects a malformed handle from the Keychain', async () => {
    install({ loadIdentity: jest.fn().mockResolvedValue('not-a-handle') });
    await expect(loadIdentity('acct', 'Unlock')).rejects.toThrow();
  });
});
