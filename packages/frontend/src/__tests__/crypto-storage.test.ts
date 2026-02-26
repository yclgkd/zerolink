// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { Base64UrlSchema, HexStringSchema, UUIDSchema } from '@zerolink/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIndexedDbReceiverKeyStorage, type ReceiverKeyEnvelope } from '../crypto/storage';

const VALID_UUID = UUIDSchema.parse('aaaaaaaaaaaaaaaaaaaaa');
const VALID_HEX = HexStringSchema.parse(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
);
const VALID_B64U = Base64UrlSchema.parse('bW9ja19iYXNlNjR1cmw');
const NOW = 1_700_000_000_000;

const SAMPLE_ENVELOPE: ReceiverKeyEnvelope = {
  uuid: VALID_UUID,
  receiverPubFpr: VALID_HEX,
  wrappedPrivateKey: {
    encryptedKey: VALID_B64U,
    iv: VALID_B64U,
    kdf: {
      kdfType: 'argon2id',
      version: 19,
      m: 65_536,
      t: 3,
      p: 1,
      salt: VALID_B64U,
    },
  },
  updatedAt: NOW,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('indexeddb receiver key storage', () => {
  it('saves and loads receiver key envelope', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-db-roundtrip',
      storeName: 'test-store-roundtrip',
    });

    await storage.save(SAMPLE_ENVELOPE);
    const loaded = await storage.load(SAMPLE_ENVELOPE.uuid);

    expect(loaded).toEqual(SAMPLE_ENVELOPE);
  });

  it('removes receiver key envelope by uuid', async () => {
    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-db-remove',
      storeName: 'test-store-remove',
    });

    await storage.save(SAMPLE_ENVELOPE);
    expect(await storage.load(SAMPLE_ENVELOPE.uuid)).toEqual(SAMPLE_ENVELOPE);

    await storage.remove(SAMPLE_ENVELOPE.uuid);
    expect(await storage.load(SAMPLE_ENVELOPE.uuid)).toBeNull();
  });

  it('throws KEY_STORAGE_ERROR when indexeddb API is unavailable', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
    });

    const storage = createIndexedDbReceiverKeyStorage({
      dbName: 'test-db-missing',
      storeName: 'test-store-missing',
    });

    await expect(storage.save(SAMPLE_ENVELOPE)).rejects.toMatchObject({
      code: 'KEY_STORAGE_ERROR',
    });

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDb,
    });
  });
});
