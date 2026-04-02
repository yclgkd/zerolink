import { CHANNEL_STATE, type ChannelRecord, WS_CLOSE_CHANNEL_GONE } from '@zerolink/shared';
import { asUnixMs } from '../crypto/bytes.ts';
import { deleteMultipartChunks } from '../file-storage.ts';
import { type NonceAlarmState, reconcileNonceAlarmState } from './SecretVaultNonces.ts';
import {
  CHANNEL_RECORD_KEY,
  COMPOUND_CHALLENGE_KEY,
  CREATION_CHALLENGE_KEY,
  LOCK_CHALLENGE_KEY,
  NONCE_INDEX_KEY_PREFIX,
  NONCE_KEY_PREFIX,
  type StoredTerminalTombstone,
  TERMINAL_TOMBSTONE_KEY,
  type VaultContext,
} from './SecretVaultTypes.ts';
import { broadcastToWebSockets } from './SecretVaultWebSocket.ts';

const LEGACY_LOCK_CHALLENGE_KEY_PREFIX = 'lock_challenge:' as const;

// ---------------------------------------------------------------------------
// Record load/save helpers
// ---------------------------------------------------------------------------

export async function loadRecord(vc: VaultContext): Promise<ChannelRecord> {
  const record = await vc.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
  if (!record) {
    const { StateTransitionError } = await import('./SecretVaultTypes.ts');
    throw new StateTransitionError('RECORD_NOT_FOUND', 'channel record not initialized');
  }
  return record;
}

export async function saveRecord(vc: VaultContext, record: ChannelRecord): Promise<void> {
  await vc.ctx.storage.put(CHANNEL_RECORD_KEY, record);
}

/**
 * Load the channel record without throwing. Returns undefined if not found
 * or if the record has already reached a terminal state and must be purged.
 */
export async function tryLoadActiveRecord(
  vc: VaultContext,
  now: number = Date.now()
): Promise<ChannelRecord | undefined> {
  const record = await vc.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
  if (!record) {
    return undefined;
  }

  if (!shouldPurgeRecord(record, now)) {
    return record;
  }

  await finalizeTerminalRecord(vc, record, now);
  return undefined;
}

export async function loadActiveRecord(
  vc: VaultContext,
  now: number = Date.now()
): Promise<ChannelRecord> {
  const record = await loadRecord(vc);
  if (!shouldPurgeRecord(record, now)) {
    return record;
  }

  await finalizeTerminalRecord(vc, record, now);
  const { StateTransitionError } = await import('./SecretVaultTypes.ts');
  throw new StateTransitionError('RECORD_NOT_FOUND', 'channel record not initialized');
}

// ---------------------------------------------------------------------------
// Record expiry helpers
// ---------------------------------------------------------------------------

export function recordExpiresAt(record: ChannelRecord): number | null {
  const expiresAt = Number(record.expiresAt);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export function shouldPurgeRecord(record: ChannelRecord, now: number): boolean {
  const expiresAt = recordExpiresAt(record);
  return (
    record.state === CHANNEL_STATE.DELETED ||
    record.state === CHANNEL_STATE.EXPIRED ||
    expiresAt === null ||
    expiresAt <= now
  );
}

export function hasInvalidRecordExpiry(record: ChannelRecord): boolean {
  return recordExpiresAt(record) === null;
}

// ---------------------------------------------------------------------------
// Terminal state / purge helpers
// ---------------------------------------------------------------------------

export async function finalizeTerminalRecord(
  vc: VaultContext,
  record: ChannelRecord,
  now: number
): Promise<void> {
  if (hasInvalidRecordExpiry(record)) {
    logInvalidRecordExpiry(record);
  }
  const expiresAt = recordExpiresAt(record);
  const reason: StoredTerminalTombstone['reason'] =
    record.state === CHANNEL_STATE.DELETED
      ? 'deleted'
      : record.state === CHANNEL_STATE.EXPIRED || expiresAt === null || expiresAt <= now
        ? 'expired'
        : 'deleted';
  await finalizeTerminalState(vc, record.uuid, reason, asUnixMs(now), record.fileRef);
}

export async function finalizeTerminalState(
  vc: VaultContext,
  uuid: string,
  reason: StoredTerminalTombstone['reason'],
  finalizedAt = asUnixMs(Date.now()),
  fileRef?: ChannelRecord['fileRef']
): Promise<void> {
  await deleteMultipartChunks(vc.env.FILE_BUCKET, fileRef);
  await purgeChannelStorage(vc);
  await vc.ctx.storage.put(TERMINAL_TOMBSTONE_KEY, {
    uuid,
    reason,
    finalizedAt,
  } satisfies StoredTerminalTombstone);
}

export async function purgeExpiredRecord(
  vc: VaultContext,
  now: number
): Promise<{ purged: true } | { purged: false; record: ChannelRecord | undefined }> {
  const record = await vc.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
  if (!record || !shouldPurgeRecord(record, now)) {
    return { purged: false, record };
  }

  await finalizeTerminalRecord(vc, record, now);

  // Broadcast channel_closed to any connected clients
  broadcastToWebSockets(vc.ctx, { type: 'channel_closed', reason: 'expired' });
  closeAllWebSockets(vc.ctx, 'expired');
  return { purged: true };
}

async function purgeChannelStorage(vc: VaultContext): Promise<void> {
  const keys = await listPurgeKeys(vc);
  if (keys.length > 0) {
    await vc.ctx.storage.delete(keys);
  }
  await vc.ctx.storage.deleteAlarm();
}

async function listPurgeKeys(vc: VaultContext): Promise<string[]> {
  const [legacyLockChallengeKeys, nonceKeys, nonceIndexKeys] = await Promise.all([
    listKeysWithPrefix(vc, LEGACY_LOCK_CHALLENGE_KEY_PREFIX),
    listKeysWithPrefix(vc, NONCE_KEY_PREFIX),
    listKeysWithPrefix(vc, NONCE_INDEX_KEY_PREFIX),
  ]);

  return [
    CHANNEL_RECORD_KEY,
    CREATION_CHALLENGE_KEY,
    LOCK_CHALLENGE_KEY,
    COMPOUND_CHALLENGE_KEY,
    ...legacyLockChallengeKeys,
    ...nonceKeys,
    ...nonceIndexKeys,
  ];
}

async function listKeysWithPrefix(vc: VaultContext, prefix: string): Promise<string[]> {
  const entries = await vc.ctx.storage.list({ prefix });
  return [...entries.keys()];
}

// ---------------------------------------------------------------------------
// Alarm scheduling
// ---------------------------------------------------------------------------

export async function scheduleNextAlarm(vc: VaultContext, now: number = Date.now()): Promise<void> {
  const purgeResult = await purgeExpiredRecord(vc, now);
  if (purgeResult.purged) {
    await vc.ctx.storage.deleteAlarm();
    return;
  }

  const nonceAlarmState = await reconcileNonceAlarmState(vc.ctx.storage, now);
  logNonceAlarmState(nonceAlarmState);

  const { record } = purgeResult;
  const recordAlarmAt = record ? getRecordAlarmAt(record, now) : null;
  const nonceAlarmAt = nonceAlarmState.nextAlarmAt;
  const nextAlarmAt = getEarlierAlarm(recordAlarmAt, nonceAlarmAt);
  if (!isValidFutureAlarmAt(nextAlarmAt, now)) {
    if (nextAlarmAt !== null) {
      logRejectedAlarmCandidate(nextAlarmAt, now, recordAlarmAt, nonceAlarmAt);
    }
    await vc.ctx.storage.deleteAlarm();
    return;
  }

  await vc.ctx.storage.setAlarm(nextAlarmAt);
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

export function closeAllWebSockets(ctx: DurableObjectState, reason: string): void {
  const sockets = ctx.getWebSockets();
  for (const ws of sockets) {
    try {
      ws.close(WS_CLOSE_CHANNEL_GONE, reason);
    } catch {
      // Already closed
    }
  }
}

// ---------------------------------------------------------------------------
// Alarm helpers (private to this module)
// ---------------------------------------------------------------------------

function getRecordAlarmAt(record: ChannelRecord, now: number): number | null {
  const expiresAt = recordExpiresAt(record);
  if (expiresAt === null || expiresAt <= now) {
    return null;
  }
  return expiresAt;
}

function isValidFutureAlarmAt(candidate: number | null, now: number): candidate is number {
  return candidate !== null && Number.isFinite(candidate) && candidate > now;
}

function getEarlierAlarm(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

// ---------------------------------------------------------------------------
// Logging helpers (private to this module)
// ---------------------------------------------------------------------------

function logInvalidRecordExpiry(record: ChannelRecord): void {
  // biome-ignore lint/suspicious/noConsole: intentional production diagnostics for alarm loops
  console.warn('[SecretVault] invalid_record_expiry', {
    expiresAtType: typeof record.expiresAt,
    state: record.state,
  });
}

function logNonceAlarmState(state: NonceAlarmState): void {
  if (state.deletedExpiredEntries === 0 && state.deletedInvalidEntries === 0) {
    return;
  }

  // biome-ignore lint/suspicious/noConsole: intentional production diagnostics for alarm loops
  console.warn('[SecretVault] reconciled_nonce_alarm_state', {
    deletedExpiredEntries: state.deletedExpiredEntries,
    deletedInvalidEntries: state.deletedInvalidEntries,
    nextAlarmAt: state.nextAlarmAt,
  });
}

function logRejectedAlarmCandidate(
  nextAlarmAt: number,
  now: number,
  recordAlarmAt: number | null,
  nonceAlarmAt: number | null
): void {
  // biome-ignore lint/suspicious/noConsole: intentional production diagnostics for alarm loops
  console.warn('[SecretVault] rejected_alarm_candidate', {
    nextAlarmAt,
    nonceAlarmAt,
    now,
    recordAlarmAt,
  });
}
