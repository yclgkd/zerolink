import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const BASE_URL = 'http://localhost';
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

function validCompoundCommitPayload(uuid: string) {
  return {
    uuid,
    assertion: VALID_ASSERTION,
    intentHash: VALID_HEX,
    intent: {
      op: 'delete' as const,
      uuid,
      version: 0,
      timestamp: Date.now(),
      nonce: VALID_B64U,
    },
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

describe('mock handlers: manage and delete commit contracts', () => {
  it('rejects compound_commit when intent.uuid mismatches path uuid', async () => {
    const response = await postJson('/api/manage/compound_commit/aaaaaaaaaaaaaaaaaaaaa', {
      ...validCompoundCommitPayload('aaaaaaaaaaaaaaaaaaaaa'),
      intent: {
        op: 'delete',
        uuid: 'bbbbbbbbbbbbbbbbbbbbb',
        version: 0,
        timestamp: Date.now(),
        nonce: VALID_B64U,
      },
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects delete_commit when intent.op is not delete', async () => {
    const response = await postJson('/api/delete_commit/channel-a', {
      uuid: 'channel-a',
      intent: {
        uuid: 'channel-a',
        op: 'update',
      },
    });
    const payload = (await response.json()) as { ok: false; code: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });

  it('accepts delete_commit when intent.op is delete and uuids match', async () => {
    const response = await postJson('/api/delete_commit/channel-a', {
      uuid: 'channel-a',
      intent: {
        uuid: 'channel-a',
        op: 'delete',
      },
    });
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it('accepts compound_commit when body uuid and intent uuid both match path uuid', async () => {
    const response = await postJson(
      '/api/manage/compound_commit/aaaaaaaaaaaaaaaaaaaaa',
      validCompoundCommitPayload('aaaaaaaaaaaaaaaaaaaaa')
    );
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });
});
