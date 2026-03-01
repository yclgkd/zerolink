import type { Base64Url } from '@zerolink/shared';
import {
  NONCE_INDEX_KEY_PREFIX,
  NONCE_SWEEP_BATCH_SIZE,
  NONCE_SWEEP_RETRY_DELAY_MS,
  type NonceIndexRecord,
  nonceStorageKey,
} from './SecretVaultTypes.ts';

/**
 * Removes expired nonce entries from storage.
 * Iterates through the nonce index in sorted order and deletes expired records.
 */
export async function sweepExpiredNonces(
  storage: DurableObjectStorage,
  now: number
): Promise<void> {
  const nonceIndexes = await storage.list<NonceIndexRecord>({
    prefix: NONCE_INDEX_KEY_PREFIX,
    limit: NONCE_SWEEP_BATCH_SIZE,
  });
  if (nonceIndexes.size === 0) {
    return;
  }

  const keysToDelete: string[] = [];
  for (const [indexKey, indexRecord] of nonceIndexes) {
    const resolved = resolveNonceIndexEntry(indexKey, indexRecord);
    if (!resolved) {
      keysToDelete.push(indexKey);
      continue;
    }
    if (resolved.expiresAt > now) {
      break;
    }

    keysToDelete.push(indexKey, nonceStorageKey(resolved.nonce));
  }

  if (keysToDelete.length > 0) {
    await storage.delete(keysToDelete);
  }
}

/**
 * Schedules the next alarm for nonce cleanup based on the earliest pending expiry.
 */
export async function scheduleNextNonceCleanup(
  storage: DurableObjectStorage,
  now: number
): Promise<void> {
  while (true) {
    const firstEntry = await readEarliestNonceIndexEntry(storage);
    if (!firstEntry) {
      await storage.deleteAlarm();
      return;
    }

    const [indexKey, indexRecord] = firstEntry;
    const resolved = resolveNonceIndexEntry(indexKey, indexRecord);
    if (!resolved) {
      await storage.delete(indexKey);
      continue;
    }

    const nextAlarmAt =
      resolved.expiresAt <= now ? now + NONCE_SWEEP_RETRY_DELAY_MS : resolved.expiresAt;
    await storage.setAlarm(nextAlarmAt);
    return;
  }
}

async function readEarliestNonceIndexEntry(
  storage: DurableObjectStorage
): Promise<[string, NonceIndexRecord | undefined] | undefined> {
  const nonceIndexes = await storage.list<NonceIndexRecord>({
    prefix: NONCE_INDEX_KEY_PREFIX,
    limit: 1,
  });
  const firstEntry = nonceIndexes.entries().next().value;
  if (!firstEntry) {
    return undefined;
  }

  return [firstEntry[0], firstEntry[1]];
}

function resolveNonceIndexEntry(
  indexKey: string,
  indexRecord: NonceIndexRecord | undefined
): { nonce: Base64Url; expiresAt: number } | undefined {
  if (
    indexRecord &&
    typeof indexRecord.nonce === 'string' &&
    Number.isFinite(indexRecord.expiresAt)
  ) {
    return {
      nonce: indexRecord.nonce,
      expiresAt: Number(indexRecord.expiresAt),
    };
  }

  const suffix = indexKey.slice(NONCE_INDEX_KEY_PREFIX.length);
  const separator = suffix.indexOf(':');
  if (separator <= 0 || separator === suffix.length - 1) {
    return undefined;
  }

  const expiresAt = Number.parseInt(suffix.slice(0, separator), 10);
  if (!Number.isFinite(expiresAt)) {
    return undefined;
  }

  return {
    nonce: suffix.slice(separator + 1) as Base64Url,
    expiresAt,
  };
}
