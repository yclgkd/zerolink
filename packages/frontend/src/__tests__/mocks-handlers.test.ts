import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handlers } from '../mocks/handlers';

const server = setupServer(...handlers);
const BASE_URL = 'http://localhost';

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
    const response = await postJson('/api/manage/compound_commit/channel-a', {
      uuid: 'channel-a',
      intent: {
        uuid: 'channel-b',
        op: 'update',
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
    const response = await postJson('/api/manage/compound_commit/channel-a', {
      uuid: 'channel-a',
      intent: {
        uuid: 'channel-a',
        op: 'update',
      },
    });
    const payload = (await response.json()) as { ok: true };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });
});
