import {
  type Base64Url,
  FileFetchResponseSchema,
  FileUploadCompleteRequestSchema,
  FileUploadInitiateRequestSchema,
  type HexString,
  type MultipartFileRef,
  type UnixMs,
} from '@zerolink/shared';
import { resolveFilePolicy } from './file-policy.ts';
import {
  buildMultipartChunkStorageKey,
  buildMultipartFileRef,
  createFileUploadId,
  FILE_UPLOAD_TTL_MS,
  makeFileCompleteResponse,
  makeFileUploadResponse,
  parseFileUploadId,
} from './file-storage.ts';
import type { Env } from './worker.ts';

function buildHeaders(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  const headers = buildHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ ok: false, code }, status);
}

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function forwardFilePayloadLookup(env: Env, uuid: string): Promise<MultipartFileRef | null> {
  const durableObjectId = env.SECRET_VAULT.idFromName(uuid);
  const stub = env.SECRET_VAULT.get(durableObjectId);
  const response = await stub.fetch('https://secret-vault.internal/get_file_payload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({}),
  });

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    fileRef?: MultipartFileRef;
    payloadTransport?: string;
  } | null;
  if (
    !response.ok ||
    !payload?.ok ||
    payload.payloadTransport !== 'multipart' ||
    !payload.fileRef
  ) {
    return null;
  }

  return payload.fileRef;
}

export async function handleFileUploadInitiate(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  if (body == null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = FileUploadInitiateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const policy = resolveFilePolicy(env);
  if (!policy.multipartSupported) {
    return errorResponse('BAD_REQUEST', 400);
  }
  if (parsed.data.chunkCount > policy.maxChunks) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const now = Date.now() as UnixMs;
  const uploadId = await createFileUploadId(env.COMMIT_TOKEN_SECRET, {
    v: '1',
    channelUuid: parsed.data.channelUuid,
    chunkCount: parsed.data.chunkCount,
    totalCiphertextBytes: parsed.data.totalCiphertextBytes,
    issuedAt: now,
    expiresAt: (Number(now) + FILE_UPLOAD_TTL_MS) as UnixMs,
  });

  return jsonResponse(
    makeFileUploadResponse(uploadId, parsed.data.chunkCount, request.url, parsed.data.channelUuid),
    200
  );
}

export async function handleFileChunkUpload(
  request: Request,
  env: Env,
  uuid: string,
  uploadId: string,
  index: number
): Promise<Response> {
  if (!env.FILE_BUCKET || !request.body) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const uploadSession = await parseFileUploadId(env.COMMIT_TOKEN_SECRET, uploadId);
  if (!uploadSession || uploadSession.channelUuid !== uuid) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (!Number.isInteger(index) || index < 0 || index >= uploadSession.chunkCount) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const storageKey = buildMultipartChunkStorageKey(uuid, uploadId as Base64Url, index);
  const uploadedObject = await env.FILE_BUCKET.put(storageKey, request.body, {
    httpMetadata: {
      contentType: 'application/octet-stream',
    },
    customMetadata: {
      channelUuid: uuid,
      uploadId,
      chunkIndex: String(index),
      expiresAt: String(uploadSession.expiresAt),
    },
  });

  const headers = buildHeaders();
  headers.set('ETag', uploadedObject.etag);
  return new Response(null, { status: 200, headers });
}

export async function handleFileUploadComplete(request: Request, env: Env): Promise<Response> {
  if (!env.FILE_BUCKET) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const body = await readJsonBody(request);
  if (body == null) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const parsed = FileUploadCompleteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const uploadSession = await parseFileUploadId(env.COMMIT_TOKEN_SECRET, parsed.data.uploadId);
  if (!uploadSession) {
    return errorResponse('BAD_REQUEST', 400);
  }

  if (
    uploadSession.chunkCount !== parsed.data.chunks.length ||
    uploadSession.totalCiphertextBytes !== parsed.data.totalCiphertextBytes ||
    parsed.data.chunks.some((chunk, index) => chunk.index !== index)
  ) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const sortedChunks = [...parsed.data.chunks].sort((left, right) => left.index - right.index);
  const resolvedChunks: Array<{
    index: number;
    storageKey: string;
    ciphertextBytes: number;
    ciphertextHash: HexString;
    etag: string;
  }> = [];

  for (const chunk of sortedChunks) {
    const storageKey = buildMultipartChunkStorageKey(
      uploadSession.channelUuid,
      parsed.data.uploadId as Base64Url,
      chunk.index
    );
    const storedObject = await env.FILE_BUCKET.head(storageKey);
    if (!storedObject) {
      return errorResponse('UPLOAD_INCOMPLETE', 409);
    }
    if (storedObject.size !== chunk.ciphertextBytes) {
      return errorResponse('BAD_REQUEST', 400);
    }
    if (storedObject.etag !== chunk.etag) {
      return errorResponse('UPLOAD_INCOMPLETE', 409);
    }

    resolvedChunks.push({
      index: chunk.index,
      storageKey,
      ciphertextBytes: chunk.ciphertextBytes,
      ciphertextHash: chunk.ciphertextHash,
      etag: chunk.etag,
    });
  }

  return jsonResponse(
    makeFileCompleteResponse(buildMultipartFileRef(uploadSession, parsed.data, resolvedChunks)),
    200
  );
}

export async function handleFileFetch(env: Env, uuid: string): Promise<Response> {
  const fileRef = await forwardFilePayloadLookup(env, uuid);
  if (!fileRef) {
    return errorResponse('CHANNEL_NOT_MULTIPART', 409);
  }

  const response = FileFetchResponseSchema.parse({
    ok: true,
    chunks: fileRef.chunks.map((chunk) => ({
      index: chunk.index,
      downloadUrl: `/api/file/dl/${uuid}/${chunk.index}`,
    })),
  });
  return jsonResponse(response, 200);
}

export async function handleFileDownload(env: Env, uuid: string, index: number): Promise<Response> {
  if (!env.FILE_BUCKET || !Number.isInteger(index) || index < 0) {
    return errorResponse('BAD_REQUEST', 400);
  }

  const fileRef = await forwardFilePayloadLookup(env, uuid);
  if (!fileRef) {
    return errorResponse('CHANNEL_NOT_MULTIPART', 409);
  }

  const chunk = fileRef.chunks.find((entry) => entry.index === index);
  if (!chunk) {
    return errorResponse('NOT_FOUND', 404);
  }

  const object = await env.FILE_BUCKET.get(chunk.storageKey);
  if (!object) {
    return errorResponse('NOT_FOUND', 404);
  }

  const headers = buildHeaders();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, {
    status: 200,
    headers,
  });
}
