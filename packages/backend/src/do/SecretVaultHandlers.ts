import {
  type Base64Url,
  CHANNEL_STATE,
  type ChannelRecord,
  CompoundBeginRequestSchema,
  CompoundCommitRequestSchema,
  type DecryptFetchDeliveryAuth,
  LockBeginRequestSchema,
  LockCommitRequestSchema,
  SoftkeyCompoundCommitRequestSchema,
  type SoftkeyCredential,
  type StoredCredential,
} from '@zerolink/shared';
import { INTERNAL_CALLER_KEY_HEADER, INTERNAL_COMMIT_TOKEN_HEADER } from '../commitTokens.ts';
import { beginCompoundChallengeInternal, commitCompoundInternal } from './SecretVaultCompound.ts';
import { withCommitCookieSignal, withCommitCookieSignalFromError } from './SecretVaultCookies.ts';
import {
  jsonError,
  jsonResponse,
  mapError,
  normalizeAssertion,
  readJsonBody,
} from './SecretVaultHttp.ts';
import { beginLockChallengeInternal, commitLockChallengeInternal } from './SecretVaultLock.ts';
import { loadActiveRecord } from './SecretVaultStorage.ts';
import type { CommitLockChallengeParams, VaultContext } from './SecretVaultTypes.ts';

// ---------------------------------------------------------------------------
// Request context extraction helpers
// ---------------------------------------------------------------------------

function getCallerKeyFromRequest(request: Request): Base64Url | undefined {
  const callerKey = request.headers.get(INTERNAL_CALLER_KEY_HEADER)?.trim();
  return callerKey ? (callerKey as Base64Url) : undefined;
}

function getCommitTokenFromRequest(request: Request): string | undefined {
  const commitToken = request.headers.get(INTERNAL_COMMIT_TOKEN_HEADER)?.trim();
  return commitToken || undefined;
}

// ---------------------------------------------------------------------------
// Decrypt payload builder (used only in handleGetDecryptPayload)
// ---------------------------------------------------------------------------

function buildDecryptFetchDeliveryAuth(
  record: ChannelRecord
): DecryptFetchDeliveryAuth | undefined {
  if (!record.updateDeliveryProof) {
    return undefined;
  }

  if (record.updateDeliveryProof.adminMode === 'webauthn') {
    const adminCredential = record.adminCredential as StoredCredential;
    return {
      adminMode: 'webauthn',
      meta: record.updateDeliveryProof.meta,
      signer: {
        credentialId: adminCredential.credentialId,
        publicKey: adminCredential.publicKey,
      },
      proof: record.updateDeliveryProof.proof,
    };
  }

  const adminCredential = record.adminCredential as SoftkeyCredential;
  return {
    adminMode: record.updateDeliveryProof.adminMode,
    meta: record.updateDeliveryProof.meta,
    signer: {
      softkeyPubJwk: adminCredential.softkeyPubJwk,
    },
    proof: record.updateDeliveryProof.proof,
  };
}

function buildDeliveredPayload(record: ChannelRecord): {
  payloadTransport: 'inline' | 'multipart';
  cipherBundle?: ChannelRecord['cipherBundle'];
  fileRef?: ChannelRecord['fileRef'];
} | null {
  if (record.fileRef) {
    return {
      payloadTransport: 'multipart',
      fileRef: record.fileRef,
    };
  }

  if (record.cipherBundle) {
    return {
      payloadTransport: 'inline',
      cipherBundle: record.cipherBundle,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP handler functions
// ---------------------------------------------------------------------------

export async function handleLockBegin(vc: VaultContext, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return jsonError('BAD_REQUEST', 400);
  }

  const parsed = LockBeginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('BAD_REQUEST', 400);
  }

  try {
    const result = await beginLockChallengeInternal(vc, parsed.data.uuid, Date.now(), {
      callerKey: getCallerKeyFromRequest(request),
    });
    return withCommitCookieSignal(
      jsonResponse({ ok: true, lockChallenge: result.lockChallenge }, 200),
      result.commitCookieSignal
    );
  } catch (error) {
    return withCommitCookieSignalFromError(
      error,
      mapError(error, { appEnv: vc.env.APP_ENV, handler: 'lock_begin' })
    );
  }
}

export async function handleLockCommit(vc: VaultContext, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return jsonError('BAD_REQUEST', 400);
  }

  const parsed = LockCommitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('BAD_REQUEST', 400);
  }

  try {
    // LockCommitRequest is structurally compatible with CommitLockChallengeParams
    const result = await commitLockChallengeInternal(
      vc,
      parsed.data as unknown as CommitLockChallengeParams,
      Date.now(),
      {
        callerKey: getCallerKeyFromRequest(request),
        commitToken: getCommitTokenFromRequest(request),
      }
    );
    return withCommitCookieSignal(jsonResponse({ ok: true }, 200), result.commitCookieSignal);
  } catch (error) {
    return withCommitCookieSignalFromError(
      error,
      mapError(error, { appEnv: vc.env.APP_ENV, handler: 'lock_commit' })
    );
  }
}

export async function handleCompoundBegin(vc: VaultContext, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return jsonError('BAD_REQUEST', 400);
  }

  const parsed = CompoundBeginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('BAD_REQUEST', 400);
  }

  try {
    const result = await beginCompoundChallengeInternal(vc, parsed.data.uuid, Date.now(), {
      callerKey: getCallerKeyFromRequest(request),
    });
    return withCommitCookieSignal(
      jsonResponse({ ok: true, ...result.response }, 200),
      result.commitCookieSignal
    );
  } catch (error) {
    return withCommitCookieSignalFromError(
      error,
      mapError(error, { appEnv: vc.env.APP_ENV, handler: 'compound_begin' })
    );
  }
}

export async function handleCompoundCommit(vc: VaultContext, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) {
    return jsonError('BAD_REQUEST', 400);
  }

  const parsedWebAuthn = CompoundCommitRequestSchema.safeParse(body);
  const parsedSoftkey = SoftkeyCompoundCommitRequestSchema.safeParse(body);
  if (!parsedWebAuthn.success && !parsedSoftkey.success) {
    return jsonError('BAD_REQUEST', 400);
  }

  try {
    let result:
      | { commitCookieSignal?: import('../commitTokens.ts').CommitCookieSignal }
      | undefined;
    if (parsedSoftkey.success) {
      result = await commitCompoundInternal(
        vc,
        {
          adminMode: parsedSoftkey.data.adminMode,
          uuid: parsedSoftkey.data.uuid,
          softkeySignature: parsedSoftkey.data.softkeySignature,
          intentHash: parsedSoftkey.data.intentHash,
          intent: parsedSoftkey.data.intent,
        },
        Date.now(),
        {
          callerKey: getCallerKeyFromRequest(request),
          commitToken: getCommitTokenFromRequest(request),
        }
      );
    } else if (parsedWebAuthn.success) {
      result = await commitCompoundInternal(
        vc,
        {
          uuid: parsedWebAuthn.data.uuid,
          assertion: normalizeAssertion(parsedWebAuthn.data.assertion),
          intentHash: parsedWebAuthn.data.intentHash,
          intent: parsedWebAuthn.data.intent,
        },
        Date.now(),
        {
          callerKey: getCallerKeyFromRequest(request),
          commitToken: getCommitTokenFromRequest(request),
        }
      );
    }

    return withCommitCookieSignal(jsonResponse({ ok: true }, 200), result?.commitCookieSignal);
  } catch (error) {
    return withCommitCookieSignalFromError(
      error,
      mapError(error, { appEnv: vc.env.APP_ENV, handler: 'compound_commit' })
    );
  }
}

export async function handleGetPublicState(vc: VaultContext): Promise<Response> {
  try {
    const record = await loadActiveRecord(vc);
    const body: Record<string, unknown> = {
      ok: true,
      state: record.state,
      adminMode: record.adminMode,
      securityProfile: record.securityProfile,
    };
    if (record.receiver?.pubFpr) {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation on Record<string, unknown>
      body['receiverPubFpr'] = record.receiver.pubFpr;
    }
    return jsonResponse(body, 200);
  } catch (error) {
    return mapError(error, { appEnv: vc.env.APP_ENV, handler: 'get_public_state' });
  }
}

export async function handleGetDecryptPayload(vc: VaultContext): Promise<Response> {
  try {
    const record = await loadActiveRecord(vc);
    const payload = buildDeliveredPayload(record);
    if (
      record.state !== CHANNEL_STATE.DELIVERED ||
      !payload ||
      !record.receiver ||
      record.deliveredAt == null ||
      record.version < 1
    ) {
      return jsonError('CHANNEL_NOT_DELIVERED', 409);
    }
    return jsonResponse(
      {
        ok: true,
        payloadTransport: payload.payloadTransport,
        ...(payload.cipherBundle ? { cipherBundle: payload.cipherBundle } : {}),
        ...(payload.fileRef ? { fileRef: payload.fileRef } : {}),
        receiverPubFpr: record.receiver.pubFpr,
        cipherVersion: record.version - 1,
        ...(record.updateDeliveryProof
          ? { deliveryAuth: buildDecryptFetchDeliveryAuth(record) }
          : {}),
        deliveredAt: record.deliveredAt,
      },
      200
    );
  } catch (error) {
    return mapError(error, { appEnv: vc.env.APP_ENV, handler: 'get_decrypt_payload' });
  }
}

export async function handleGetFilePayload(vc: VaultContext): Promise<Response> {
  try {
    const record = await loadActiveRecord(vc);
    const payload = buildDeliveredPayload(record);
    if (
      record.state !== CHANNEL_STATE.DELIVERED ||
      !payload ||
      payload.payloadTransport !== 'multipart' ||
      !record.receiver ||
      record.deliveredAt == null ||
      record.version < 1
    ) {
      return jsonError('CHANNEL_NOT_DELIVERED', 409);
    }

    return jsonResponse(
      {
        ok: true,
        payloadTransport: 'multipart',
        fileRef: payload.fileRef,
        receiverPubFpr: record.receiver.pubFpr,
        cipherVersion: record.version - 1,
        deliveredAt: record.deliveredAt,
      },
      200
    );
  } catch (error) {
    return mapError(error, { appEnv: vc.env.APP_ENV, handler: 'get_file_payload' });
  }
}
