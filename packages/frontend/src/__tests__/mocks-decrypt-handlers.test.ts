import { CipherBundleSchema, HexStringSchema, UnixMsSchema } from '@zerolink/shared';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const BASE_URL = 'http://localhost';
const VALID_UUID = 'aaaaaaaaaaaaaaaaaaaaa';
const INVALID_UUID = 'invalid_uuid';

async function getJson(pathname: string): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`);
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

describe('mock handlers: decrypt fetch contract', () => {
  it('accepts decrypt_fetch with valid uuid and returns schema-valid cipher payload', async () => {
    const response = await getJson(`/api/decrypt_fetch/${VALID_UUID}`);
    const payload = (await response.json()) as {
      ok: true;
      cipherBundle: unknown;
      receiverPubFpr: unknown;
      cipherVersion: unknown;
      deliveredAt: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(CipherBundleSchema.safeParse(payload.cipherBundle).success).toBe(true);
    expect(HexStringSchema.safeParse(payload.receiverPubFpr).success).toBe(true);
    expect(payload.cipherVersion).toBe(0);
    expect(UnixMsSchema.safeParse(payload.deliveredAt).success).toBe(true);
  });

  it('rejects decrypt_fetch with invalid uuid', async () => {
    const response = await getJson(`/api/decrypt_fetch/${INVALID_UUID}`);
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });
});
