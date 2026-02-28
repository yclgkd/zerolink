import type { ECDSAPublicKeyJWK, HexString, UUID, WrappedPrivateKey } from '@zerolink/shared';

/**
 * Encapsulates the encrypted private key and receiver identity for a specific channel.
 */
export interface ReceiverKeyEnvelope {
  uuid: UUID | string;
  receiverPubFpr: HexString | string;
  wrappedPrivateKey: WrappedPrivateKey;
  updatedAt: number;
}

/**
 * Persists receiver keys securely on the local device across browser sessions.
 */
export interface ReceiverKeyStorage {
  save: (envelope: ReceiverKeyEnvelope) => Promise<void>;
  load: (uuid: UUID | string) => Promise<ReceiverKeyEnvelope | null>;
  remove: (uuid: UUID | string) => Promise<void>;
}

/**
 * Options to configure the underlying IndexedDB storage layer.
 */
export interface IndexedDbReceiverKeyStorageOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
}

interface StorageErrorLike extends Error {
  code: 'KEY_STORAGE_ERROR';
}

function keyStorageError(message: string, cause?: unknown): StorageErrorLike {
  const error = new Error(message) as StorageErrorLike;
  error.name = 'KeyStorageError';
  error.code = 'KEY_STORAGE_ERROR';
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

function assertIndexedDbAvailable(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw keyStorageError('IndexedDB is not available in this environment');
  }
  return indexedDB;
}

function requestToPromise<T>(request: IDBRequest<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(keyStorageError(`IndexedDB ${operation} request failed`, request.error));
  });
}

async function withTransaction<T>(
  dbPromise: Promise<IDBDatabase>,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await dbPromise;
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  return operation(store);
}

function initializeDatabase(
  dbName: string,
  version: number,
  storeName: string
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let idb: IDBFactory;
    try {
      idb = assertIndexedDbAvailable();
    } catch (error) {
      reject(error);
      return;
    }

    const request = idb.open(dbName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'uuid' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(keyStorageError(`IndexedDB open failed for ${dbName}`, request.error));
  });
}

/**
 * Creates the default IndexedDB-backed storage for wrapped receiver private keys.
 */
export function createIndexedDbReceiverKeyStorage(
  options: IndexedDbReceiverKeyStorageOptions = {}
): ReceiverKeyStorage {
  const dbName = options.dbName ?? 'zerolink-crypto';
  const storeName = options.storeName ?? 'receiver-keys';
  const version = options.version ?? 1;

  const dbPromise = initializeDatabase(dbName, version, storeName);

  return {
    async save(envelope) {
      await withTransaction(dbPromise, storeName, 'readwrite', async (store) => {
        await requestToPromise(store.put(envelope), 'put');
      });
    },

    async load(uuid) {
      return withTransaction(dbPromise, storeName, 'readonly', async (store) => {
        const result = await requestToPromise(store.get(uuid), 'get');
        return (result ?? null) as ReceiverKeyEnvelope | null;
      });
    },

    async remove(uuid) {
      await withTransaction(dbPromise, storeName, 'readwrite', async (store) => {
        await requestToPromise(store.delete(uuid), 'delete');
      });
    },
  };
}

// ─── Softkey Admin Storage ────────────────────────────────────────────────────

/**
 * Stores the wrapped ECDSA softkey credential for a channel (compat mode).
 * PRD §9: admin credential when WebAuthn is unavailable under Standard profile.
 */
export interface SoftkeyAdminEnvelope {
  uuid: UUID | string;
  softkeyPubJwk: ECDSAPublicKeyJWK;
  wrappedPrivateKey: WrappedPrivateKey;
  createdAt: number;
}

export interface SoftkeyAdminStorage {
  save: (envelope: SoftkeyAdminEnvelope) => Promise<void>;
  load: (uuid: UUID | string) => Promise<SoftkeyAdminEnvelope | null>;
  remove: (uuid: UUID | string) => Promise<void>;
}

export interface IndexedDbSoftkeyAdminStorageOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
}

export interface PendingSoftkeyCleanupRecord {
  uuid: UUID | string;
  markedAt: number;
}

export interface PendingSoftkeyCleanupStorage {
  mark: (uuid: UUID | string, markedAt: number) => Promise<void>;
  list: () => Promise<ReadonlyArray<PendingSoftkeyCleanupRecord>>;
  clear: (uuid: UUID | string) => Promise<void>;
}

export interface IndexedDbPendingSoftkeyCleanupStorageOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
}

/**
 * Creates the default IndexedDB-backed storage for softkey admin credentials.
 */
export function createIndexedDbSoftkeyAdminStorage(
  options: IndexedDbSoftkeyAdminStorageOptions = {}
): SoftkeyAdminStorage {
  const dbName = options.dbName ?? 'zerolink-softkey';
  const storeName = options.storeName ?? 'softkey-admin';
  const version = options.version ?? 1;

  const dbPromise = initializeDatabase(dbName, version, storeName);

  return {
    async save(envelope) {
      await withTransaction(dbPromise, storeName, 'readwrite', async (store) => {
        await requestToPromise(store.put(envelope), 'put');
      });
    },

    async load(uuid) {
      return withTransaction(dbPromise, storeName, 'readonly', async (store) => {
        const result = await requestToPromise(store.get(uuid), 'get');
        return (result ?? null) as SoftkeyAdminEnvelope | null;
      });
    },

    async remove(uuid) {
      await withTransaction(dbPromise, storeName, 'readwrite', async (store) => {
        await requestToPromise(store.delete(uuid), 'delete');
      });
    },
  };
}

/**
 * Creates the default IndexedDB-backed storage for pending softkey cleanup records.
 */
export function createIndexedDbPendingSoftkeyCleanupStorage(
  options: IndexedDbPendingSoftkeyCleanupStorageOptions = {}
): PendingSoftkeyCleanupStorage {
  const dbName = options.dbName ?? 'zerolink-softkey-cleanup';
  const storeName = options.storeName ?? 'pending-softkey-cleanup';
  const version = options.version ?? 1;

  const dbPromise = initializeDatabase(dbName, version, storeName);

  return {
    async mark(uuid, markedAt) {
      await withTransaction(dbPromise, storeName, 'readwrite', async (store) => {
        const record: PendingSoftkeyCleanupRecord = { uuid, markedAt };
        await requestToPromise(store.put(record), 'put');
      });
    },

    async list() {
      return withTransaction(dbPromise, storeName, 'readonly', async (store) => {
        const result = await requestToPromise(store.getAll(), 'getAll');
        return (result ?? []) as ReadonlyArray<PendingSoftkeyCleanupRecord>;
      });
    },

    async clear(uuid) {
      await withTransaction(dbPromise, storeName, 'readwrite', async (store) => {
        await requestToPromise(store.delete(uuid), 'delete');
      });
    },
  };
}
