import { afterEach, describe, expect, it, vi } from 'vitest';

import { RSA_OAEP } from '../../constants.ts';
import type { RSAPublicKeyJWK } from '../../types.ts';
import {
  exportReceiverPublicKeyToJwk,
  generateReceiverKeyPair,
  importReceiverPublicKeyFromJwk,
  unwrapContentKey,
  wrapContentKey,
} from '../rsa.ts';

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('generateReceiverKeyPair', () => {
  it('generates an RSA-OAEP key pair with expected properties', async () => {
    const keyPair = await generateReceiverKeyPair();

    expect(keyPair.publicKey.type).toBe('public');
    expect(keyPair.privateKey.type).toBe('private');
    expect(keyPair.publicKey.algorithm.name).toBe(RSA_OAEP.ALGORITHM_NAME);
    expect(keyPair.privateKey.algorithm.name).toBe(RSA_OAEP.ALGORITHM_NAME);
  });

  it('throws when WebCrypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(generateReceiverKeyPair()).rejects.toThrow('WebCrypto is not available');
  });
});

describe('public key JWK import/export', () => {
  it('exports and imports RSA public JWK in expected shape', async () => {
    const keyPair = await generateReceiverKeyPair();
    const jwk = await exportReceiverPublicKeyToJwk(keyPair.publicKey);
    const imported = await importReceiverPublicKeyFromJwk(jwk);

    expect(jwk.kty).toBe('RSA');
    expect(jwk.alg).toBe('RSA-OAEP-256');
    expect(jwk.ext).toBe(true);
    expect(jwk.key_ops).toEqual(['encrypt']);
    expect(typeof jwk.n).toBe('string');
    expect(typeof jwk.e).toBe('string');
    expect(imported.type).toBe('public');
    expect(imported.algorithm.name).toBe(RSA_OAEP.ALGORITHM_NAME);
  });

  it('fails to import invalid public JWK', async () => {
    const keyPair = await generateReceiverKeyPair();
    const jwk = await exportReceiverPublicKeyToJwk(keyPair.publicKey);

    const invalidJwk = { ...jwk, alg: 'RSA-OAEP' } as unknown as RSAPublicKeyJWK;

    await expect(importReceiverPublicKeyFromJwk(invalidJwk)).rejects.toThrow(
      'Invalid RSA-OAEP public JWK'
    );
  });
});

describe('wrapContentKey / unwrapContentKey', () => {
  it('round-trips wrapped content key', async () => {
    const keyPair = await generateReceiverKeyPair();
    const contentKey = randomBytes(32);

    const wrapped = await wrapContentKey({
      receiverPublicKey: keyPair.publicKey,
      contentKey,
    });
    const unwrapped = await unwrapContentKey({
      receiverPrivateKey: keyPair.privateKey,
      wrappedKey: wrapped,
    });

    expect(unwrapped).toEqual(contentKey);
  });

  it('fails when contentKey is empty', async () => {
    const keyPair = await generateReceiverKeyPair();

    await expect(
      wrapContentKey({
        receiverPublicKey: keyPair.publicKey,
        contentKey: new Uint8Array(0),
      })
    ).rejects.toThrow('contentKey must not be empty');
  });

  it('fails wrap when key type is invalid', async () => {
    const keyPair = await generateReceiverKeyPair();
    const contentKey = randomBytes(32);

    await expect(
      wrapContentKey({
        receiverPublicKey: keyPair.privateKey,
        contentKey,
      })
    ).rejects.toThrow('RSA-OAEP wrap failed');
  });

  it('fails unwrap with wrong private key', async () => {
    const pair1 = await generateReceiverKeyPair();
    const pair2 = await generateReceiverKeyPair();
    const contentKey = randomBytes(32);

    const wrapped = await wrapContentKey({
      receiverPublicKey: pair1.publicKey,
      contentKey,
    });

    await expect(
      unwrapContentKey({
        receiverPrivateKey: pair2.privateKey,
        wrappedKey: wrapped,
      })
    ).rejects.toThrow('RSA-OAEP unwrap failed');
  });

  it('fails unwrap when wrapped key is tampered', async () => {
    const keyPair = await generateReceiverKeyPair();
    const contentKey = randomBytes(32);
    const wrapped = await wrapContentKey({
      receiverPublicKey: keyPair.publicKey,
      contentKey,
    });
    const tampered = wrapped.slice();

    tampered[0] = (tampered[0] ?? 0) ^ 0x01;

    await expect(
      unwrapContentKey({
        receiverPrivateKey: keyPair.privateKey,
        wrappedKey: tampered,
      })
    ).rejects.toThrow('RSA-OAEP unwrap failed');
  });
});
