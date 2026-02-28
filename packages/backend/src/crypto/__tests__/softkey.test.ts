import type { Base64Url, HexString } from '@zerolink/shared';
import { ECDSA } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import { verifySoftkeySignature } from '../softkey.ts';

const TEST_TIMEOUT_MS = 10_000;

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: ECDSA.ALGORITHM_NAME, namedCurve: ECDSA.CURVE }, true, [
    ...ECDSA.KEY_USAGES_SIGN,
    ...ECDSA.KEY_USAGES_VERIFY,
  ]);
}

async function getPublicJwk(publicKey: CryptoKey) {
  const raw = await crypto.subtle.exportKey('jwk', publicKey);
  return {
    kty: 'EC' as const,
    crv: 'P-256' as const,
    x: raw.x as Base64Url,
    y: raw.y as Base64Url,
    ext: true as const,
    key_ops: ['verify'] as const,
  };
}

async function signHex(privateKey: CryptoKey, payload: Uint8Array): Promise<HexString> {
  const sigBuf = await crypto.subtle.sign(
    { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
    privateKey,
    payload as BufferSource
  );
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') as HexString;
}

describe('verifySoftkeySignature', () => {
  it(
    'verifies a valid ECDSA P-256 signature',
    async () => {
      const keyPair = await generateKeyPair();
      const softkeyPubJwk = await getPublicJwk(keyPair.publicKey);
      const payload = new TextEncoder().encode('challenge-payload');
      const signatureHex = await signHex(keyPair.privateKey, payload);

      const result = await verifySoftkeySignature({
        softkeyPubJwk,
        payload,
        signatureHex,
      });

      expect(result.ok).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'rejects a signature made with a different key',
    async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();
      const softkeyPubJwk = await getPublicJwk(keyPair1.publicKey);
      const payload = new TextEncoder().encode('challenge-payload');
      const signatureHex = await signHex(keyPair2.privateKey, payload);

      const result = await verifySoftkeySignature({
        softkeyPubJwk,
        payload,
        signatureHex,
      });

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toBeTruthy();
    },
    TEST_TIMEOUT_MS
  );

  it(
    'rejects a signature over a different payload',
    async () => {
      const keyPair = await generateKeyPair();
      const softkeyPubJwk = await getPublicJwk(keyPair.publicKey);
      const payload = new TextEncoder().encode('original-payload');
      const differentPayload = new TextEncoder().encode('tampered-payload');
      const signatureHex = await signHex(keyPair.privateKey, payload);

      const result = await verifySoftkeySignature({
        softkeyPubJwk,
        payload: differentPayload,
        signatureHex,
      });

      expect(result.ok).toBe(false);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'rejects an invalid hex signature',
    async () => {
      const keyPair = await generateKeyPair();
      const softkeyPubJwk = await getPublicJwk(keyPair.publicKey);
      const payload = new TextEncoder().encode('challenge-payload');

      const result = await verifySoftkeySignature({
        softkeyPubJwk,
        payload,
        signatureHex: 'not-hex-at-all' as HexString,
      });

      expect(result.ok).toBe(false);
    },
    TEST_TIMEOUT_MS
  );
});
