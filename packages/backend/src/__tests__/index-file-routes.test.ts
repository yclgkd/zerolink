import type { MultipartFileRef } from '@zerolink/shared';
import { describe, expect, it } from 'vitest';

import { createMockEnv, dispatch, VALID_UUID } from './helpers/worker-fixtures.ts';

describe('backend worker routing — file upload and fetch routes', () => {
  it('handles multipart initiate, chunk upload, completion, fetch, and download', async () => {
    let currentFileRef: MultipartFileRef | null = null;
    const { env, calls } = createMockEnv(async (request) => {
      if (request.url.endsWith('/get_file_payload')) {
        if (!currentFileRef) {
          return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
            status: 404,
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            payloadTransport: 'multipart',
            fileRef: currentFileRef,
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ ok: false, code: 'UNEXPECTED' }), {
        status: 500,
      });
    });

    env.FILE_MULTIPART_SUPPORTED = 'true';
    env.FILE_MAX_BYTES = 32;
    env.FILE_MULTIPART_THRESHOLD_BYTES = 16;
    env.FILE_CHUNK_SIZE_BYTES = 8;
    env.FILE_MAX_CHUNKS = 4;

    const initiateResponse = await dispatch(env, '/api/file/initiate', 'POST', {
      channelUuid: VALID_UUID,
      chunkCount: 2,
      totalCiphertextBytes: 16,
    });
    const initiatePayload = (await initiateResponse.json()) as {
      ok: true;
      uploadId: string;
      chunks: Array<{ index: number; uploadUrl: string }>;
    };

    expect(initiateResponse.status).toBe(200);
    expect(initiatePayload.chunks).toHaveLength(2);
    expect(initiatePayload.chunks[0]?.uploadUrl).toContain(
      `/api/file/chunk/${VALID_UUID}/${initiatePayload.uploadId}/0`
    );
    expect(calls).toHaveLength(0);

    const chunk0Body = 'cipher-0';
    const chunk1Body = 'cipher-1';

    const chunk0Response = await dispatch(
      env,
      `/api/file/chunk/${VALID_UUID}/${initiatePayload.uploadId}/0`,
      'PUT',
      chunk0Body,
      true
    );
    const chunk1Response = await dispatch(
      env,
      `/api/file/chunk/${VALID_UUID}/${initiatePayload.uploadId}/1`,
      'PUT',
      chunk1Body,
      true
    );

    expect(chunk0Response.status).toBe(200);
    expect(chunk1Response.status).toBe(200);
    const chunk0Etag = chunk0Response.headers.get('ETag');
    const chunk1Etag = chunk1Response.headers.get('ETag');
    expect(chunk0Etag).toBeTruthy();
    expect(chunk1Etag).toBeTruthy();

    const completeResponse = await dispatch(env, '/api/file/complete', 'POST', {
      uploadId: initiatePayload.uploadId,
      baseIv: 'base_iv',
      encContentKey: 'enc_content_key',
      chunkSizeBytes: 8,
      totalPlaintextBytes: 8,
      totalCiphertextBytes: 16,
      chunks: [
        {
          index: 0,
          etag: chunk0Etag,
          ciphertextBytes: chunk0Body.length,
          ciphertextHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          index: 1,
          etag: chunk1Etag,
          ciphertextBytes: chunk1Body.length,
          ciphertextHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    });
    const completePayload = (await completeResponse.json()) as {
      ok: true;
      fileRef: MultipartFileRef;
    };

    expect(completeResponse.status).toBe(200);
    expect(completePayload.fileRef.storageBackend).toBe('r2');
    expect(completePayload.fileRef.chunks).toHaveLength(2);

    currentFileRef = completePayload.fileRef;

    const fetchResponse = await dispatch(env, `/api/file/fetch/${VALID_UUID}`, 'GET');
    const fetchPayload = (await fetchResponse.json()) as {
      ok: true;
      chunks: Array<{ index: number; downloadUrl: string }>;
    };

    expect(fetchResponse.status).toBe(200);
    expect(fetchPayload.chunks).toEqual([
      { index: 0, downloadUrl: `/api/file/dl/${VALID_UUID}/0` },
      { index: 1, downloadUrl: `/api/file/dl/${VALID_UUID}/1` },
    ]);

    const downloadResponse = await dispatch(env, `/api/file/dl/${VALID_UUID}/0`, 'GET');
    expect(downloadResponse.status).toBe(200);
    expect(await downloadResponse.text()).toBe(chunk0Body);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.pathname).toBe('/get_file_payload');
    expect(calls[1]?.pathname).toBe('/get_file_payload');
  });
});
