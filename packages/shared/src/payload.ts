const MAGIC = 'ZLP1';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
const HEADER_LENGTH_BYTES = 4;
const MAX_HEADER_BYTES = 16 * 1024;
const FALLBACK_DOWNLOAD_FILE_NAME = 'download.bin';
const INVALID_FILENAME_CHARS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface TextPayloadHeader {
  kind: 'text';
}

interface FilePayloadHeader {
  kind: 'file';
  fileName: string;
  mediaType: string;
  size: number;
}

type PayloadHeader = TextPayloadHeader | FilePayloadHeader;

function isFilePayloadHeader(value: unknown): value is FilePayloadHeader {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'file' &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'mediaType' in value &&
    typeof value.mediaType === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    Number.isInteger(value.size) &&
    value.size >= 0
  );
}

export interface DecryptedTextPayload {
  kind: 'text';
  text: string;
}

export interface DecryptedFilePayload {
  kind: 'file';
  fileName: string;
  mediaType: string;
  size: number;
  bytes: Uint8Array;
}

export type DecryptedSharePayload = DecryptedTextPayload | DecryptedFilePayload;

function sanitizeFilenameChar(char: string): string {
  const codePoint = char.codePointAt(0);
  if (codePoint == null || codePoint < 0x20 || INVALID_FILENAME_CHARS.has(char)) {
    return '_';
  }
  return char;
}

export function sanitizeDownloadFilename(fileName: string | null | undefined): string {
  const normalized = Array.from((fileName ?? '').trim(), sanitizeFilenameChar).join('');
  return normalized.length > 0 ? normalized : FALLBACK_DOWNLOAD_FILE_NAME;
}

function encodeHeader(header: PayloadHeader): Uint8Array {
  return textEncoder.encode(JSON.stringify(header));
}

function buildEnvelope(header: PayloadHeader, body: Uint8Array): Uint8Array {
  const headerBytes = encodeHeader(header);
  if (headerBytes.byteLength > MAX_HEADER_BYTES) {
    throw new Error('payload header exceeds MAX_HEADER_BYTES');
  }

  const envelope = new Uint8Array(
    MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES + headerBytes.byteLength + body.byteLength
  );
  envelope.set(MAGIC_BYTES, 0);
  const view = new DataView(envelope.buffer);
  view.setUint32(MAGIC_BYTES.byteLength, headerBytes.byteLength, false);
  envelope.set(headerBytes, MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES);
  envelope.set(body, MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES + headerBytes.byteLength);
  return envelope;
}

function hasEnvelopeMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES) {
    return false;
  }

  for (let index = 0; index < MAGIC_BYTES.byteLength; index += 1) {
    if (bytes[index] !== MAGIC_BYTES[index]) {
      return false;
    }
  }
  return true;
}

function parseHeader(bytes: Uint8Array): {
  header: PayloadHeader;
  bodyOffset: number;
} {
  if (!hasEnvelopeMagic(bytes)) {
    throw new Error('payload envelope magic mismatch');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(MAGIC_BYTES.byteLength, false);
  if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error('payload header length is invalid');
  }

  const headerOffset = MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES;
  const bodyOffset = headerOffset + headerLength;
  if (bodyOffset > bytes.byteLength) {
    throw new Error('payload header length exceeds envelope size');
  }

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(textDecoder.decode(bytes.subarray(headerOffset, bodyOffset)));
  } catch {
    throw new Error('payload header is not valid JSON');
  }

  if (
    typeof parsedHeader !== 'object' ||
    parsedHeader === null ||
    !('kind' in parsedHeader) ||
    typeof parsedHeader.kind !== 'string'
  ) {
    throw new Error('payload header shape is invalid');
  }

  if (parsedHeader.kind === 'text') {
    return {
      header: { kind: 'text' },
      bodyOffset,
    };
  }

  if (isFilePayloadHeader(parsedHeader)) {
    return {
      header: {
        kind: 'file',
        fileName: parsedHeader.fileName,
        mediaType: parsedHeader.mediaType,
        size: parsedHeader.size,
      },
      bodyOffset,
    };
  }

  throw new Error('payload kind is invalid');
}

export function encodeTextSharePayload(text: string): Uint8Array {
  return buildEnvelope({ kind: 'text' }, textEncoder.encode(text));
}

export function encodeFileSharePayload(input: {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}): Uint8Array {
  return buildEnvelope(
    {
      kind: 'file',
      fileName: input.fileName,
      mediaType: input.mediaType,
      size: input.bytes.byteLength,
    },
    input.bytes
  );
}

export function decodeSharePayload(bytes: Uint8Array): DecryptedSharePayload {
  if (!hasEnvelopeMagic(bytes)) {
    return {
      kind: 'text',
      text: textDecoder.decode(bytes),
    };
  }

  const { header, bodyOffset } = parseHeader(bytes);
  const bodyBytes = bytes.slice(bodyOffset);

  if (header.kind === 'text') {
    return {
      kind: 'text',
      text: textDecoder.decode(bodyBytes),
    };
  }

  if (bodyBytes.byteLength !== header.size) {
    throw new Error('payload file size does not match body length');
  }

  return {
    kind: 'file',
    fileName: header.fileName,
    mediaType: header.mediaType,
    size: header.size,
    bytes: bodyBytes,
  };
}
