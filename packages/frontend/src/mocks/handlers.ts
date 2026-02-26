import {
  CHANNEL_STATE,
  CreateBeginRequestSchema,
  CreateBeginResponseSchema,
  CreateFinishRequestSchema,
  CreateFinishResponseSchema,
  LockBeginRequestSchema,
  LockBeginResponseSchema,
  LockCommitRequestSchema,
  LockCommitResponseSchema,
  ROUTE_PATTERN,
} from '@zerolink/shared';
import { HttpResponse, http } from 'msw';

const API_PREFIX = '*/api';
const MOCK_CHALLENGE_ID = 'bW9ja19jaGFsbGVuZ2VfaWQ';
const MOCK_CHALLENGE = 'bW9ja19jaGFsbGVuZ2VfdmFsdWU';
const MOCK_SEED = 'bW9ja19jb21wb3VuZF9zZWVk';
const MOCK_B64U = 'bW9ja19iYXNlNjR1cmw';
const MOCK_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface RequestBody {
  uuid?: unknown;
  intent?: unknown;
}

interface IntentBody {
  uuid?: unknown;
  op?: unknown;
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

async function readJsonObject(request: Request): Promise<RequestBody | null> {
  try {
    const body = await request.json();
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as RequestBody;
    }
  } catch {
    // fall through
  }

  return null;
}

function getIntentBody(body: RequestBody | null): IntentBody | null {
  if (!body) {
    return null;
  }

  const intentValue = body.intent;
  if (typeof intentValue === 'object' && intentValue !== null && !Array.isArray(intentValue)) {
    return intentValue as IntentBody;
  }

  return null;
}

function hasUuidMismatch(pathUuid: string | undefined, body: RequestBody | null): boolean {
  if (!pathUuid || !body) {
    return true;
  }

  return body.uuid !== pathUuid;
}

function hasIntentUuidMismatch(pathUuid: string | undefined, body: RequestBody | null): boolean {
  if (!pathUuid) {
    return true;
  }

  const intent = getIntentBody(body);
  if (!intent) {
    return true;
  }

  return intent.uuid !== pathUuid;
}

function hasInvalidDeleteIntent(body: RequestBody | null): boolean {
  const intent = getIntentBody(body);
  if (!intent) {
    return true;
  }

  return intent.op !== 'delete';
}

function getCreateBeginBody(body: RequestBody | null) {
  if (!body) {
    return null;
  }

  const result = CreateBeginRequestSchema.safeParse(body);
  return result.success ? result.data : null;
}

function getCreateFinishBody(body: RequestBody | null) {
  if (!body) {
    return null;
  }

  const result = CreateFinishRequestSchema.safeParse(body);
  return result.success ? result.data : null;
}

function getLockBeginBody(body: RequestBody | null) {
  if (!body) {
    return null;
  }

  const result = LockBeginRequestSchema.safeParse(body);
  return result.success ? result.data : null;
}

function getLockCommitBody(body: RequestBody | null) {
  if (!body) {
    return null;
  }

  const result = LockCommitRequestSchema.safeParse(body);
  return result.success ? result.data : null;
}

export const handlers = [
  http.get(`${API_PREFIX}/public/:uuid`, ({ params }) => {
    const pathUuid = getPathUuid(params);
    if (!pathUuid) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
      state: CHANNEL_STATE.WAITING,
    });
  }),

  http.post(`${API_PREFIX}/create_begin/:uuid`, async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    const createBeginBody = getCreateBeginBody(body);
    if (!pathUuid || !createBeginBody || createBeginBody.uuid !== pathUuid) {
      return badRequest();
    }

    const payload = {
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
    };
    const parsedPayload = CreateBeginResponseSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return badRequest();
    }

    return HttpResponse.json(parsedPayload.data);
  }),

  http.post(`${API_PREFIX}/create_finish/:uuid`, async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    const createFinishBody = getCreateFinishBody(body);
    if (!pathUuid || !createFinishBody || createFinishBody.uuid !== pathUuid) {
      return badRequest();
    }

    const shareUrl = `${ROUTE_PATTERN.SHARE.replace(':uuid', pathUuid)}#k=${MOCK_B64U}`;
    const manageUrl = ROUTE_PATTERN.MANAGE.replace(':uuid', pathUuid);

    const payload = {
      ok: true,
      shareUrl,
      manageUrl,
    };
    const parsedPayload = CreateFinishResponseSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return badRequest();
    }

    return HttpResponse.json(parsedPayload.data);
  }),

  http.post(`${API_PREFIX}/lock_begin/:uuid`, async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    const lockBeginBody = getLockBeginBody(body);
    if (!pathUuid || !lockBeginBody || lockBeginBody.uuid !== pathUuid) {
      return badRequest();
    }

    const payload = {
      ok: true,
      lockChallenge: {
        id: MOCK_CHALLENGE_ID,
        challenge: MOCK_CHALLENGE,
        expiresAt: Date.now() + 60_000,
      },
    };
    const parsedPayload = LockBeginResponseSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return badRequest();
    }

    return HttpResponse.json(parsedPayload.data);
  }),

  http.post(`${API_PREFIX}/lock_commit/:uuid`, async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    const lockCommitBody = getLockCommitBody(body);
    if (!pathUuid || !lockCommitBody || lockCommitBody.uuid !== pathUuid) {
      return badRequest();
    }

    const payload = {
      ok: true,
    };
    const parsedPayload = LockCommitResponseSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return badRequest();
    }

    return HttpResponse.json(parsedPayload.data);
  }),

  http.post(`${API_PREFIX}/manage/compound_begin/:uuid`, async ({ params, request }) => {
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

  http.post(`${API_PREFIX}/manage/compound_commit/:uuid`, async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (hasUuidMismatch(pathUuid, body) || hasIntentUuidMismatch(pathUuid, body)) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
    });
  }),

  http.post(`${API_PREFIX}/delete_commit/:uuid`, async ({ params, request }) => {
    const pathUuid = getPathUuid(params);
    const body = await readJsonObject(request);
    if (
      hasUuidMismatch(pathUuid, body) ||
      hasIntentUuidMismatch(pathUuid, body) ||
      hasInvalidDeleteIntent(body)
    ) {
      return badRequest();
    }

    return HttpResponse.json({
      ok: true,
    });
  }),
];
