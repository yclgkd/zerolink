import {
  AES_GCM,
  FILE_SHARE,
  type FilePolicyResponse,
  type FileSharePolicy,
  FileSharePolicySchema,
  MAX_PLAINTEXT_BYTES,
} from '@zerolink/shared';

export interface FilePolicyEnv {
  FILE_MAX_BYTES?: string | number;
  FILE_MULTIPART_THRESHOLD_BYTES?: string | number;
  FILE_CHUNK_SIZE_BYTES?: string | number;
  FILE_MAX_CHUNKS?: string | number;
  FILE_MULTIPART_SUPPORTED?: string | boolean;
}

const MAX_INLINE_FILE_BYTES =
  MAX_PLAINTEXT_BYTES - FILE_SHARE.ENVELOPE_FIXED_BYTES - FILE_SHARE.HEADER_MAX_BYTES;

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

  if (policy.multipartThresholdBytes > MAX_INLINE_FILE_BYTES) {
    throw new Error(
      `FILE_MULTIPART_THRESHOLD_BYTES must be <= ${MAX_INLINE_FILE_BYTES} for inline delivery`
    );
  }

  if (!policy.multipartSupported && policy.maxFileBytes > MAX_INLINE_FILE_BYTES) {
    throw new Error(`FILE_MAX_BYTES must be <= ${MAX_INLINE_FILE_BYTES} for inline delivery`);
  }

  return policy;
}

export function resolveInlineFilePlaintextBytes(maxFileBytes: number): number {
  return maxFileBytes + FILE_SHARE.ENVELOPE_FIXED_BYTES + FILE_SHARE.HEADER_MAX_BYTES;
}

export function resolveMaxFileCiphertextBytes(maxFileBytes: number, padBlock: number): number {
  const paddedPlaintextBytes =
    Math.ceil(
      (AES_GCM.PAD_LENGTH_PREFIX_BYTES + resolveInlineFilePlaintextBytes(maxFileBytes)) / padBlock
    ) * padBlock;
  return paddedPlaintextBytes + AES_GCM.TAG_LENGTH_BITS / 8;
}

export function resolveMaxInlineFileCiphertextBytes(
  multipartThresholdBytes: number,
  padBlock: number
): number {
  return resolveMaxFileCiphertextBytes(multipartThresholdBytes, padBlock);
}

export function toFilePolicyResponse(env: FilePolicyEnv): FilePolicyResponse {
  return { ok: true, policy: resolveFilePolicy(env) };
}
