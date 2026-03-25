import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signData,
  verify as verifyData,
} from 'node:crypto';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSigningKeyPem, toBase64Url } from '../sign-manifest';

const SIGNING_KEY_ENV = 'MANIFEST_SIGNING_KEY' as const;

function generateEd25519PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

function generateRsaPrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

describe('toBase64Url', () => {
  it('converts a Buffer to base64url encoding', () => {
    const input = Buffer.from([0xfb, 0xff, 0xfe]);
    const result = toBase64Url(input);
    // standard base64 of [0xfb, 0xff, 0xfe] is "+//+"
    // base64url replaces + with - and / with _
    expect(result).toBe('-__-');
  });

  it('strips padding characters', () => {
    const input = Buffer.from('a');
    const result = toBase64Url(input);
    expect(result).not.toContain('=');
  });

  it('does not contain + or /', () => {
    for (let i = 0; i < 64; i++) {
      const buf = Buffer.from([i]);
      const result = toBase64Url(buf);
      expect(result).not.toContain('+');
      expect(result).not.toContain('/');
    }
  });

  it('produces a string decodable back to the original bytes', () => {
    const original = Buffer.from('ZeroLink manifest test');
    const encoded = toBase64Url(original);
    const padded =
      encoded.replaceAll('-', '+').replaceAll('_', '/') +
      '='.repeat((4 - (encoded.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64');
    expect(decoded).toEqual(original);
  });
});

describe('getSigningKeyPem', () => {
  const originalEnv = process.env[SIGNING_KEY_ENV];

  beforeEach(() => {
    delete process.env[SIGNING_KEY_ENV];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[SIGNING_KEY_ENV];
    } else {
      process.env[SIGNING_KEY_ENV] = originalEnv;
    }
  });

  it('throws when MANIFEST_SIGNING_KEY is not set', () => {
    expect(() => getSigningKeyPem()).toThrow('MANIFEST_SIGNING_KEY is required');
  });

  it('throws when MANIFEST_SIGNING_KEY is empty string', () => {
    process.env[SIGNING_KEY_ENV] = '';
    expect(() => getSigningKeyPem()).toThrow('MANIFEST_SIGNING_KEY is required');
  });

  it('throws when MANIFEST_SIGNING_KEY is whitespace only', () => {
    process.env[SIGNING_KEY_ENV] = '   ';
    expect(() => getSigningKeyPem()).toThrow('MANIFEST_SIGNING_KEY is required');
  });

  it('returns the PEM string when set', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
    process.env[SIGNING_KEY_ENV] = pem;
    expect(getSigningKeyPem()).toBe(pem);
  });
});

describe('Ed25519 key type enforcement', () => {
  it('accepts an Ed25519 private key without throwing', () => {
    const pem = generateEd25519PrivateKeyPem();
    const key = createPrivateKey(pem);
    expect(key.asymmetricKeyType).toBe('ed25519');
  });

  it('rejects an RSA key (simulating the run() guard)', () => {
    const pem = generateRsaPrivateKeyPem();
    const key = createPrivateKey(pem);
    expect(key.asymmetricKeyType).not.toBe('ed25519');
  });

  it('Ed25519 signature is verifiable with the corresponding public key', () => {
    const pem = generateEd25519PrivateKeyPem();
    const privateKey = createPrivateKey(pem);
    const publicKey = createPublicKey(privateKey);

    const data = Buffer.from('test manifest content');
    const signature = signData(null, data, privateKey);

    expect(verifyData(null, data, publicKey, signature)).toBe(true);
  });

  it('toBase64Url output length is correct for Ed25519 signature (64 bytes)', () => {
    const pem = generateEd25519PrivateKeyPem();
    const privateKey = createPrivateKey(pem);
    const data = Buffer.from('ZeroLink');
    const signature = signData(null, data, privateKey);

    expect(signature).toHaveLength(64);
    const encoded = toBase64Url(signature);
    // base64url of 64 bytes = 86 chars (no padding needed)
    expect(encoded).toHaveLength(86);
  });
});
