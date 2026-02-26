import { LockBeginResponseSchema, LockCommitResponseSchema } from '@zerolink/shared';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const BASE_URL = 'http://localhost';
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbbbbbbbbbbbbbbb';
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';
const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const VALID_RECEIVER_PUB_JWK = {
  kty: 'RSA',
  alg: 'RSA-OAEP-256',
  n: VALID_B64U,
  e: 'AQAB',
  ext: true,
  key_ops: ['encrypt'],
} as const;

async function postJson(pathname: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('mock handlers: lock contracts', () => {
  it('accepts lock_begin with valid payload and returns schema-valid response', async () => {
    const response = await postJson(`/api/lock_begin/${VALID_UUID}`, {
      uuid: VALID_UUID,
    });
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(LockBeginResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects lock_begin when body uuid mismatches path uuid', async () => {
    const response = await postJson(`/api/lock_begin/${VALID_UUID}`, {
      uuid: OTHER_UUID,
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects lock_begin when body is invalid', async () => {
    const response = await postJson(`/api/lock_begin/${VALID_UUID}`, {});
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('accepts lock_commit with valid payload and returns schema-valid response', async () => {
    const response = await postJson(`/api/lock_commit/${VALID_UUID}`, {
      uuid: VALID_UUID,
      lockChallengeId: VALID_B64U,
      lockProof: VALID_HEX,
      receiverPubJwk: VALID_RECEIVER_PUB_JWK,
      receiverPubFpr: VALID_HEX,
      lockedAt: Date.now(),
    });
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(LockCommitResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects lock_commit when lockProof is not lowercase hex', async () => {
    const response = await postJson(`/api/lock_commit/${VALID_UUID}`, {
      uuid: VALID_UUID,
      lockChallengeId: VALID_B64U,
      lockProof: 'not-hex',
      receiverPubJwk: VALID_RECEIVER_PUB_JWK,
      receiverPubFpr: VALID_HEX,
      lockedAt: Date.now(),
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects lock_commit when required fields are missing', async () => {
    const response = await postJson(`/api/lock_commit/${VALID_UUID}`, {
      uuid: VALID_UUID,
      lockChallengeId: VALID_B64U,
      lockProof: VALID_HEX,
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });
});
