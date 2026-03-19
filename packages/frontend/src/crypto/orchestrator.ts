import { apiClient as defaultApiClient } from '../api/client';
import { useCreateStore, useDecryptStore, useDeliverStore, useLockStore } from '../stores';
import { executeCreateChannel } from './orchestrator-create';
import { executeDecryptDelivered } from './orchestrator-decrypt';
import { executeDeleteChannel } from './orchestrator-delete';
import { executeDeliverSecret } from './orchestrator-deliver';
import { executeLockChannel } from './orchestrator-lock';
import type { ResolvedDeps } from './orchestrator-types';
import { createIndexedDbReceiverKeyStorage } from './storage';

// Re-export the full public surface so existing imports from './orchestrator' continue to work.
export type {
  CreateChannelInput,
  CreateChannelOutput,
  CryptoOrchestrator,
  CryptoOrchestratorDeps,
  CryptoOrchestratorError,
  CryptoOrchestratorErrorCode,
  CryptoOrchestratorResult,
  DecryptDeliveredInput,
  DecryptDeliveredOutput,
  DeleteChannelInput,
  DeleteChannelOutput,
  DeliverSecretInput,
  DeliverSecretOutput,
  LockChannelInput,
  LockChannelOutput,
} from './orchestrator-types';

/**
 * Creates and configures the main cryptographic orchestrator instance.
 */
export function createCryptoOrchestrator(
  deps: import('./orchestrator-types').CryptoOrchestratorDeps = {}
): import('./orchestrator-types').CryptoOrchestrator {
  const resolved: ResolvedDeps = {
    client: deps.apiClient ?? defaultApiClient,
    receiverKeyStorage: deps.receiverKeyStorage ?? createIndexedDbReceiverKeyStorage(),
    createStore: deps.createStore ?? useCreateStore,
    lockStore: deps.lockStore ?? useLockStore,
    deliverStore: deps.deliverStore ?? useDeliverStore,
    decryptStore: deps.decryptStore ?? useDecryptStore,
    now: deps.now ?? (() => Date.now()),
    randomBytes:
      deps.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length))),
    kdfParams: deps.kdfParams,
  };

  let createChannelQueue = Promise.resolve();

  return {
    createChannel: (input) => {
      const next = createChannelQueue.then(() => executeCreateChannel(resolved, input));
      createChannelQueue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    lockChannel: (input) => executeLockChannel(resolved, input),
    deliverSecret: (input) => executeDeliverSecret(resolved, input),
    deleteChannel: (input) => executeDeleteChannel(resolved, input),
    decryptDelivered: (input) => executeDecryptDelivered(resolved, input),
  };
}

/**
 * Default singleton instance of the CryptoOrchestrator.
 */
let defaultCryptoOrchestrator: import('./orchestrator-types').CryptoOrchestrator | null = null;

function getDefaultCryptoOrchestrator(): import('./orchestrator-types').CryptoOrchestrator {
  if (!defaultCryptoOrchestrator) {
    defaultCryptoOrchestrator = createCryptoOrchestrator();
  }
  return defaultCryptoOrchestrator;
}

export const cryptoOrchestrator: import('./orchestrator-types').CryptoOrchestrator = {
  createChannel: (input) => getDefaultCryptoOrchestrator().createChannel(input),
  lockChannel: (input) => getDefaultCryptoOrchestrator().lockChannel(input),
  deliverSecret: (input) => getDefaultCryptoOrchestrator().deliverSecret(input),
  deleteChannel: (input) => getDefaultCryptoOrchestrator().deleteChannel(input),
  decryptDelivered: (input) => getDefaultCryptoOrchestrator().decryptDelivered(input),
};
