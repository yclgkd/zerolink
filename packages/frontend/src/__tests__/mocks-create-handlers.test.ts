import { CreateBeginResponseSchema, CreateFinishResponseSchema } from '@zerolink/shared';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const BASE_URL = 'http://localhost';
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const OTHER_UUID = 'bbbbbbbbbbbbbbbbbbbbb';

const VALID_ATTESTATION = {
  id: 'bW9ja19jcmVkZW50aWFs',
  rawId: 'bW9ja19jcmVkZW50aWFs',
  type: 'public-key',
  response: {
    clientDataJSON: 'bW9jazpjbGllbnQtZGF0YQ',
    attestationObject: 'bW9jazphdHRlc3RhdGlvbg',
    transports: ['internal'],
  },
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

describe('mock handlers: create contracts', () => {
  it('accepts create_begin with valid payload and returns schema-valid response', async () => {
    const response = await postJson(`/api/create_begin/${VALID_UUID}`, {
      uuid: VALID_UUID,
      timestamp: Date.now(),
      securityProfile: 'quick',
    });
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(CreateBeginResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects create_begin when securityProfile is invalid', async () => {
    const response = await postJson(`/api/create_begin/${VALID_UUID}`, {
      uuid: VALID_UUID,
      timestamp: Date.now(),
      securityProfile: 'hardware',
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects create_begin when body uuid mismatches path uuid', async () => {
    const response = await postJson(`/api/create_begin/${VALID_UUID}`, {
      uuid: OTHER_UUID,
      timestamp: Date.now(),
      securityProfile: 'quick',
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('accepts create_finish with valid payload and returns schema-valid response', async () => {
    const response = await postJson(`/api/create_finish/${VALID_UUID}`, {
      adminMode: 'webauthn',
      uuid: VALID_UUID,
      attestation: VALID_ATTESTATION,
      lockKeyB64u: 'bW9ja19sb2NrX2tleQ',
      timestamp: Date.now(),
    });
    const payload = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(CreateFinishResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects create_finish for invalid lockKeyB64u or missing attestation', async () => {
    const invalidLockKeyResponse = await postJson(`/api/create_finish/${VALID_UUID}`, {
      adminMode: 'webauthn',
      uuid: VALID_UUID,
      attestation: VALID_ATTESTATION,
      lockKeyB64u: 'bad+lock+key',
      timestamp: Date.now(),
    });
    const invalidLockKeyPayload = (await invalidLockKeyResponse.json()) as {
      ok: false;
      code: string;
    };

    const missingAttestationResponse = await postJson(`/api/create_finish/${VALID_UUID}`, {
      uuid: VALID_UUID,
      lockKeyB64u: 'bW9ja19sb2NrX2tleQ',
      timestamp: Date.now(),
    });
    const missingAttestationPayload = (await missingAttestationResponse.json()) as {
      ok: false;
      code: string;
    };

    expect(invalidLockKeyResponse.status).toBe(400);
    expect(invalidLockKeyPayload).toEqual({ ok: false, code: 'BAD_REQUEST' });

    expect(missingAttestationResponse.status).toBe(400);
    expect(missingAttestationPayload).toEqual({
      ok: false,
      code: 'BAD_REQUEST',
    });
  });
});
