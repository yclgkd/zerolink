import {
  FILE_SHARE,
  FilePolicyResponseSchema,
  FileSharePolicySchema,
  MAX_PLAINTEXT_BYTES,
  type FilePolicyResponse,
  type FileSharePolicy,
} from '@zerolink/shared';

export interface FilePolicyEnv {
  FILE_MAX_BYTES?: string | number;
  FILE_MULTIPART_THRESHOLD_BYTES?: string | number;
  FILE_CHUNK_SIZE_BYTES?: string | number;
  FILE_MAX_CHUNKS?: string | number;
  FILE_MULTIPART_SUPPORTED?: string | boolean;
}

function parsePositiveInt(
  value: string | number | undefined,
  fallback: number,
  key: keyof FilePolicyEnv
): number {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return parsed;
}

function parseBoolean(
  value: string | boolean | undefined,
  fallback: boolean,
  key: keyof FilePolicyEnv
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value == null || value.trim() === '') {
    return fallback;
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${key} must be "true" or "false"`);
}

export function resolveFilePolicy(env: FilePolicyEnv): FileSharePolicy {
  const policy = FileSharePolicySchema.parse({
    maxFileBytes: parsePositiveInt(
      env.FILE_MAX_BYTES,
      FILE_SHARE.MAX_BYTES_DEFAULT,
      'FILE_MAX_BYTES'
    ),
    multipartThresholdBytes: parsePositiveInt(
      env.FILE_MULTIPART_THRESHOLD_BYTES,
      FILE_SHARE.MULTIPART_THRESHOLD_DEFAULT,
      'FILE_MULTIPART_THRESHOLD_BYTES'
    ),
    chunkSizeBytes: parsePositiveInt(
      env.FILE_CHUNK_SIZE_BYTES,
      FILE_SHARE.CHUNK_SIZE_DEFAULT,
      'FILE_CHUNK_SIZE_BYTES'
    ),
    maxChunks: parsePositiveInt(
      env.FILE_MAX_CHUNKS,
      FILE_SHARE.MAX_CHUNKS_DEFAULT,
      'FILE_MAX_CHUNKS'
    ),
    multipartSupported: parseBoolean(
      env.FILE_MULTIPART_SUPPORTED,
      FILE_SHARE.MULTIPART_SUPPORTED,
      'FILE_MULTIPART_SUPPORTED'
    ),
  });

  if (policy.maxFileBytes > MAX_PLAINTEXT_BYTES) {
    throw new Error(`FILE_MAX_BYTES must be <= ${MAX_PLAINTEXT_BYTES} for inline delivery`);
  }

  return policy;
}

export function toFilePolicyResponse(env: FilePolicyEnv): FilePolicyResponse {
  return FilePolicyResponseSchema.parse({
    ok: true,
    policy: resolveFilePolicy(env),
  });
}
