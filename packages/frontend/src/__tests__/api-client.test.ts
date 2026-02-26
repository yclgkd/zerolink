import {
  CompoundBeginResponseSchema,
  type CompoundCommitRequestSchema,
  CompoundCommitResponseSchema,
  CreateBeginResponseSchema,
  type CreateFinishRequestSchema,
  CreateFinishResponseSchema,
  DecryptFetchResponseSchema,
  LockBeginResponseSchema,
  LockCommitResponseSchema,
  PublicStatusResponseSchema,
  SECURITY_PROFILE,
} from '@zerolink/shared';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { createApiClient } from '../api/client';
import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';
const MOCK_TIMESTAMP = 1_700_000_000_000;

const VALID_ATTESTATION: z.input<typeof CreateFinishRequestSchema>['attestation'] = {
  id: VALID_B64U,
  rawId: VALID_B64U,
  type: 'public-key',
  response: {
    clientDataJSON: VALID_B64U,
    attestationObject: VALID_B64U,
    transports: ['internal' as const],
  },
};

const VALID_ASSERTION: z.input<typeof CompoundCommitRequestSchema>['assertion'] = {
  id: VALID_B64U,
  rawId: VALID_B64U,
  type: 'public-key',
  response: {
    clientDataJSON: VALID_B64U,
    authenticatorData: VALID_B64U,
    signature: VALID_B64U,
    userHandle: null,
  },
};

function createClient() {
  return createApiClient({
    basePath: 'http://localhost/api',
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => {
  server.close();
});

describe('api client', () => {
  it('returns success for createBegin', async () => {
    const client = createClient();
    const result = await client.createBegin({
      uuid: VALID_UUID,
      timestamp: Date.now(),
      securityProfile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(CreateBeginResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for createFinish', async () => {
    const client = createClient();
    const result = await client.createFinish({
      uuid: VALID_UUID,
      attestation: VALID_ATTESTATION,
      lockKeyB64u: VALID_B64U,
      timestamp: Date.now(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(CreateFinishResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for lockBegin', async () => {
    const client = createClient();
    const result = await client.lockBegin({
      uuid: VALID_UUID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(LockBeginResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for lockCommit', async () => {
    const client = createClient();
    const result = await client.lockCommit({
      uuid: VALID_UUID,
      lockChallengeId: VALID_B64U,
      lockProof: VALID_HEX,
      receiverPubJwk: {
        kty: 'RSA',
        alg: 'RSA-OAEP-256',
        n: VALID_B64U,
        e: 'AQAB',
        ext: true,
        key_ops: ['encrypt'],
      },
      receiverPubFpr: VALID_HEX,
      lockedAt: MOCK_TIMESTAMP,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(LockCommitResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for compoundBegin', async () => {
    const client = createClient();
    const result = await client.compoundBegin({
      uuid: VALID_UUID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(CompoundBeginResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for compoundCommit', async () => {
    const client = createClient();
    const result = await client.compoundCommit({
      uuid: VALID_UUID,
      assertion: VALID_ASSERTION,
      intentHash: VALID_HEX,
      intent: {
        op: 'delete',
        uuid: VALID_UUID,
        version: 0,
        timestamp: Date.now(),
        nonce: VALID_B64U,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(CompoundCommitResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for deleteCommit', async () => {
    const client = createClient();
    const result = await client.deleteCommit({
      uuid: VALID_UUID,
      assertion: VALID_ASSERTION,
      intentHash: VALID_HEX,
      intent: {
        op: 'delete',
        uuid: VALID_UUID,
        version: 0,
        timestamp: Date.now(),
        nonce: VALID_B64U,
      },
    });

    expect(result).toEqual({
      ok: true,
      data: { ok: true },
      status: 200,
    });
  });

  it('returns success for publicStatus', async () => {
    const client = createClient();
    const result = await client.publicStatus(VALID_UUID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(PublicStatusResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns success for decryptFetch', async () => {
    const client = createClient();
    const result = await client.decryptFetch(VALID_UUID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(DecryptFetchResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it('returns INVALID_REQUEST without calling fetch when request input is invalid', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          creationOptions: {},
        }),
        { status: 200 }
      )
    );
    const client = createApiClient({
      basePath: '/api',
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await client.createBegin({
      uuid: 'bad-uuid',
      timestamp: Date.now(),
      securityProfile: SECURITY_PROFILE.STANDARD,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns INVALID_REQUEST for deleteCommit without assertion and does not call fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
        }),
        { status: 200 }
      )
    );
    const client = createApiClient({
      basePath: '/api',
      fetchImpl: fetchMock as typeof fetch,
    });

    const invalidDeleteInput = {
      uuid: VALID_UUID,
      intentHash: VALID_HEX,
      intent: {
        op: 'delete',
        uuid: VALID_UUID,
        version: 0,
        timestamp: Date.now(),
        nonce: VALID_B64U,
      },
    } as unknown as Parameters<typeof client.deleteCommit>[0];

    const result = await client.deleteCommit(invalidDeleteInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves server BAD_REQUEST code on non-2xx responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: 'BAD_REQUEST',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
    });
    const result = await client.publicStatus(VALID_UUID);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('BAD_REQUEST');
    expect(result.error.status).toBe(400);
  });

  it('returns HTTP_ERROR when non-2xx response body is not parseable error envelope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('internal error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    );
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await client.lockBegin({
      uuid: VALID_UUID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('HTTP_ERROR');
    expect(result.error.status).toBe(500);
  });

  it('returns NETWORK_ERROR when fetch throws', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'));
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await client.publicStatus(VALID_UUID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NETWORK_ERROR');
    expect(result.error.status).toBeNull();
  });

  it('returns INVALID_RESPONSE for 2xx responses that fail schema validation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, invalid: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );
    const client = createApiClient({
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await client.publicStatus(VALID_UUID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_RESPONSE');
    expect(result.error.status).toBe(200);
  });

  it('uses basePath and injected fetch implementation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          lockChallenge: {
            id: VALID_B64U,
            challenge: VALID_B64U,
            expiresAt: MOCK_TIMESTAMP,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );
    const client = createApiClient({
      basePath: '/custom-api',
      fetchImpl: fetchMock as typeof fetch,
    });

    const result = await client.lockBegin({
      uuid: VALID_UUID,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/custom-api/lock_begin/aaaaaaaaaaaaaaaaaaaaa',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
