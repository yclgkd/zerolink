import { describe, expect, it } from 'vitest';

import { AES_GCM, MAX_PLAINTEXT_BYTES } from '../../constants.ts';
import {
  decryptAesGcm,
  encryptAesGcm,
  generateAesKey,
  padPlaintext,
  unpadPlaintext,
} from '../aes.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function toText(value: Uint8Array): string {
  return decoder.decode(value);
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

describe('padPlaintext', () => {
  it('pads to a block multiple', () => {
    const padded = padPlaintext(toBytes('hello'));
    expect(padded.byteLength % AES_GCM.PAD_BLOCK_DEFAULT).toBe(0);
    expect(padded.byteLength).toBe(AES_GCM.PAD_BLOCK_DEFAULT);
  });

  it('round-trips with unpadPlaintext', () => {
    const original = toBytes('zero knowledge');
    const restored = unpadPlaintext(padPlaintext(original));
    expect(restored).toEqual(original);
  });

  it('supports empty plaintext', () => {
    const restored = unpadPlaintext(padPlaintext(new Uint8Array(0)));
    expect(restored).toHaveLength(0);
  });

  it('rejects invalid padBlock values', () => {
    const plaintext = toBytes('x');

    expect(() => padPlaintext(plaintext, 0)).toThrow('padBlock must be > 0');
    expect(() => padPlaintext(plaintext, -1)).toThrow('padBlock must be > 0');
    expect(() => padPlaintext(plaintext, 1.5)).toThrow('padBlock must be an integer');
    expect(() => padPlaintext(plaintext, AES_GCM.PAD_BLOCK_MAX + 1)).toThrow(
      `padBlock must be <= ${AES_GCM.PAD_BLOCK_MAX}`
    );
  });

  it('rejects plaintext above MAX_PLAINTEXT_BYTES', () => {
    const oversized = new Uint8Array(MAX_PLAINTEXT_BYTES + 1);
    expect(() => padPlaintext(oversized)).toThrow('plaintext exceeds MAX_PLAINTEXT_BYTES');
  });
});

describe('unpadPlaintext', () => {
  it('rejects malformed padded payloads', () => {
    expect(() => unpadPlaintext(new Uint8Array([0, 1, 2]))).toThrow(
      'padded plaintext must be at least 4 bytes'
    );
    expect(() => unpadPlaintext(new Uint8Array([0, 0, 0, 10, 1, 2, 3]))).toThrow(
      'invalid padded plaintext length prefix'
    );
  });
});

describe('AES-256-GCM', () => {
  it('generates a usable AES key and decrypts to original plaintext', async () => {
    const key = await generateAesKey();
    const plaintext = toBytes('sender secret payload');

    const encrypted = await encryptAesGcm({ key, plaintext });
    const decrypted = await decryptAesGcm({
      key,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    });

    expect(encrypted.iv.byteLength).toBe(AES_GCM.IV_LENGTH);
    expect(encrypted.padBlock).toBe(AES_GCM.PAD_BLOCK_DEFAULT);
    expect(toText(decrypted)).toBe('sender secret payload');
  });

  it('supports AAD binding', async () => {
    const key = await generateAesKey();
    const plaintext = toBytes('bound secret');
    const aad = toBytes('uuid:abc123');

    const encrypted = await encryptAesGcm({ key, plaintext, aad });
    const decrypted = await decryptAesGcm({
      key,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      aad,
    });

    expect(toText(decrypted)).toBe('bound secret');
  });

  it('fails decryption when AAD does not match', async () => {
    const key = await generateAesKey();
    const encrypted = await encryptAesGcm({
      key,
      plaintext: toBytes('aad mismatch'),
      aad: toBytes('aad:one'),
    });

    await expect(
      decryptAesGcm({
        key,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        aad: toBytes('aad:two'),
      })
    ).rejects.toThrow('AES-GCM decryption failed');
  });

  it('fails decryption when ciphertext is tampered', async () => {
    const key = await generateAesKey();
    const encrypted = await encryptAesGcm({
      key,
      plaintext: toBytes('tamper check'),
    });
    const tampered = encrypted.ciphertext.slice();

    tampered[0] = (tampered[0] ?? 0) ^ 0x01;

    await expect(
      decryptAesGcm({
        key,
        ciphertext: tampered,
        iv: encrypted.iv,
      })
    ).rejects.toThrow('AES-GCM decryption failed');
  });

  it('fails decryption when IV is tampered', async () => {
    const key = await generateAesKey();
    const encrypted = await encryptAesGcm({
      key,
      plaintext: toBytes('iv tamper'),
    });
    const tamperedIv = encrypted.iv.slice();

    tamperedIv[0] = (tamperedIv[0] ?? 0) ^ 0x01;

    await expect(
      decryptAesGcm({
        key,
        ciphertext: encrypted.ciphertext,
        iv: tamperedIv,
      })
    ).rejects.toThrow('AES-GCM decryption failed');
  });

  it('rejects invalid IV length for encrypt and decrypt', async () => {
    const key = await generateAesKey();

    await expect(
      encryptAesGcm({
        key,
        plaintext: toBytes('x'),
        iv: new Uint8Array(8),
      })
    ).rejects.toThrow(`IV must be ${AES_GCM.IV_LENGTH} bytes`);

    await expect(
      decryptAesGcm({
        key,
        ciphertext: new Uint8Array(0),
        iv: new Uint8Array(8),
      })
    ).rejects.toThrow(`IV must be ${AES_GCM.IV_LENGTH} bytes`);
  });

  it('maps plaintexts in the same bucket to the same ciphertext length', async () => {
    const key = await generateAesKey();
    const shortPlaintext = randomBytes(16);
    const longPlaintext = randomBytes(3000);

    const shortCipher = await encryptAesGcm({ key, plaintext: shortPlaintext });
    const longCipher = await encryptAesGcm({ key, plaintext: longPlaintext });

    expect(shortCipher.ciphertext.byteLength).toBe(longCipher.ciphertext.byteLength);
  });
});
