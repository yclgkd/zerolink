import type { AssertionJSON, Base64Url, CompoundBeginResponse, HexString } from '@zerolink/shared';
import { computeIntentHash, type DeleteIntent, NONCE_BYTES } from '@zerolink/shared';
import type {
  CryptoOrchestratorResult,
  DeleteChannelInput,
  DeleteChannelOutput,
  ResolvedDeps,
} from './orchestrator-types';
import {
  applyDeliverStoreUpdate,
  asUnixMs,
  asUuid,
  ensurePassphrase,
  mapWebAuthnError,
  randomBase64Url,
  signChallengeWithWrappedKey,
  toError,
} from './orchestrator-utils';
import { deriveExpectedCompoundChallengeB64u } from './protocol-utils';
import { assertWithWebAuthn } from './webauthn';

export async function executeDeleteChannel(
  deps: ResolvedDeps,
  input: DeleteChannelInput
): Promise<CryptoOrchestratorResult<DeleteChannelOutput>> {
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundBegin();
  });

  const beginRes = await deps.client.compoundBegin({ uuid: input.uuid });
  if (!beginRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundBegin(beginRes.error.code);
    });
    return toError(beginRes.error.code, 'delete.begin');
  }
  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundBegin(beginRes.data as CompoundBeginResponse);
  });

  const beginData = beginRes.data;
  if (!beginData.challenge) return toError('MISSING_LOCK_CHALLENGE', 'delete.validate');

  const intent: DeleteIntent = {
    op: 'delete',
    uuid: asUuid(input.uuid),
    version: beginData.currentVersion,
    timestamp: asUnixMs(deps.now()),
    nonce: randomBase64Url(NONCE_BYTES, deps.randomBytes),
  };

  const intentHash = await computeIntentHash(intent as unknown as Record<string, unknown>);
  const expectedChallenge = await deriveExpectedCompoundChallengeB64u({
    uuid: input.uuid,
    challengeId: beginData.challenge.id,
    challengeSeed: beginData.challenge.seed,
    intentHash,
  });

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.startCompoundCommit();
  });

  let assertion: AssertionJSON | undefined;
  let softkeySignature: HexString | undefined;

  const deleteIsPasswordMode =
    beginData.adminMode === 'password' || beginData.adminMode === 'softkey';

  if (deleteIsPasswordMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    const passphraseError = ensurePassphrase(softkeyPassphrase, 'delete.softkey-passphrase');
    if (passphraseError) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('PASSPHRASE_REQUIRED');
      });
      return passphraseError;
    }
    if (!input.wrappedPrivateKey) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'delete.softkey', 'missing wrapped key in manage URL');
    }
    try {
      softkeySignature = await signChallengeWithWrappedKey(
        input.wrappedPrivateKey,
        softkeyPassphrase,
        expectedChallenge as Base64Url
      );
    } catch {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit('CRYPTO_ERROR');
      });
      return toError('CRYPTO_ERROR', 'delete.softkey');
    }
  } else {
    const assertRes = await assertWithWebAuthn({
      profile: input.profile,
      requestOptions: {
        publicKey: {
          challenge: expectedChallenge,
          ...(beginData.allowCredentials ? { allowCredentials: beginData.allowCredentials } : {}),
        },
      },
    });
    if (!assertRes.ok) {
      applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
        state.failCompoundCommit(assertRes.error.code);
      });
      return mapWebAuthnError(assertRes.error.code, 'delete.assert');
    }
    assertion = assertRes.data as AssertionJSON;
  }

  const commitPayload = softkeySignature
    ? {
        adminMode: beginData.adminMode as 'password' | 'softkey',
        uuid: input.uuid,
        softkeySignature,
        intentHash,
        intent,
      }
    : {
        uuid: input.uuid,
        assertion: assertion as AssertionJSON,
        intentHash,
        intent,
      };

  const commitRes = await deps.client.deleteCommit(commitPayload);
  if (!commitRes.ok) {
    applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
      state.failCompoundCommit(commitRes.error.code);
    });
    return toError(commitRes.error.code, 'delete.commit');
  }

  applyDeliverStoreUpdate(deps.deliverStore, input.uuid, (state) => {
    state.completeCompoundCommit(commitRes.data);
    state.markDeleted();
  });

  return { ok: true, data: { intentHash, intent, expectedChallenge } };
}
