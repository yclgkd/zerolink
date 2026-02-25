import type {
  ChannelRecord,
  CipherBundle,
  HexString,
  RSAPublicKeyJWK,
  UnixMs,
} from '@zerolink/shared';
import { CHANNEL_STATE } from '@zerolink/shared';

export interface SecretVaultEnv {
  SECRET_VAULT: DurableObjectNamespace;
  SECRETS_KV: KVNamespace;
}

export interface CommitLockParams {
  receiverPubJwk: RSAPublicKeyJWK;
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface CommitDeliveryParams {
  cipherBundle: CipherBundle;
  deliveredAt: UnixMs;
}

export type StateTransitionErrorCode = 'INVALID_TRANSITION' | 'TERMINAL_STATE' | 'RECORD_NOT_FOUND';

export class StateTransitionError extends Error {
  readonly code: StateTransitionErrorCode;

  constructor(code: StateTransitionErrorCode, message: string) {
    super(message);
    this.name = 'StateTransitionError';
    this.code = code;
  }
}

export const CHANNEL_RECORD_KEY = 'channel_record' as const;

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

  commitDelivery({ cipherBundle, deliveredAt }: CommitDeliveryParams): ChannelRecord {
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

export class SecretVault {
  private readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: SecretVaultEnv) {
    this.ctx = ctx;
    void _env;
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response(JSON.stringify({ ok: false, code: 'NOT_IMPLEMENTED' }), {
      status: 501,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }

  async initialize(record: ChannelRecord): Promise<ChannelRecord> {
    await this.saveRecord(record);
    return record;
  }

  async getRecord(): Promise<ChannelRecord> {
    return this.loadRecord();
  }

  async commitLock(params: CommitLockParams): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitLock(params));
  }

  async commitDelivery(params: CommitDeliveryParams): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitDelivery(params));
  }

  async commitDelete(): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.commitDelete());
  }

  async expire(): Promise<ChannelRecord> {
    return this.applyTransition((machine) => machine.expire());
  }

  private async applyTransition(
    transition: (machine: SecretVaultStateMachine) => ChannelRecord
  ): Promise<ChannelRecord> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.loadRecord();
      const next = transition(new SecretVaultStateMachine(current));
      await this.saveRecord(next);
      return next;
    });
  }

  private async loadRecord(): Promise<ChannelRecord> {
    const record = await this.ctx.storage.get<ChannelRecord>(CHANNEL_RECORD_KEY);
    if (!record) {
      throw new StateTransitionError('RECORD_NOT_FOUND', 'channel record not initialized');
    }
    return record;
  }

  private async saveRecord(record: ChannelRecord): Promise<void> {
    await this.ctx.storage.put(CHANNEL_RECORD_KEY, record);
  }
}
