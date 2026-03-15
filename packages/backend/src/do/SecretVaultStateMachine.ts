import type { ChannelRecord } from '@zerolink/shared';
import { CHANNEL_STATE } from '@zerolink/shared';
import type { CommitDeliveryParams, CommitLockParams } from './SecretVaultTypes.ts';
import { StateTransitionError } from './SecretVaultTypes.ts';

export class SecretVaultStateMachine {
  private readonly record: ChannelRecord;

  constructor(record: ChannelRecord) {
    this.record = record;
  }

  commitLock({ receiverPubJwk, receiverPubFpr, lockedAt }: CommitLockParams): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot lock when state is ${this.record.state}`
      );
    }

    if (this.record.state !== CHANNEL_STATE.WAITING) {
      throw new StateTransitionError(
        'INVALID_TRANSITION',
        `lock transition requires waiting state, got ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.LOCKED,
      receiver: {
        pubJwk: receiverPubJwk,
        pubFpr: receiverPubFpr,
        lockedAt,
      },
    };
  }

  commitDelivery({
    cipherBundle,
    updateDeliveryProof,
    deliveredAt,
  }: CommitDeliveryParams): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot deliver when state is ${this.record.state}`
      );
    }

    if (
      this.record.state !== CHANNEL_STATE.LOCKED &&
      this.record.state !== CHANNEL_STATE.DELIVERED
    ) {
      throw new StateTransitionError(
        'INVALID_TRANSITION',
        `delivery transition requires locked or delivered state, got ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.DELIVERED,
      cipherBundle,
      ...(updateDeliveryProof ? { updateDeliveryProof } : {}),
      deliveredAt,
      version: this.record.version + 1,
    };
  }

  commitDelete(): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot delete when state is ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.DELETED,
    };
  }

  expire(): ChannelRecord {
    if (
      this.record.state === CHANNEL_STATE.DELETED ||
      this.record.state === CHANNEL_STATE.EXPIRED
    ) {
      throw new StateTransitionError(
        'TERMINAL_STATE',
        `cannot expire when state is ${this.record.state}`
      );
    }

    return {
      ...this.record,
      state: CHANNEL_STATE.EXPIRED,
    };
  }
}
