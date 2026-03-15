import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import {
  buildCipherBundleAadBytes,
  CHANNEL_STATE,
  type ChannelState,
  CompoundBeginRequestSchema,
  CompoundBeginResponseSchema,
  CompoundCommitRequestSchema,
  CompoundCommitResponseSchema,
  CreateBeginRequestSchema,
  CreateFinishRequestSchema,
  CreateFinishResponseSchema,
  DecryptFetchResponseSchema,
  extractCredentialPublicKeyFromAttestation,
  LockBeginRequestSchema,
  LockBeginResponseSchema,
  LockCommitRequestSchema,
  LockCommitResponseSchema,
  PublicStatusResponseSchema,
  ROUTE_PATTERN,
  SECURITY_PROFILE,
  type SecurityProfile,
  SoftkeyCompoundCommitRequestSchema,
  UUIDSchema,
} from '@zerolink/shared';
import type { z } from 'zod';

interface ChannelRuntimeState {
  state: ChannelState;
  securityProfile: SecurityProfile;
  adminMode: z.output<typeof CreateFinishRequestSchema>['adminMode'];
  credentialId?: string;
  credentialPublicKey?: string;
  softkeyPubJwk?: z.output<typeof CreateFinishRequestSchema>['softkeyPubJwk'];
  version: number;
  lockChallenge?: {
    id: string;
    challenge: string;
    expiresAt: number;
  };
  receiverPubJwk?: z.output<typeof LockCommitRequestSchema>['receiverPubJwk'];
  receiverPubFpr?: string;
  lockedAt?: number;
  delivery?: {
    cipherBundle: Extract<
      z.output<
        typeof CompoundCommitRequestSchema | typeof SoftkeyCompoundCommitRequestSchema
      >['intent'],
      { op: 'update' }
    >['cipherBundle'];
    receiverPubFpr: string;
    cipherVersion: number;
    deliveryAuth?: z.output<typeof DecryptFetchResponseSchema>['deliveryAuth'];
    deliveredAt: number;
  };
}

function b64u(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function bytesToB64u(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function b64uToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJsonBody(route: Route): Record<string, unknown> | null {
  const raw = route.request().postData();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

async function fulfillJson(route: Route, status: number, payload: unknown): Promise<void> {
  await route.fulfill({
    status,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function badRequest(route: Route): Promise<void> {
  await fulfillJson(route, 400, {
    ok: false,
    code: 'BAD_REQUEST',
  });
}

async function notFound(route: Route): Promise<void> {
  await fulfillJson(route, 404, {
    ok: false,
    code: 'NOT_FOUND',
  });
}

function createChannel(
  channels: Map<string, ChannelRuntimeState>,
  uuid: string
): ChannelRuntimeState {
  const existing = channels.get(uuid);
  if (existing) return existing;

  const created: ChannelRuntimeState = {
    state: CHANNEL_STATE.WAITING,
    securityProfile: SECURITY_PROFILE.SECURE,
    adminMode: 'webauthn',
    version: 0,
  };
  channels.set(uuid, created);
  return created;
}

function requireChannel(
  channels: Map<string, ChannelRuntimeState>,
  uuid: string
): ChannelRuntimeState | undefined {
  return channels.get(uuid);
}

export type ChannelMap = Map<string, ChannelRuntimeState>;

/**
 * Installs a stateful API mock for the full happy-path flow.
 * Accepts an optional shared channels map for cross-page state sharing.
 */
export async function installStatefulApiMock(
  page: Page,
  sharedChannels?: ChannelMap
): Promise<ChannelMap> {
  const channels = sharedChannels ?? new Map<string, ChannelRuntimeState>();

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    const now = Date.now();

    if (!pathname.startsWith('/api/')) {
      await route.fallback();
      return;
    }

    const createBeginMatch = pathname.match(/^\/api\/create_begin\/([^/]+)$/u);
    if (method === 'POST' && createBeginMatch) {
      const pathUuid = createBeginMatch[1];
      const body = parseJsonBody(route);
      const parsedBody = CreateBeginRequestSchema.safeParse(body);
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedBody.success || !parsedUuid.success || parsedBody.data.uuid !== parsedUuid.data) {
        return badRequest(route);
      }

      createChannel(channels, parsedUuid.data);
      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      channel.securityProfile = parsedBody.data.securityProfile;
      return fulfillJson(route, 200, {
        ok: true,
        creationOptions: {
          challenge: b64u(`create-challenge-${parsedUuid.data}`),
          rp: { name: 'ZeroLink E2E', id: '127.0.0.1' },
          user: {
            id: b64u(`user-${parsedUuid.data}`),
            name: `sender-${parsedUuid.data}@e2e.local`,
            displayName: 'E2E Sender',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          timeout: 60_000,
          attestation: 'none',
        },
      });
    }

    const createFinishMatch = pathname.match(/^\/api\/create_finish\/([^/]+)$/u);
    if (method === 'POST' && createFinishMatch) {
      const pathUuid = createFinishMatch[1];
      const body = parseJsonBody(route);
      const parsedBody = CreateFinishRequestSchema.safeParse(body);
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedBody.success || !parsedUuid.success || parsedBody.data.uuid !== parsedUuid.data) {
        return badRequest(route);
      }

      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      channel.adminMode = parsedBody.data.adminMode;
      if (parsedBody.data.adminMode === 'webauthn') {
        channel.credentialId = parsedBody.data.attestation.rawId;
        try {
          channel.credentialPublicKey = await extractCredentialPublicKeyFromAttestation(
            parsedBody.data.attestation.response.attestationObject
          );
        } catch {
          return badRequest(route);
        }
        channel.softkeyPubJwk = undefined;
      } else {
        channel.softkeyPubJwk = parsedBody.data.softkeyPubJwk;
        channel.credentialId = undefined;
        channel.credentialPublicKey = undefined;
      }
      const payload = {
        ok: true,
        shareUrl: ROUTE_PATTERN.SHARE.replace(':uuid', parsedUuid.data),
        manageUrl: ROUTE_PATTERN.MANAGE.replace(':uuid', parsedUuid.data),
      };
      const parsedPayload = CreateFinishResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    const lockBeginMatch = pathname.match(/^\/api\/lock_begin\/([^/]+)$/u);
    if (method === 'POST' && lockBeginMatch) {
      const pathUuid = lockBeginMatch[1];
      const body = parseJsonBody(route);
      const parsedBody = LockBeginRequestSchema.safeParse(body);
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedBody.success || !parsedUuid.success || parsedBody.data.uuid !== parsedUuid.data) {
        return badRequest(route);
      }

      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      const lockChallenge = {
        id: b64u(`lock-id-${parsedUuid.data}-${channel.version}`),
        challenge: b64u(`lock-challenge-${parsedUuid.data}-${channel.version}`),
        expiresAt: now + 60_000,
      };
      channel.lockChallenge = lockChallenge;

      const payload = {
        ok: true,
        lockChallenge,
      };
      const parsedPayload = LockBeginResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    const lockCommitMatch = pathname.match(/^\/api\/lock_commit\/([^/]+)$/u);
    if (method === 'POST' && lockCommitMatch) {
      const pathUuid = lockCommitMatch[1];
      const body = parseJsonBody(route);
      const parsedBody = LockCommitRequestSchema.safeParse(body);
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedBody.success || !parsedUuid.success || parsedBody.data.uuid !== parsedUuid.data) {
        return badRequest(route);
      }

      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      if (!channel.lockChallenge || channel.lockChallenge.id !== parsedBody.data.lockChallengeId) {
        return badRequest(route);
      }

      channel.receiverPubJwk = parsedBody.data.receiverPubJwk;
      channel.receiverPubFpr = parsedBody.data.receiverPubFpr;
      channel.lockedAt = parsedBody.data.lockedAt;
      channel.state = CHANNEL_STATE.LOCKED;

      const payload = { ok: true };
      const parsedPayload = LockCommitResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    const compoundBeginMatch = pathname.match(/^\/api\/manage\/compound_begin\/([^/]+)$/u);
    if (method === 'POST' && compoundBeginMatch) {
      const pathUuid = compoundBeginMatch[1];
      const body = parseJsonBody(route);
      const parsedBody = CompoundBeginRequestSchema.safeParse(body);
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedBody.success || !parsedUuid.success || parsedBody.data.uuid !== parsedUuid.data) {
        return badRequest(route);
      }

      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      const challenge = {
        id: b64u(`compound-id-${parsedUuid.data}-${channel.version}`),
        seed: b64u(`compound-seed-${parsedUuid.data}-${channel.version}`),
        expiresAt: now + 60_000,
      };

      const payload = {
        ok: true,
        challenge,
        securityProfile: channel.securityProfile,
        adminMode: channel.adminMode,
        ...(channel.adminMode === 'webauthn' && channel.credentialId
          ? {
              allowCredentials: [{ id: channel.credentialId, type: 'public-key' as const }],
            }
          : {}),
        ...(channel.receiverPubFpr ? { receiverPubFpr: channel.receiverPubFpr } : {}),
        ...(channel.receiverPubJwk ? { receiverPubJwk: channel.receiverPubJwk } : {}),
        currentVersion: channel.version,
      };
      const parsedPayload = CompoundBeginResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    const compoundCommitMatch = pathname.match(/^\/api\/manage\/compound_commit\/([^/]+)$/u);
    if (method === 'POST' && compoundCommitMatch) {
      const pathUuid = compoundCommitMatch[1];
      const body = parseJsonBody(route);
      const parsedWebAuthnBody = CompoundCommitRequestSchema.safeParse(body);
      const parsedSoftkeyBody = SoftkeyCompoundCommitRequestSchema.safeParse(body);
      const parsedBody = parsedWebAuthnBody.success ? parsedWebAuthnBody : parsedSoftkeyBody;
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (
        !parsedBody.success ||
        !parsedUuid.success ||
        parsedBody.data.uuid !== parsedUuid.data ||
        parsedBody.data.intent.uuid !== parsedUuid.data ||
        parsedBody.data.intent.op !== 'update'
      ) {
        return badRequest(route);
      }

      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      const deliveryMeta = {
        version: parsedBody.data.intent.version,
        timestamp: parsedBody.data.intent.timestamp,
        nonce: parsedBody.data.intent.nonce,
        expireAt: parsedBody.data.intent.expireAt,
      };
      const deliveryAuth =
        'softkeySignature' in parsedBody.data
          ? channel.softkeyPubJwk
            ? {
                adminMode: parsedBody.data.adminMode,
                meta: deliveryMeta,
                signer: {
                  softkeyPubJwk: channel.softkeyPubJwk,
                },
                proof: {
                  softkeySignature: parsedBody.data.softkeySignature,
                },
              }
            : undefined
          : channel.credentialId && channel.credentialPublicKey
            ? {
                adminMode: 'webauthn' as const,
                meta: deliveryMeta,
                signer: {
                  credentialId: channel.credentialId,
                  publicKey: channel.credentialPublicKey,
                },
                proof: {
                  clientDataJSON: parsedBody.data.assertion.response.clientDataJSON,
                  authenticatorData: parsedBody.data.assertion.response.authenticatorData,
                  signature: parsedBody.data.assertion.response.signature,
                },
              }
            : undefined;

      if (!deliveryAuth) {
        return badRequest(route);
      }

      const normalizedCipherBundle = {
        ...parsedBody.data.intent.cipherBundle,
        aad: bytesToB64u(
          buildCipherBundleAadBytes({
            uuid: parsedUuid.data,
            version: parsedBody.data.intent.version,
            receiverPubFpr: parsedBody.data.intent.receiverPubFpr,
          })
        ),
        ciphertextHash: sha256Hex(b64uToBytes(parsedBody.data.intent.cipherBundle.ciphertext)),
      };

      channel.delivery = {
        cipherBundle: normalizedCipherBundle,
        receiverPubFpr: parsedBody.data.intent.receiverPubFpr,
        cipherVersion: parsedBody.data.intent.version,
        deliveryAuth,
        deliveredAt: now,
      };
      channel.version = parsedBody.data.intent.version + 1;
      channel.state = CHANNEL_STATE.DELIVERED;

      const payload = { ok: true };
      const parsedPayload = CompoundCommitResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    const deleteCommitMatch = pathname.match(/^\/api\/delete_commit\/([^/]+)$/u);
    if (method === 'POST' && deleteCommitMatch) {
      const pathUuid = deleteCommitMatch[1];
      const body = parseJsonBody(route);
      const parsedBody = CompoundCommitRequestSchema.safeParse(body);
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (
        !parsedBody.success ||
        !parsedUuid.success ||
        parsedBody.data.uuid !== parsedUuid.data ||
        parsedBody.data.intent.uuid !== parsedUuid.data ||
        parsedBody.data.intent.op !== 'delete'
      ) {
        return badRequest(route);
      }

      const channel = requireChannel(channels, parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }

      channels.delete(parsedUuid.data);

      return fulfillJson(route, 200, {
        ok: true,
      });
    }

    const publicMatch = pathname.match(/^\/api\/public\/([^/]+)$/u);
    if (method === 'GET' && publicMatch) {
      const pathUuid = publicMatch[1];
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedUuid.success) {
        return badRequest(route);
      }

      const channel = channels.get(parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }
      const payload = {
        ok: true,
        state: channel.state,
        adminMode: channel.adminMode,
        securityProfile: channel.securityProfile,
        ...(channel.receiverPubFpr ? { receiverPubFpr: channel.receiverPubFpr } : {}),
      };
      const parsedPayload = PublicStatusResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    const decryptFetchMatch = pathname.match(/^\/api\/decrypt_fetch\/([^/]+)$/u);
    if (method === 'GET' && decryptFetchMatch) {
      const pathUuid = decryptFetchMatch[1];
      const parsedUuid = UUIDSchema.safeParse(pathUuid);
      if (!parsedUuid.success) {
        return badRequest(route);
      }

      const channel = channels.get(parsedUuid.data);
      if (!channel) {
        return notFound(route);
      }

      if (!channel.delivery || channel.state !== CHANNEL_STATE.DELIVERED) {
        return badRequest(route);
      }

      const payload = {
        ok: true,
        cipherBundle: channel.delivery.cipherBundle,
        receiverPubFpr: channel.delivery.receiverPubFpr,
        cipherVersion: channel.delivery.cipherVersion,
        ...(channel.delivery.deliveryAuth ? { deliveryAuth: channel.delivery.deliveryAuth } : {}),
        deliveredAt: channel.delivery.deliveredAt,
      };
      const parsedPayload = DecryptFetchResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return badRequest(route);
      }

      return fulfillJson(route, 200, parsedPayload.data);
    }

    return fulfillJson(route, 404, {
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  return channels;
}
