import { verifyAsync } from '@noble/ed25519';

export interface VerifyEd25519FallbackOptions {
  readonly manifestBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
  readonly rawPublicKeyBytes: Uint8Array;
}

export async function verifyEd25519Signature(
  options: VerifyEd25519FallbackOptions
): Promise<boolean> {
  const { manifestBytes, signatureBytes, rawPublicKeyBytes } = options;

  // Normalize malformed inputs to `false` while allowing environment failures
  // (for example missing WebCrypto digest support) to propagate upward.
  if (signatureBytes.byteLength !== 64 || rawPublicKeyBytes.byteLength !== 32) {
    return false;
  }

  return verifyAsync(signatureBytes, manifestBytes, rawPublicKeyBytes);
}
