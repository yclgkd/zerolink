import type {
  FileDownloadChunkTarget,
  FileSharePolicy,
  MultipartFileRef,
  RSAPublicKeyJWK,
  UUID,
  WrappedPrivateKey,
} from '@zerolink/shared';
import {
  AES_GCM,
  buildMultipartChunkAadBytes,
  concatBytes,
  deriveMultipartChunkIv,
  encodeFileSharePayloadPrefix,
  resolveMultipartChunkCount,
} from '@zerolink/shared';
import {
  decryptAesGcmRaw,
  encryptAesGcmRaw,
  importAesKeyFromBytes,
  wipeBytes,
} from '@zerolink/shared/crypto/aes';
import { unwrapPrivateKey } from '@zerolink/shared/crypto/kdf';
import {
  importReceiverPublicKeyFromJwk,
  unwrapContentKey,
  wrapContentKey,
} from '@zerolink/shared/crypto/rsa';
import type {
  CryptoOrchestratorResult,
  DeliverSecretInput,
  ResolvedDeps,
} from './orchestrator-types';
import { asUuid, toError } from './orchestrator-utils';
import { computeSha256Hex, decodeBase64UrlBytes, encodeBase64UrlBytes } from './protocol-utils';

interface ResolvedFileInput {
  fileName: string;
  mediaType: string;
  size: number;
  readRange: (start: number, end: number) => Promise<Uint8Array>;
}

function resolveFileSize(file: NonNullable<DeliverSecretInput['file']>): number {
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0) {
    return file.size;
  }
  if (file.bytes) {
    return file.bytes.byteLength;
  }
  if (file.blob) {
    return file.blob.size;
  }
  throw new Error('file input is missing bytes/blob content');
}

function resolveFileInput(file: NonNullable<DeliverSecretInput['file']>): ResolvedFileInput {
  const size = resolveFileSize(file);

  return {
    fileName: file.fileName,
    mediaType: file.mediaType,
    size,
    async readRange(start: number, end: number): Promise<Uint8Array> {
      const boundedStart = Math.max(0, start);
      const boundedEnd = Math.max(boundedStart, Math.min(end, size));
      if (boundedEnd === boundedStart) {
        return new Uint8Array();
      }

      if (file.bytes) {
        return file.bytes.slice(boundedStart, boundedEnd);
      }
      if (file.blob) {
        return new Uint8Array(await file.blob.slice(boundedStart, boundedEnd).arrayBuffer());
      }

      throw new Error('file input is missing readable content');
    },
  };
}

export async function readWholeFileInputBytes(
  file: NonNullable<DeliverSecretInput['file']>
): Promise<Uint8Array> {
  return resolveFileInput(file).readRange(0, resolveFileSize(file));
}

function buildTotalCiphertextBytes(totalPlaintextBytes: number, chunkCount: number): number {
  return totalPlaintextBytes + chunkCount * (AES_GCM.TAG_LENGTH_BITS / 8);
}

function normalizeChunkTargets<T extends { index: number }>(
  chunks: readonly T[],
  expectedCount: number
): T[] {
  const sorted = [...chunks].sort((left, right) => left.index - right.index);
  if (sorted.length !== expectedCount) {
    throw new Error('chunk target count mismatch');
  }
  for (let index = 0; index < sorted.length; index += 1) {
    if ((sorted[index]?.index ?? -1) !== index) {
      throw new Error('chunk target index mismatch');
    }
  }
  return sorted;
}

async function buildPlaintextChunk(
  file: ResolvedFileInput,
  prefixBytes: Uint8Array,
  chunkSizeBytes: number,
  chunkIndex: number
): Promise<Uint8Array> {
  const totalPlaintextBytes = prefixBytes.byteLength + file.size;
  const start = chunkIndex * chunkSizeBytes;
  const end = Math.min(totalPlaintextBytes, start + chunkSizeBytes);
  const output = new Uint8Array(end - start);
  let offset = 0;

  if (start < prefixBytes.byteLength) {
    const prefixEnd = Math.min(prefixBytes.byteLength, end);
    const prefixSlice = prefixBytes.subarray(start, prefixEnd);
    output.set(prefixSlice, offset);
    offset += prefixSlice.byteLength;
  }

  const fileStart = Math.max(0, start - prefixBytes.byteLength);
  const fileEnd = Math.max(0, end - prefixBytes.byteLength);
  if (fileEnd > fileStart) {
    const fileSlice = await file.readRange(fileStart, fileEnd);
    output.set(fileSlice, offset);
    wipeBytes(fileSlice);
  }

  return output;
}

export async function uploadMultipartFile(
  deps: ResolvedDeps,
  input: DeliverSecretInput,
  filePolicy: FileSharePolicy,
  receiverPubJwk: RSAPublicKeyJWK,
  channelUuid: UUID
): Promise<CryptoOrchestratorResult<MultipartFileRef>> {
  if (!input.file) {
    return toError('CRYPTO_ERROR', 'deliver.multipart', 'missing file payload');
  }

  const file = resolveFileInput(input.file);
  const prefixBytes = encodeFileSharePayloadPrefix({
    fileName: file.fileName,
    mediaType: file.mediaType,
    size: file.size,
  });
  const totalPlaintextBytes = prefixBytes.byteLength + file.size;
  const chunkCount = resolveMultipartChunkCount(totalPlaintextBytes, filePolicy.chunkSizeBytes);
  if (chunkCount > filePolicy.maxChunks) {
    return toError('FILE_TOO_LARGE', 'deliver.multipart', 'file requires too many chunks');
  }

  const totalCiphertextBytes = buildTotalCiphertextBytes(totalPlaintextBytes, chunkCount);
  const initiateRes = await deps.client.fileUploadInitiate({
    channelUuid,
    chunkCount,
    totalCiphertextBytes,
  });
  if (!initiateRes.ok) {
    return toError(initiateRes.error.code, 'deliver.file-upload.initiate');
  }

  let rawContentKey: Uint8Array | null = null;
  let wrappedContentKey: Uint8Array | null = null;
  let baseIv: Uint8Array | null = null;

  try {
    rawContentKey = deps.randomBytes(AES_GCM.KEY_LENGTH_BITS / 8);
    baseIv = deps.randomBytes(AES_GCM.IV_LENGTH);
    const aesKey = await importAesKeyFromBytes(rawContentKey, ['encrypt', 'decrypt']);
    const receiverPublicKey = await importReceiverPublicKeyFromJwk(receiverPubJwk);
    wrappedContentKey = await wrapContentKey({
      receiverPublicKey,
      contentKey: rawContentKey,
    });

    const uploadTargets = normalizeChunkTargets(initiateRes.data.chunks, chunkCount);
    const uploadedChunks: Array<{
      index: number;
      etag: string;
      ciphertextBytes: number;
      ciphertextHash: string;
    }> = [];

    for (const target of uploadTargets) {
      let plaintextChunk: Uint8Array | null = null;
      let aadBytes: Uint8Array | null = null;
      let ivBytes: Uint8Array | null = null;
      let ciphertextChunk: Uint8Array | null = null;

      try {
        plaintextChunk = await buildPlaintextChunk(
          file,
          prefixBytes,
          filePolicy.chunkSizeBytes,
          target.index
        );
        aadBytes = buildMultipartChunkAadBytes({
          channelUuid,
          index: target.index,
        });
        ivBytes = deriveMultipartChunkIv(baseIv, target.index);
        ciphertextChunk = (
          await encryptAesGcmRaw({
            key: aesKey,
            plaintext: plaintextChunk,
            aad: aadBytes,
            iv: ivBytes,
          })
        ).ciphertext;

        const ciphertextHash = await computeSha256Hex(ciphertextChunk);
        const uploadRes = await deps.client.fileUploadChunk(target.uploadUrl, ciphertextChunk);
        if (!uploadRes.ok) {
          return toError(uploadRes.error.code, 'deliver.file-upload.chunk');
        }
        uploadedChunks.push({
          index: target.index,
          etag: uploadRes.data.etag,
          ciphertextBytes: ciphertextChunk.byteLength,
          ciphertextHash,
        });
      } finally {
        wipeBytes(plaintextChunk);
        wipeBytes(aadBytes);
        wipeBytes(ivBytes);
        wipeBytes(ciphertextChunk);
      }
    }

    const completeRes = await deps.client.fileUploadComplete({
      uploadId: initiateRes.data.uploadId,
      baseIv: encodeBase64UrlBytes(baseIv),
      encContentKey: encodeBase64UrlBytes(wrappedContentKey),
      chunkSizeBytes: filePolicy.chunkSizeBytes,
      totalPlaintextBytes,
      totalCiphertextBytes,
      chunks: uploadedChunks,
    });
    if (!completeRes.ok) {
      return toError(completeRes.error.code, 'deliver.file-upload.complete');
    }

    return {
      ok: true,
      data: completeRes.data.fileRef,
    };
  } finally {
    wipeBytes(rawContentKey);
    wipeBytes(wrappedContentKey);
    wipeBytes(baseIv);
    wipeBytes(prefixBytes);
  }
}

async function fetchBinaryChunk(downloadUrl: string): Promise<Uint8Array> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error('DOWNLOAD_FAILED');
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function decryptMultipartFile(
  deps: ResolvedDeps,
  uuid: string,
  fileRef: MultipartFileRef,
  passphrase: string,
  wrappedPrivateKey: WrappedPrivateKey
): Promise<CryptoOrchestratorResult<Uint8Array>> {
  const fileFetchRes = await deps.client.fileFetch(asUuid(uuid));
  if (!fileFetchRes.ok) {
    return toError(fileFetchRes.error.code, 'decrypt.file-fetch');
  }

  const downloadTargets = normalizeChunkTargets<FileDownloadChunkTarget>(
    fileFetchRes.data.chunks,
    fileRef.chunkCount
  );
  const expectedBaseIv = decodeBase64UrlBytes(fileRef.baseIv);
  let wrappedContentKey: Uint8Array | null = null;
  let rawContentKey: Uint8Array | null = null;

  try {
    const receiverPrivateKey = await unwrapPrivateKey({
      wrapped: wrappedPrivateKey,
      password: passphrase,
      kdfParams: deps.kdfParams,
    });

    wrappedContentKey = decodeBase64UrlBytes(fileRef.encContentKey);
    rawContentKey = await unwrapContentKey({
      receiverPrivateKey,
      wrappedKey: wrappedContentKey,
    });
    const aesKey = await importAesKeyFromBytes(rawContentKey, ['decrypt']);

    const plaintextChunks: Uint8Array[] = [];
    let totalCiphertextBytes = 0;

    for (const target of downloadTargets) {
      let ciphertextChunk: Uint8Array | null = null;
      let aadBytes: Uint8Array | null = null;
      let ivBytes: Uint8Array | null = null;
      let plaintextChunk: Uint8Array | null = null;

      try {
        ciphertextChunk = await fetchBinaryChunk(target.downloadUrl);
        totalCiphertextBytes += ciphertextChunk.byteLength;
        const expectedHash = fileRef.chunks[target.index]?.ciphertextHash ?? '';
        const actualHash = await computeSha256Hex(ciphertextChunk);
        if (actualHash !== expectedHash) {
          return toError('INTEGRITY_MISMATCH', 'decrypt.file-chunk.hash');
        }

        aadBytes = buildMultipartChunkAadBytes({
          channelUuid: uuid,
          index: target.index,
        });
        ivBytes = deriveMultipartChunkIv(expectedBaseIv, target.index);
        plaintextChunk = await decryptAesGcmRaw({
          key: aesKey,
          ciphertext: ciphertextChunk,
          aad: aadBytes,
          iv: ivBytes,
        });
        plaintextChunks.push(plaintextChunk.slice());
      } catch (error) {
        if (error instanceof Error && error.message === 'DOWNLOAD_FAILED') {
          return toError('NETWORK_ERROR', 'decrypt.file-chunk.download');
        }
        if (error instanceof Error && error.message === 'INTEGRITY_MISMATCH') {
          return toError('INTEGRITY_MISMATCH', 'decrypt.file-chunk.decrypt');
        }
        return toError('CRYPTO_ERROR', 'decrypt.file-chunk.decrypt');
      } finally {
        wipeBytes(ciphertextChunk);
        wipeBytes(aadBytes);
        wipeBytes(ivBytes);
        wipeBytes(plaintextChunk);
      }
    }

    if (totalCiphertextBytes !== fileRef.totalCiphertextBytes) {
      return toError('INTEGRITY_MISMATCH', 'decrypt.file-total-bytes');
    }

    const plaintextBytes = concatBytes(plaintextChunks);
    for (const chunk of plaintextChunks) {
      wipeBytes(chunk);
    }
    return {
      ok: true,
      data: plaintextBytes,
    };
  } finally {
    wipeBytes(expectedBaseIv);
    wipeBytes(wrappedContentKey);
    wipeBytes(rawContentKey);
  }
}
