import { CompoundBeginResponseSchema, CompoundCommitResponseSchema } from '@zerolink/shared';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const BASE_URL = 'http://localhost';
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbbbbbbbbbbbbbbb';
const VALID_B64U = 'bW9ja19iYXNlNjR1cmw';
const VALID_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const VALID_ASSERTION = {
  id: VALID_B64U,
  rawId: VALID_B64U,
  type: 'public-key',
  response: {
    clientDataJSON: VALID_B64U,
    authenticatorData: VALID_B64U,
    signature: VALID_B64U,
    userHandle: null,
  },
} as const;

function validDeleteIntent(uuid: string) {
  return {
    op: 'delete' as const,
    uuid,
    version: 0,
    timestamp: Date.now(),
    nonce: VALID_B64U,
  };
}

function validCompoundCommitPayload(uuid: string) {
  return {
    uuid,
    assertion: VALID_ASSERTION,
    intentHash: VALID_HEX,
    intent: validDeleteIntent(uuid),
  };
}

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

describe('mock handlers: manage compound contracts', () => {
  it('accepts compound_begin with valid payload and returns schema-valid response', async () => {
    const response = await postJson(`/api/manage/compound_begin/${VALID_UUID}`, {
      uuid: VALID_UUID,
    });
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(CompoundBeginResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects compound_begin when request body is invalid', async () => {
    const response = await postJson(`/api/manage/compound_begin/${VALID_UUID}`, {});
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects compound_begin when body uuid mismatches path uuid', async () => {
    const response = await postJson(`/api/manage/compound_begin/${VALID_UUID}`, {
      uuid: OTHER_UUID,
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('accepts compound_commit with valid payload and returns schema-valid response', async () => {
    const response = await postJson(
      `/api/manage/compound_commit/${VALID_UUID}`,
      validCompoundCommitPayload(VALID_UUID)
    );
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(CompoundCommitResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects compound_commit when intent.uuid mismatches path uuid', async () => {
    const response = await postJson(`/api/manage/compound_commit/${VALID_UUID}`, {
      ...validCompoundCommitPayload(VALID_UUID),
      intent: validDeleteIntent(OTHER_UUID),
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects compound_commit when assertion is missing or intentHash is invalid', async () => {
    const missingAssertionResponse = await postJson(`/api/manage/compound_commit/${VALID_UUID}`, {
      uuid: VALID_UUID,
      intentHash: VALID_HEX,
      intent: validDeleteIntent(VALID_UUID),
    });
    const missingAssertionPayload = (await missingAssertionResponse.json()) as {
      ok: false;
      code: string;
    };

    const invalidIntentHashResponse = await postJson(`/api/manage/compound_commit/${VALID_UUID}`, {
      ...validCompoundCommitPayload(VALID_UUID),
      intentHash: 'not-hex',
    });
    const invalidIntentHashPayload = (await invalidIntentHashResponse.json()) as {
      ok: false;
      code: string;
    };

    expect(missingAssertionResponse.status).toBe(400);
    expect(missingAssertionPayload).toEqual({ ok: false, code: 'BAD_REQUEST' });

    expect(invalidIntentHashResponse.status).toBe(400);
    expect(invalidIntentHashPayload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });
});
