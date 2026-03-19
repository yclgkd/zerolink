// @vitest-environment jsdom

import { ARGON2ID, Base64UrlSchema, ECDSA, WrappedPrivateKeySchema } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import {
  exportSoftkeyPublicJwk,
  generateSoftkeyPair,
  softkeySign,
  unwrapSoftkeyPrivateKey,
  wrapSoftkeyPrivateKey,
} from '../crypto/softkey';
import { FAST_TEST_ARGON2ID_KDF_PARAMS } from './helpers/crypto-test-params';

const TEST_TIMEOUT_MS = 30_000;
const PASSPHRASE = 'test-passphrase-for-softkey';

describe('generateSoftkeyPair', () => {
  it(
    'generates an extractable ECDSA P-256 keypair with correct per-key usages',
    async () => {
      const keyPair = await generateSoftkeyPair();

      expect(keyPair.privateKey.type).toBe('private');
      expect(keyPair.publicKey.type).toBe('public');
      expect(keyPair.privateKey.algorithm.name).toBe(ECDSA.ALGORITHM_NAME);
      expect((keyPair.privateKey.algorithm as EcKeyAlgorithm).namedCurve).toBe(ECDSA.CURVE);
      expect(keyPair.privateKey.extractable).toBe(true);
      // WebCrypto assigns "sign" to the private key and "verify" to the public
      // key from the combined ["sign","verify"] usage list — the private key
      // must NOT have "verify" regardless of what was passed to generateKey.
      expect(keyPair.privateKey.usages).toEqual(['sign']);
      expect(keyPair.publicKey.usages).toEqual(['verify']);
    },
    TEST_TIMEOUT_MS
  );
});

describe('exportSoftkeyPublicJwk', () => {
  it(
    'exports ECDSA public key as JWK matching ECDSAPublicKeyJWK shape',
    async () => {
      const keyPair = await generateSoftkeyPair();
      const jwk = await exportSoftkeyPublicJwk(keyPair.publicKey);

      expect(jwk.kty).toBe('EC');
      expect(jwk.crv).toBe('P-256');
      expect(jwk.ext).toBe(true);
      expect(jwk.key_ops).toEqual(['verify']);
      expect(typeof jwk.x).toBe('string');
      expect(typeof jwk.y).toBe('string');
      // x and y should be valid base64url
      expect(() => Base64UrlSchema.parse(jwk.x)).not.toThrow();
      expect(() => Base64UrlSchema.parse(jwk.y)).not.toThrow();
    },
    TEST_TIMEOUT_MS
  );
});

describe('wrapSoftkeyPrivateKey / unwrapSoftkeyPrivateKey', () => {
  it(
    'round-trips: wrap then unwrap yields a usable signing key',
    async () => {
      const keyPair = await generateSoftkeyPair();
      const wrapped = await wrapSoftkeyPrivateKey(keyPair.privateKey, PASSPHRASE);

      // Wrapped output should conform to WrappedPrivateKey schema
      expect(() => WrappedPrivateKeySchema.parse(wrapped)).not.toThrow();
      expect(wrapped.kdf).toMatchObject({
        kdfType: 'argon2id',
        version: 19,
        m: ARGON2ID.MEMORY_COST_KB,
        t: ARGON2ID.TIME_COST,
        p: ARGON2ID.PARALLELISM,
      });

      const unwrapped = await unwrapSoftkeyPrivateKey(wrapped, PASSPHRASE);
      expect(unwrapped.type).toBe('private');
      expect(unwrapped.usages).toContain('sign');

      // Verify the unwrapped key can sign and the original public key verifies
      const payload = crypto.getRandomValues(new Uint8Array(32));
      const sig = await crypto.subtle.sign(
        { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
        unwrapped,
        payload
      );
      const verified = await crypto.subtle.verify(
        { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
        keyPair.publicKey,
        sig,
        payload
      );

      expect(verified).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'unwrap fails with wrong passphrase',
    async () => {
      const keyPair = await generateSoftkeyPair();
      const wrapped = await wrapSoftkeyPrivateKey(
        keyPair.privateKey,
        PASSPHRASE,
        FAST_TEST_ARGON2ID_KDF_PARAMS
      );

      await expect(unwrapSoftkeyPrivateKey(wrapped, 'wrong-passphrase')).rejects.toThrow();
    },
    TEST_TIMEOUT_MS
  );

  it(
    'wrap rejects empty passphrase',
    async () => {
      const keyPair = await generateSoftkeyPair();

      await expect(wrapSoftkeyPrivateKey(keyPair.privateKey, '')).rejects.toThrow();
    },
    TEST_TIMEOUT_MS
  );
});

describe('softkeySign', () => {
  it(
    'produces a non-empty hex signature verifiable by the public key',
    async () => {
      const keyPair = await generateSoftkeyPair();
      const payload = new TextEncoder().encode('{"op":"delete","uuid":"aaaaaaaaaaaaaaaaaaaaa"}');

      const sig = await softkeySign(keyPair.privateKey, payload);

      // Must be a lowercase hex string
      expect(sig).toMatch(/^[0-9a-f]+$/);
      // IEEE P1363 for P-256: 64 bytes = 128 hex chars
      expect(sig.length).toBe(128);

      // Verify the signature
      const sigBytes = Uint8Array.from(
        (sig.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16))
      );
      const verified = await crypto.subtle.verify(
        { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
        keyPair.publicKey,
        sigBytes,
        payload
      );

      expect(verified).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'signatures are payload-bound: sig over payload1 does not verify against payload2',
    async () => {
      const keyPair = await generateSoftkeyPair();
      const payload1 = new TextEncoder().encode('payload-one');
      const payload2 = new TextEncoder().encode('payload-two');

      const sig1 = await softkeySign(keyPair.privateKey, payload1);
      const sig2 = await softkeySign(keyPair.privateKey, payload2);

      expect(sig1).not.toBe(sig2);

      // Cross-verify: sig1 must not verify against payload2 (and vice versa)
      const sig1Bytes = Uint8Array.from(
        (sig1.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16))
      );
      const sig2Bytes = Uint8Array.from(
        (sig2.match(/.{2}/g) ?? []).map((b) => Number.parseInt(b, 16))
      );

      const sig1AgainstPayload2 = await crypto.subtle.verify(
        { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
        keyPair.publicKey,
        sig1Bytes,
        payload2
      );
      const sig2AgainstPayload1 = await crypto.subtle.verify(
        { name: ECDSA.ALGORITHM_NAME, hash: ECDSA.HASH_ALGORITHM },
        keyPair.publicKey,
        sig2Bytes,
        payload1
      );

      expect(sig1AgainstPayload2).toBe(false);
      expect(sig2AgainstPayload1).toBe(false);
    },
    TEST_TIMEOUT_MS
  );
});
