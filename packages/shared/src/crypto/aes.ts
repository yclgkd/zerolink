import { AES_GCM, MAX_PLAINTEXT_BYTES } from '../constants.ts';

const LENGTH_PREFIX_BYTES = AES_GCM.PAD_LENGTH_PREFIX_BYTES;

export interface EncryptAesGcmParams {
  key: CryptoKey;
  plaintext: Uint8Array;
  aad?: Uint8Array;
  iv?: Uint8Array;
  padBlock?: number;
}

export interface EncryptAesGcmResult {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  padBlock: number;
}

export interface DecryptAesGcmParams {
  key: CryptoKey;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  aad?: Uint8Array;
}

type WipeableBytes = ArrayBuffer | ArrayBufferView | null | undefined;

function getCryptoApi(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('WebCrypto is not available');
  }
  return cryptoApi;
}

function assertPadBlock(padBlock: number): void {
  if (!Number.isInteger(padBlock)) {
    throw new Error('padBlock must be an integer');
  }
  if (padBlock <= 0) {
    throw new Error('padBlock must be > 0');
  }
  if (padBlock > AES_GCM.PAD_BLOCK_MAX) {
    throw new Error(`padBlock must be <= ${AES_GCM.PAD_BLOCK_MAX}`);
  }
}

function assertPlaintextSize(plaintext: Uint8Array): void {
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new Error(`plaintext exceeds MAX_PLAINTEXT_BYTES (${MAX_PLAINTEXT_BYTES})`);
  }
}

function assertIvLength(iv: Uint8Array): void {
  if (iv.byteLength !== AES_GCM.IV_LENGTH) {
    throw new Error(`IV must be ${AES_GCM.IV_LENGTH} bytes`);
  }
}

export function toBufferSource(bytes: Uint8Array): BufferSource {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Uint8Array.from(bytes).buffer;
}

function toUint8Array(value: WipeableBytes): Uint8Array | null {
  if (!value) return null;
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function buildAesGcmParams(iv: Uint8Array, aad?: Uint8Array): AesGcmParams {
  const params: AesGcmParams = {
    name: AES_GCM.ALGORITHM_NAME,
    iv: toBufferSource(iv),
    tagLength: AES_GCM.TAG_LENGTH_BITS,
  };
  if (aad) {
    params.additionalData = toBufferSource(aad);
  }
  return params;
}

export function padPlaintext(
  plaintext: Uint8Array,
  padBlock: number = AES_GCM.PAD_BLOCK_DEFAULT
): Uint8Array {
  assertPadBlock(padBlock);
  assertPlaintextSize(plaintext);

  const minLength = LENGTH_PREFIX_BYTES + plaintext.byteLength;
  const paddedLength = Math.ceil(minLength / padBlock) * padBlock;
  const padded = new Uint8Array(paddedLength);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

  view.setUint32(0, plaintext.byteLength, false);
  padded.set(plaintext, LENGTH_PREFIX_BYTES);

  if (minLength < padded.byteLength) {
    getCryptoApi().getRandomValues(padded.subarray(minLength));
  }

  return padded;
}

export function unpadPlaintext(padded: Uint8Array): Uint8Array {
  if (padded.byteLength < LENGTH_PREFIX_BYTES) {
    throw new Error('padded plaintext must be at least 4 bytes');
  }

  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const originalLength = view.getUint32(0, false);
  const endOffset = LENGTH_PREFIX_BYTES + originalLength;

  if (endOffset > padded.byteLength) {
    throw new Error('invalid padded plaintext length prefix');
  }

  return padded.slice(LENGTH_PREFIX_BYTES, endOffset);
}

export async function importAesKeyFromBytes(
  bytes: Uint8Array,
  usages: ReadonlyArray<KeyUsage>
): Promise<CryptoKey> {
  return getCryptoApi().subtle.importKey(
    'raw',
    toBufferSource(bytes),
    {
      name: AES_GCM.ALGORITHM_NAME,
    },
    false,
    [...usages]
  );
}

export function wipeBytes(value: WipeableBytes): void {
  toUint8Array(value)?.fill(0);
}

export async function generateAesKey(): Promise<CryptoKey> {
  return getCryptoApi().subtle.generateKey(
    {
      name: AES_GCM.ALGORITHM_NAME,
      length: AES_GCM.KEY_LENGTH_BITS,
    },
    true,
    ['encrypt', 'decrypt']
  ) as Promise<CryptoKey>;
}

export async function encryptAesGcm({
  key,
  plaintext,
  aad,
  iv,
  padBlock = AES_GCM.PAD_BLOCK_DEFAULT,
}: EncryptAesGcmParams): Promise<EncryptAesGcmResult> {
  assertPadBlock(padBlock);
  const cryptoApi = getCryptoApi();
  const resolvedIv = iv ? iv.slice() : cryptoApi.getRandomValues(new Uint8Array(AES_GCM.IV_LENGTH));

  assertIvLength(resolvedIv);

  const paddedPlaintext = padPlaintext(plaintext, padBlock);
  const ciphertextBuffer = await cryptoApi.subtle.encrypt(
    buildAesGcmParams(resolvedIv, aad),
    key,
    toBufferSource(paddedPlaintext)
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    iv: resolvedIv,
    padBlock,
  };
}

export async function decryptAesGcm({
  key,
  ciphertext,
  iv,
  aad,
}: DecryptAesGcmParams): Promise<Uint8Array> {
  assertIvLength(iv);
  const cryptoApi = getCryptoApi();

  try {
    const plaintextBuffer = await cryptoApi.subtle.decrypt(
      buildAesGcmParams(iv, aad),
      key,
      toBufferSource(ciphertext)
    );
    return unpadPlaintext(new Uint8Array(plaintextBuffer));
  } catch (error) {
    throw new Error('AES-GCM decryption failed', { cause: error });
  }
}
