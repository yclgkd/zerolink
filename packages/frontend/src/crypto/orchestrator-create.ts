import type { CredentialCreationOptionsJSON } from '@github/webauthn-json';
import type { AttestationJSON } from '@zerolink/shared';
import {
  computeSenderAuthFingerprintFromAttestation,
  computeSoftkeyPublicKeyFingerprint,
} from '@zerolink/shared';
import type {
  CreateChannelInput,
  CreateChannelOutput,
  CryptoOrchestratorResult,
  ResolvedDeps,
} from './orchestrator-types';
import {
  ensurePassphrase,
  mapWebAuthnError,
  randomBase64Url,
  retryPendingSoftkeyCleanup,
  toError,
} from './orchestrator-utils';
import { buildShareUrlWithFragment, deriveLockKeyB64u } from './protocol-utils';
import { exportSoftkeyPublicJwk, generateSoftkeyPair, wrapSoftkeyPrivateKey } from './softkey';
import { registerWithWebAuthn } from './webauthn';

export async function executeCreateChannel(
  deps: ResolvedDeps,
  input: CreateChannelInput
): Promise<CryptoOrchestratorResult<CreateChannelOutput>> {
  await retryPendingSoftkeyCleanup(deps.softkeyAdminStorage, deps.pendingSoftkeyCleanupStorage);
  if (input.useCompatibilityMode) {
    const passphraseError = ensurePassphrase(
      input.softkeyPassphrase ?? '',
      'create.softkey-passphrase'
    );
    if (passphraseError) {
      return passphraseError;
    }
  }

  const state = deps.createStore.getState();
  state.startCreateBegin();

  const beginRes = await deps.client.createBegin({
    uuid: input.uuid,
    timestamp: deps.now(),
    securityProfile: input.profile,
  });
  if (!beginRes.ok) {
    state.failCreateBegin(beginRes.error.code);
    return toError(beginRes.error.code, 'create.begin');
  }

  state.completeCreateBegin(beginRes.data);
  const lockSecretB64u = input.lockSecretB64u ?? randomBase64Url(32, deps.randomBytes);

  let lockKeyB64u: import('@zerolink/shared').Base64Url;
  try {
    lockKeyB64u = await deriveLockKeyB64u(input.uuid, lockSecretB64u);
  } catch {
    return toError('CRYPTO_ERROR', 'create.lock-key');
  }

  if (input.useCompatibilityMode) {
    const softkeyPassphrase = input.softkeyPassphrase ?? '';
    let softkeyPubJwk: import('@zerolink/shared').ECDSAPublicKeyJWK;
    let senderAuthFpr: import('@zerolink/shared').HexString;
    try {
      const keypair = await generateSoftkeyPair();
      softkeyPubJwk = await exportSoftkeyPublicJwk(keypair.publicKey);
      senderAuthFpr = await computeSoftkeyPublicKeyFingerprint(softkeyPubJwk);
      const wrappedPrivateKey = await wrapSoftkeyPrivateKey(keypair.privateKey, softkeyPassphrase);
      await deps.softkeyAdminStorage.save({
        uuid: input.uuid,
        softkeyPubJwk,
        wrappedPrivateKey,
        createdAt: deps.now(),
      });
    } catch {
      state.failCreateFinish('CRYPTO_ERROR');
      return toError('CRYPTO_ERROR', 'create.softkey');
    }

    state.startCreateFinish();
    const finishRes = await deps.client.createFinish({
      adminMode: 'password',
      uuid: input.uuid,
      softkeyPubJwk,
      lockKeyB64u,
      timestamp: deps.now(),
    });
    if (!finishRes.ok) {
      let cleanupFailed = false;
      try {
        await deps.softkeyAdminStorage.remove(input.uuid);
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        try {
          await deps.pendingSoftkeyCleanupStorage.mark(input.uuid, deps.now());
        } catch {
          // Ignore mark failure to preserve create.finish error semantics.
        }
      }
      state.failCreateFinish(finishRes.error.code);
      return cleanupFailed
        ? toError(finishRes.error.code, 'create.finish', 'cleanup failed after create.finish')
        : toError(finishRes.error.code, 'create.finish');
    }

    state.completeCreateFinish(finishRes.data);
    state.setCreatedProfile(input.profile);

    return {
      ok: true,
      data: {
        shareUrl: finishRes.data.shareUrl,
        manageUrl: finishRes.data.manageUrl,
        shareUrlWithFragment: buildShareUrlWithFragment(
          finishRes.data.shareUrl,
          lockSecretB64u,
          senderAuthFpr
        ),
        lockSecretB64u,
        lockKeyB64u,
      },
    };
  }

  const regRes = await registerWithWebAuthn({
    profile: input.profile,
    creationOptions: beginRes.data.creationOptions as unknown as CredentialCreationOptionsJSON,
  });
  if (!regRes.ok) {
    state.failCreateFinish(regRes.error.code);
    return mapWebAuthnError(regRes.error.code, 'create.register');
  }

  let senderAuthFpr: import('@zerolink/shared').HexString;
  try {
    senderAuthFpr = await computeSenderAuthFingerprintFromAttestation(
      regRes.data as AttestationJSON
    );
  } catch {
    state.failCreateFinish('CRYPTO_ERROR');
    return toError('CRYPTO_ERROR', 'create.sender-auth');
  }

  state.startCreateFinish();
  const finishRes = await deps.client.createFinish({
    adminMode: 'webauthn',
    uuid: input.uuid,
    attestation: regRes.data as AttestationJSON,
    lockKeyB64u,
    timestamp: deps.now(),
  });
  if (!finishRes.ok) {
    state.failCreateFinish(finishRes.error.code);
    return toError(finishRes.error.code, 'create.finish');
  }

  state.completeCreateFinish(finishRes.data);
  state.setCreatedProfile(input.profile);

  return {
    ok: true,
    data: {
      shareUrl: finishRes.data.shareUrl,
      manageUrl: finishRes.data.manageUrl,
      shareUrlWithFragment: buildShareUrlWithFragment(
        finishRes.data.shareUrl,
        lockSecretB64u,
        senderAuthFpr
      ),
      lockSecretB64u,
      lockKeyB64u,
    },
  };
}
