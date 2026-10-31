// Test-only entry selected by ENTRY_FILE. The default app never imports this file.
import { useRef, version as reactVersion } from 'react';
import {
  AppRegistry,
  NativeModules,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import {
  createIdentity,
  decryptMessage,
  encryptMessage,
  generateChannelKey,
  nativeErrorCode,
  releaseAll,
  releaseKey,
  unlockIdentity,
  unwrapChannelKey,
  wrapChannelKey,
} from '../../src/ConcordCrypto';
import manifest from './manifest.generated';

const iosCases = [
  'layout',
  'nativeVersion',
  'hermesRuntime',
  'nativeAvailable',
  'identityRoundTrip',
  'channelRoundTrip',
  'tamperRefusal',
  'wrongPasswordRefusal',
  'wrongKindRefusal',
  'releasedHandleRefusal',
  'cleanup',
];
const androidCases = [
  'layout',
  'nativeVersion',
  'hermesRuntime',
  'nativeUnavailable',
  'missingModuleRefusal',
];
type RuntimeGlobals = {
  HermesInternal?: { getRuntimeProperties?: () => Record<string, unknown> };
  nativeLoggingHook?: (message: string, level: number) => void;
};
const runtime = globalThis as unknown as RuntimeGlobals;
const requireTrue = (value: unknown) => {
  if (!value) throw new Error('probe-check-failed');
};
async function rejects(work: () => Promise<unknown>, code: string) {
  let rejected = false;
  try {
    await work();
  } catch (error) {
    rejected = true;
    requireTrue(nativeErrorCode(error) === code);
  }
  requireTrue(rejected);
}
const tamper = (value: string) =>
  (value[0] === 'A' ? 'B' : 'A') + value.slice(1);

async function exercise() {
  const names = manifest.platform === 'ios' ? iosCases : androidCases;
  const checks: Record<string, boolean> = Object.fromEntries(
    names.map(name => [name, false]),
  );
  let current = 'layout';
  let failureCase: string | null = null;
  let rnVersion = 'unavailable';
  let ossVersion = 'unavailable';
  let build = 'unavailable';
  let nativeAvailable = false;
  const mark = (name: string) => {
    checks[name] = true;
  };
  try {
    requireTrue(/^[0-9a-f]{32}$/.test(manifest.nonce));
    requireTrue(Platform.OS === manifest.platform);
    mark('layout'); // exercise is called only by the real native onLayout callback.
    current = 'nativeVersion';
    const nativeVersion = Platform.constants.reactNativeVersion;
    rnVersion = `${nativeVersion.major}.${nativeVersion.minor}.${nativeVersion.patch}`;
    requireTrue(
      rnVersion === manifest.rnVersion &&
        reactVersion === manifest.reactVersion,
    );
    mark(current);
    current = 'hermesRuntime';
    requireTrue(
      typeof runtime.HermesInternal?.getRuntimeProperties === 'function',
    );
    const properties = runtime.HermesInternal?.getRuntimeProperties?.();
    if (
      typeof properties?.['OSS Release Version'] === 'string' &&
      /^[0-9.]{1,30}$/.test(properties['OSS Release Version'])
    ) {
      ossVersion = properties['OSS Release Version'];
    }
    if (
      typeof properties?.Build === 'string' &&
      /^[A-Za-z0-9 _.-]{1,40}$/.test(properties.Build)
    ) {
      build = properties.Build;
    }
    requireTrue(ossVersion === manifest.ossVersion && build === 'Release');
    mark(current);
    nativeAvailable =
      (NativeModules as { ConcordCryptoModule?: unknown })
        .ConcordCryptoModule != null;
    if (manifest.platform === 'android') {
      current = 'nativeUnavailable';
      requireTrue(!nativeAvailable);
      mark(current);
      current = 'missingModuleRefusal';
      let refused = false;
      try {
        await generateChannelKey();
      } catch (error) {
        refused =
          error instanceof Error &&
          error.message === 'Concord native crypto is unavailable';
      }
      requireTrue(refused);
      mark(current);
    } else {
      current = 'nativeAvailable';
      requireTrue(nativeAvailable);
      mark(current);
      current = 'identityRoundTrip';
      // Fresh per-run synthetic input, never a credential and never published.
      const password = manifest.syntheticPassword;
      requireTrue(password.length >= 32);
      const identity = await createIdentity(password);
      requireTrue(identity.keyDerivationAlg === 'argon2id');
      const unlocked = await unlockIdentity(
        password,
        identity.keyDerivationSalt,
        identity.wrappedPrivateKeyBase64,
        identity.keyDerivationAlg,
      );
      mark(current);
      current = 'channelRoundTrip';
      const channel = await generateChannelKey();
      const wrapped = await wrapChannelKey(
        channel,
        identity.publicKeySpkiBase64,
      );
      const unwrapped = await unwrapChannelKey(wrapped, unlocked);
      const text = 'Synthetic runtime: Grüße, 漢字, 👋';
      const encrypted = await encryptMessage(text, channel);
      requireTrue((await decryptMessage(encrypted, unwrapped)) === text);
      mark(current);
      current = 'tamperRefusal';
      await rejects(
        () => decryptMessage(tamper(encrypted), unwrapped),
        'E_CONCORD_CRYPTO_AUTHENTICATIONFAILED',
      );
      mark(current);
      current = 'wrongPasswordRefusal';
      await rejects(
        () =>
          unlockIdentity(
            `different-${password}`,
            identity.keyDerivationSalt,
            identity.wrappedPrivateKeyBase64,
            identity.keyDerivationAlg,
          ),
        'E_CONCORD_CRYPTO_AUTHENTICATIONFAILED',
      );
      mark(current);
      current = 'wrongKindRefusal';
      await rejects(
        () => encryptMessage(text, identity.privateKeyHandle),
        'E_CONCORD_CRYPTO_WRONGKEYKIND',
      );
      mark(current);
      current = 'releasedHandleRefusal';
      await releaseKey(channel);
      await rejects(
        () => decryptMessage(encrypted, channel),
        'E_CONCORD_CRYPTO_UNKNOWNHANDLE',
      );
      mark(current);
    }
  } catch {
    failureCase = current;
  } finally {
    if (manifest.platform === 'ios' && nativeAvailable) {
      try {
        await releaseAll();
        mark('cleanup');
      } catch {
        failureCase ??= 'cleanup';
      }
    }
  }
  const passed =
    failureCase === null && names.every(name => checks[name] === true);
  // Only version/identity metadata and fixed case booleans leave this harness. Never log
  // native return values, handles, plaintext, ciphertext, passwords or raw errors.
  runtime.nativeLoggingHook?.(
    'CONCORD_NATIVE_RUNTIME ' +
      JSON.stringify({
        schema: 1,
        nonce: manifest.nonce,
        sourceHead: manifest.sourceHead,
        platform: manifest.platform,
        rnVersion,
        reactVersion,
        hermes: { ossVersion, build },
        checks,
        passed,
        failureCase,
      }),
    1,
  );
}

function RuntimeProbe() {
  const started = useRef(false);
  return (
    <View
      style={styles.root}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (!started.current && width > 0 && height > 0) {
          started.current = true;
          exercise().catch(() => {}); // No verdict on an unexpected logger failure: the host fails closed.
        }
      }}
    />
  );
}
const styles = StyleSheet.create({ root: { flex: 1 } });
AppRegistry.registerComponent('ConcordVoice', () => RuntimeProbe);
