import type { HexString, UUID } from './types.ts';

const aadEncoder = new TextEncoder();

export interface CipherBundleAadParts {
  uuid: UUID | string;
  version: number;
  receiverPubFpr: HexString | string;
}

/**
 * Canonical AES-GCM AAD text binding for delivered ciphertext.
 */
export function buildCipherBundleAadString({
  uuid,
  version,
  receiverPubFpr,
}: CipherBundleAadParts): string {
  return `${uuid}||${String(version)}||${receiverPubFpr}`;
}

/**
 * UTF-8 bytes of the canonical AES-GCM AAD binding string.
 */
export function buildCipherBundleAadBytes(parts: CipherBundleAadParts): Uint8Array {
  return aadEncoder.encode(buildCipherBundleAadString(parts));
}
