/**
 * Shared fixture constants for schema tests.
 *
 * Extracted from schemas.test.ts so they can be reused across multiple
 * describe blocks without duplication.
 */

// ─── Primitive Fixtures ───────────────────────────────────────────────────────

/** Generates a 21-character string of a single repeating character. */
export const uuid21 = (c = 'a') => c.repeat(21);

/** Minimal valid base64url string. */
export const b64 = 'abc123_-ABC';

/** Minimal valid lowercase hex string. */
export const hex = 'deadbeef';

// ─── JWK Fixtures ─────────────────────────────────────────────────────────────

/** Minimal valid RSA-OAEP JWK. */
export const validJwk = {
  kty: 'RSA' as const,
  alg: 'RSA-OAEP-256' as const,
  n: b64,
  e: b64,
  ext: true as const,
  key_ops: ['encrypt'] as const,
};

/** Minimal valid ECDSA P-256 JWK. */
export const validEcdsaJwk = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: b64,
  y: b64,
  ext: true as const,
  key_ops: ['verify'] as const,
};

// ─── Compound Fixtures ────────────────────────────────────────────────────────

/** Minimal valid CipherBundle. */
export const validCipherBundle = {
  ciphertext: b64,
  iv: b64,
  aad: b64,
  encContentKey: b64,
  ciphertextHash: hex,
  padBlock: 4096,
};

/** Minimal valid AttestationJSON. */
export const validAttestation = {
  id: b64,
  rawId: b64,
  type: 'public-key' as const,
  response: {
    clientDataJSON: b64,
    attestationObject: b64,
  },
};

/** Minimal valid AssertionJSON. */
export const validAssertion = {
  id: b64,
  rawId: b64,
  type: 'public-key' as const,
  response: {
    clientDataJSON: b64,
    authenticatorData: b64,
    signature: b64,
  },
};
