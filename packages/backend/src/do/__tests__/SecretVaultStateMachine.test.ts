import { CHANNEL_STATE } from '@zerolink/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { SecretVaultStateMachine } from '../SecretVault.ts';
import {
  asUnixMs,
  createChannelRecord,
  createCommitDeliveryParams,
  createCommitLockParams,
  expectStateTransitionError,
  setupRealReceiverKey,
} from './helpers/vault-fixtures.ts';

beforeAll(async () => {
  await setupRealReceiverKey();
});

describe('SecretVaultStateMachine', () => {
  it('transitions waiting to locked with receiver identity set', () => {
    const waiting = createChannelRecord(CHANNEL_STATE.WAITING);
    const machine = new SecretVaultStateMachine(waiting);
    const locked = machine.commitLock(createCommitLockParams());

    expect(locked.state).toBe(CHANNEL_STATE.LOCKED);
    expect(locked.receiver?.pubFpr).toBe(createCommitLockParams().receiverPubFpr);
    expect(waiting.state).toBe(CHANNEL_STATE.WAITING);
    expect(waiting.receiver).toBeUndefined();
  });

  it('transitions locked to delivered and increments version', () => {
    const lockParams = createCommitLockParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const machine = new SecretVaultStateMachine(locked);
    const delivered = machine.commitDelivery(createCommitDeliveryParams());

    expect(delivered.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(delivered.version).toBe(1);
    expect(delivered.cipherBundle).toEqual(createCommitDeliveryParams().cipherBundle);
    expect(delivered.expiresAt).toBe(locked.expiresAt);
  });

  it('updates expiresAt when a delivery intent carries an explicit override', () => {
    const lockParams = createCommitLockParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const nextExpiresAt = asUnixMs(1_730_000_900_000);

    const delivered = new SecretVaultStateMachine(locked).commitDelivery({
      ...createCommitDeliveryParams(),
      expiresAt: nextExpiresAt,
    });

    expect(delivered.expiresAt).toBe(nextExpiresAt);
  });

  it('supports delivered to delivered update transition and increments version again', () => {
    const lockParams = createCommitLockParams();
    const firstDeliveryParams = createCommitDeliveryParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const delivered = new SecretVaultStateMachine(locked).commitDelivery(firstDeliveryParams);

    const secondDelivery = new SecretVaultStateMachine(delivered).commitDelivery({
      ...firstDeliveryParams,
      deliveredAt: asUnixMs(1_730_000_400_000),
    });

    expect(secondDelivery.state).toBe(CHANNEL_STATE.DELIVERED);
    expect(secondDelivery.version).toBe(2);
    expect(secondDelivery.deliveredAt).toBe(asUnixMs(1_730_000_400_000));
  });

  it('transitions delivered to deleted', () => {
    const lockParams = createCommitLockParams();
    const deliveryParams = createCommitDeliveryParams();
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(lockParams);
    const delivered = new SecretVaultStateMachine(locked).commitDelivery(deliveryParams);
    const deleted = new SecretVaultStateMachine(delivered).commitDelete();

    expect(deleted.state).toBe(CHANNEL_STATE.DELETED);
  });

  it('transitions waiting to expired', () => {
    const expired = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).expire();
    expect(expired.state).toBe(CHANNEL_STATE.EXPIRED);
  });

  it('rejects commitLock from locked state', () => {
    const locked = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitLock(createCommitLockParams());
    expectStateTransitionError(
      () => new SecretVaultStateMachine(locked).commitLock(createCommitLockParams()),
      'INVALID_TRANSITION'
    );
  });

  it('rejects writes after deleted state', () => {
    const deleted = new SecretVaultStateMachine(
      createChannelRecord(CHANNEL_STATE.WAITING)
    ).commitDelete();
    expectStateTransitionError(
      () => new SecretVaultStateMachine(deleted).commitDelivery(createCommitDeliveryParams()),
      'TERMINAL_STATE'
    );
  });
});
