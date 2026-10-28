import { NativeModules } from 'react-native';

/**
 * Apple App Attest, for the control plane's iOS client attestation (ADR-0010 D17).
 * The attested key lives in the Secure Enclave; JS only sees its public id and the
 * base64 proofs the server verifies.
 */
export type Attester = {
  info(): Promise<AttestInfo>;
  /** Makes a new key and remembers it, replacing any previous one. */
  generateKey(): Promise<string>;
  forgetKey(): Promise<void>;
  attestKey(keyId: string, challengeBase64: string): Promise<string>;
  generateAssertion(keyId: string, challengeBase64: string): Promise<string>;
};

export type AttestInfo = {
  supported: boolean;
  /** Client-reported "1.0.0(5)"; the server uses it for revocation only. */
  version: string;
  keyId: string | null;
};

/** Native rejection when Apple no longer accepts the stored key. */
export const INVALID_KEY = 'E_CONCORD_ATTEST_INVALIDKEY';

type NativeAttest = {
  info(): Promise<unknown>;
  generateKey(): Promise<unknown>;
  forgetKey(): Promise<unknown>;
  attestKey(keyId: string, challengeBase64: string): Promise<unknown>;
  generateAssertion(keyId: string, challengeBase64: string): Promise<unknown>;
};

const BASE64 =
  /^(?=.)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function base64(value: unknown): string {
  if (typeof value !== 'string' || !BASE64.test(value)) {
    throw new Error('Invalid native attest output');
  }
  return value;
}

export function wrapAttester(module: NativeAttest): Attester {
  return {
    async info() {
      const value = await module.info();
      const r = (value ?? {}) as Record<string, unknown>;
      if (typeof r.supported !== 'boolean' || typeof r.version !== 'string') {
        throw new Error('Invalid native attest output');
      }
      return {
        supported: r.supported,
        version: r.version,
        keyId: r.keyId == null ? null : base64(r.keyId),
      };
    },
    async generateKey() {
      return base64(await module.generateKey());
    },
    async forgetKey() {
      await module.forgetKey();
    },
    async attestKey(keyId, challenge) {
      return base64(await module.attestKey(keyId, challenge));
    },
    async generateAssertion(keyId, challenge) {
      return base64(await module.generateAssertion(keyId, challenge));
    },
  };
}

/** The native attester, or null where the module is absent (Android, tests). */
export function nativeAttester(): Attester | null {
  const module = (NativeModules as { ConcordAttestModule?: NativeAttest })
    .ConcordAttestModule;
  return module ? wrapAttester(module) : null;
}
