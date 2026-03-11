import type { Base64Url } from '@zerolink/shared';
import {
  NONCE_INDEX_KEY_PREFIX,
  NONCE_SWEEP_BATCH_SIZE,
  type NonceIndexRecord,
  nonceStorageKey,
} from './SecretVaultTypes.ts';

export interface NonceAlarmState {
  readonly deletedExpiredEntries: number;
  readonly deletedInvalidEntries: number;
  readonly nextAlarmAt: number | null;
}

/**
 * Reconciles nonce index storage and returns the next valid future alarm time.
 * Invalid entries are deleted immediately; expired entries are swept in batches
 * until the earliest remaining entry is strictly in the future or storage is empty.
 */
export async function reconcileNonceAlarmState(
  storage: DurableObjectStorage,
  now: number
): Promise<NonceAlarmState> {
  let deletedExpiredEntries = 0;
  let deletedInvalidEntries = 0;

  while (true) {
    const nonceIndexes = await storage.list<NonceIndexRecord>({
      prefix: NONCE_INDEX_KEY_PREFIX,
      limit: NONCE_SWEEP_BATCH_SIZE,
    });
    if (nonceIndexes.size === 0) {
      return {
        deletedExpiredEntries,
        deletedInvalidEntries,
        nextAlarmAt: null,
      };
    }

    const keysToDelete: string[] = [];
    let nextAlarmAt: number | null = null;

    for (const [indexKey, indexRecord] of nonceIndexes) {
      const resolved = resolveNonceIndexEntry(indexKey, indexRecord);
      if (!resolved) {
        deletedInvalidEntries += 1;
        keysToDelete.push(indexKey);
        continue;
      }

      if (resolved.expiresAt <= now) {
        deletedExpiredEntries += 1;
        keysToDelete.push(indexKey, nonceStorageKey(resolved.nonce));
        continue;
      }

      nextAlarmAt = resolved.expiresAt;
      break;
    }

    if (keysToDelete.length > 0) {
      await storage.delete(keysToDelete);
    }

    if (nextAlarmAt !== null) {
      return {
        deletedExpiredEntries,
        deletedInvalidEntries,
        nextAlarmAt,
      };
    }

    // Defensive guard: logically unreachable because a batch with no deletions
    // must contain at least one future entry, which sets nextAlarmAt and returns
    // above. Kept as a safety valve against unexpected storage list behaviour.
    if (keysToDelete.length === 0) {
      return {
        deletedExpiredEntries,
        deletedInvalidEntries,
        nextAlarmAt: null,
      };
    }
  }
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
