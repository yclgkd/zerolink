import { CHANNEL_STATE, ROUTE_PATTERN } from '@zerolink/shared';
import { HttpResponse, http } from 'msw';

const MOCK_CHALLENGE_ID = 'bW9ja19jaGFsbGVuZ2VfaWQ';
const MOCK_CHALLENGE = 'bW9ja19jaGFsbGVuZ2VfdmFsdWU';
const MOCK_SEED = 'bW9ja19jb21wb3VuZF9zZWVk';
const MOCK_B64U = 'bW9ja19iYXNlNjR1cmw';
const MOCK_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface UuidRequestBody {
  uuid?: unknown;
}

function badRequest() {
  return HttpResponse.json(
    {
      ok: false,
      code: 'BAD_REQUEST',
    },
    { status: 400 }
  );
}

function getPathUuid(params: { uuid?: string | readonly string[] }): string | undefined {
  return typeof params.uuid === 'string' ? params.uuid : undefined;
}

async function readJsonObject(request: Request): Promise<UuidRequestBody | null> {
  try {
    const body = await request.json();
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as UuidRequestBody;
    }
  } catch {
    // fall through
  }

  return null;
}

function hasUuidMismatch(pathUuid: string | undefined, body: UuidRequestBody | null): boolean {
  if (!pathUuid || !body) {
    return true;
  }

  return body.uuid !== pathUuid;
}

export const handlers = [
  http.get('/api/public/:uuid', ({ params }) => {
    const pathUuid = getPathUuid(params);
    if (!pathUuid) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
      state: CHANNEL_STATE.WAITING,
    });
  }),

  http.post('/api/create_begin/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
      creationOptions: {
        challenge: MOCK_CHALLENGE,
        rp: { name: 'ZeroLink Mock', id: 'zerolink.test' },
        user: {
          id: MOCK_B64U,
          name: 'sender@mock.local',
          displayName: 'Mock Sender',
        },
        timeout: 60_000,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      },
    });
  }),

  http.post('/api/create_finish/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body) || !pathUuid) {
      return badRequest();
    }

    const shareUrl = `${ROUTE_PATTERN.SHARE.replace(':uuid', pathUuid)}#k=${MOCK_B64U}`;
    const manageUrl = ROUTE_PATTERN.MANAGE.replace(':uuid', pathUuid);

    return HttpResponse.json({
      ok: true,
      shareUrl,
      manageUrl,
    });
  }),

  http.post('/api/lock_begin/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
      lockChallenge: {
        id: MOCK_CHALLENGE_ID,
        challenge: MOCK_CHALLENGE,
        expiresAt: Date.now() + 60_000,
      },
    });
  }),

  http.post('/api/lock_commit/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
    });
  }),

  http.post('/api/manage/compound_begin/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
      challenge: {
        id: MOCK_CHALLENGE_ID,
        seed: MOCK_SEED,
        expiresAt: Date.now() + 60_000,
      },
      receiverPubFpr: MOCK_HEX,
      receiverPubJwk: {
        kty: 'RSA',
        alg: 'RSA-OAEP-256',
        n: MOCK_B64U,
        e: 'AQAB',
        ext: true,
        key_ops: ['encrypt'],
      },
      currentVersion: 0,
    });
  }),

  http.post('/api/manage/compound_commit/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
    });
  }),

  http.post('/api/delete_commit/:uuid', async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
    });
  }),
];
