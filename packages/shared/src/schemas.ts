import { z } from 'zod';

import {
  AES_GCM,
  CHANNEL_STATE,
  PBKDF2_ITERATIONS,
  SAFETY_CODE,
  SECURITY_PROFILE,
  UUID_LENGTH,
} from './constants.ts';
import type {
  Base64Url,
  ECDSAPublicKeyJWK,
  HexString,
  SafetyCodeColor,
  SafetyCodeEmoji,
  UnixMs,
  UUID,
} from './types.ts';

// ─── Design Note ──────────────────────────────────────────────────────────────
//
// This project uses exactOptionalPropertyTypes: true.  Zod v4's .optional()
// always adds | undefined to the inferred output type, which is structurally
// wider than the strict { field?: T } produced by exactOptionalPropertyTypes.
// Adding explicit z.ZodType<T> annotations on schemas that contain optional
// fields therefore causes TS2375 errors.
//
// Resolution: no z.ZodType<T> annotations anywhere in this file.  TypeScript
// infers all schema types from the definition.  Compile-time shape correctness
// is validated via `satisfies` and type-level assertions in the test file
// (packages/shared/src/__tests__/schemas.test.ts).

// ─── Primitive Schemas ────────────────────────────────────────────────────────

/** 21-character NanoID channel identifier (base64url alphabet). */
export const UUIDSchema = z
  .string()
  .length(UUID_LENGTH, `UUID must be exactly ${UUID_LENGTH} characters`)
  .regex(/^[A-Za-z0-9_-]+$/, 'UUID must use the NanoID base64url alphabet')
  .transform((v) => v as UUID);

/** URL-safe base64 string without padding (RFC 4648 §5). */
export const Base64UrlSchema = z
  .string()
  .min(1, 'base64url string must not be empty')
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url (no padding, no + or /)')
  .transform((v) => v as Base64Url);

/** Lowercase hexadecimal string. */
export const HexStringSchema = z
  .string()
  .min(1, 'hex string must not be empty')
  .regex(/^[0-9a-f]+$/, 'must be lowercase hexadecimal')
  .transform((v) => v as HexString);

/** Unix timestamp in milliseconds (non-negative integer). */
export const UnixMsSchema = z
  .number()
  .int('timestamp must be an integer')
  .nonnegative('timestamp must be non-negative')
  .transform((v) => v as UnixMs);

// ─── Enum / Discriminant Schemas ──────────────────────────────────────────────

export const ChannelStateSchema = z.enum([
  CHANNEL_STATE.WAITING,
  CHANNEL_STATE.LOCKED,
  CHANNEL_STATE.DELIVERED,
  CHANNEL_STATE.DELETED,
  CHANNEL_STATE.EXPIRED,
]);

/** Accepts new profiles (quick/secure) and legacy values for backward compatibility. */
export const SecurityProfileSchema = z.enum([
  SECURITY_PROFILE.QUICK,
  SECURITY_PROFILE.SECURE,
  // Legacy — existing channels stored with these values must still parse
  SECURITY_PROFILE.STANDARD,
  SECURITY_PROFILE.STRICT,
  SECURITY_PROFILE.HARDWARE_ONLY,
]);

export const ChannelTtlMsSchema = z.union([
  z.literal(3_600_000),
  z.literal(86_400_000),
  z.literal(604_800_000),
]);

/** 'password' is the canonical new name; 'softkey' is the legacy alias. */
export const AdminModeSchema = z.enum(['webauthn', 'password', 'softkey']);

/** WebAuthn Level 3 authenticator transport values. */
export const AuthenticatorTransportSchema = z.enum([
  'usb',
  'nfc',
  'ble',
  'smart-card',
  'hybrid',
  'internal',
]);

// ─── RSAPublicKeyJWK Schema ───────────────────────────────────────────────────

export const RSAPublicKeyJWKSchema = z.object({
  kty: z.literal('RSA'),
  alg: z.literal('RSA-OAEP-256'),
  n: Base64UrlSchema,
  e: Base64UrlSchema,
  ext: z.literal(true),
  key_ops: z.tuple([z.literal('encrypt')]),
});

// ─── ECDSAPublicKeyJWK Schema ─────────────────────────────────────────────────

/** ECDSA P-256 public key in JWK format (used by softkey compat mode). */
export const ECDSAPublicKeyJWKSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: Base64UrlSchema,
  y: Base64UrlSchema,
  ext: z.literal(true),
  key_ops: z.tuple([z.literal('verify')]),
}) as z.ZodType<ECDSAPublicKeyJWK>;

// ─── KDF Parameter Schemas ────────────────────────────────────────────────────

export const Argon2idParamsSchema = z.object({
  kdfType: z.literal('argon2id'),
  /** Argon2id version — must be 19 (0x13) per RFC 9106. */
  version: z.literal(19),
  m: z.number().int().min(1, 'memory cost must be positive'),
  t: z.number().int().min(1, 'time cost must be positive'),
  p: z.number().int().min(1, 'parallelism must be positive'),
  salt: Base64UrlSchema,
});

export const Pbkdf2ParamsSchema = z.object({
  kdfType: z.literal('pbkdf2'),
  /** Iteration count — OWASP 2023 minimum is 600 000. */
  iterations: z
    .number()
    .int()
    .min(PBKDF2_ITERATIONS, `PBKDF2 iterations must be >= ${PBKDF2_ITERATIONS}`),
  salt: Base64UrlSchema,
});

export const KdfParamsSchema = z.discriminatedUnion('kdfType', [
  Argon2idParamsSchema,
  Pbkdf2ParamsSchema,
]);

// ─── WrappedPrivateKey Schema ─────────────────────────────────────────────────

export const WrappedPrivateKeySchema = z.object({
  encryptedKey: Base64UrlSchema,
  iv: Base64UrlSchema,
  kdf: KdfParamsSchema,
});

// ─── CipherBundle Schema ──────────────────────────────────────────────────────

export const CipherBundleSchema = z.object({
  ciphertext: Base64UrlSchema,
  iv: Base64UrlSchema,
  aad: Base64UrlSchema,
  encContentKey: Base64UrlSchema,
  ciphertextHash: HexStringSchema,
  padBlock: z
    .number()
    .int()
    .min(1, 'padBlock must be positive')
    .max(AES_GCM.PAD_BLOCK_MAX, `padBlock must be <= ${AES_GCM.PAD_BLOCK_MAX}`),
});

// ─── Safety Code Schemas ──────────────────────────────────────────────────────

export const SafetyCodeEmojiSchema = z.object({
  type: z.literal('emoji'),
  // Cast to the exact readonly tuple type from types.ts so the discriminated
  // union can narrow correctly.
  emojis: z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
  ]) as z.ZodType<SafetyCodeEmoji['emojis']>,
});

const colorCellSchema = z
  .number()
  .int()
  .min(0)
  .max(
    SAFETY_CODE.COLOR_PALETTE_SIZE - 1,
    `color cell must be 0–${SAFETY_CODE.COLOR_PALETTE_SIZE - 1}`
  );

export const SafetyCodeColorSchema = z.object({
  type: z.literal('color'),
  cells: z.tuple([
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
    colorCellSchema,
  ]) as z.ZodType<SafetyCodeColor['cells']>,
});

export const SafetyCodeSchema = z.discriminatedUnion('type', [
  SafetyCodeEmojiSchema,
  SafetyCodeColorSchema,
]);

// ─── StoredCredential Schema ──────────────────────────────────────────────────

export const StoredCredentialSchema = z.object({
  credentialId: Base64UrlSchema,
  publicKey: Base64UrlSchema,
  signCount: z.number().int().nonnegative('signCount must be non-negative'),
  aaguid: Base64UrlSchema,
  transports: z.array(AuthenticatorTransportSchema).optional(),
});

// ─── Challenge Schemas ────────────────────────────────────────────────────────

export const LockChallengeSchema = z.object({
  id: Base64UrlSchema,
  challenge: Base64UrlSchema,
  expiresAt: UnixMsSchema,
});

export const CompoundChallengeSchema = z.object({
  id: Base64UrlSchema,
  seed: Base64UrlSchema,
  expiresAt: UnixMsSchema,
});

// ─── Serialised WebAuthn Schemas ──────────────────────────────────────────────

export const AttestationJSONSchema = z.object({
  id: Base64UrlSchema,
  rawId: Base64UrlSchema,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: Base64UrlSchema,
    attestationObject: Base64UrlSchema,
    transports: z.array(AuthenticatorTransportSchema).optional(),
  }),
});

export const AssertionJSONSchema = z.object({
  id: Base64UrlSchema,
  rawId: Base64UrlSchema,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: Base64UrlSchema,
    authenticatorData: Base64UrlSchema,
    signature: Base64UrlSchema,
    // userHandle: absent | null | Base64Url
    userHandle: Base64UrlSchema.nullable().optional(),
  }),
});

export const PublicKeyCredentialDescriptorJSONSchema = z.object({
  id: Base64UrlSchema,
  type: z.literal('public-key'),
});

// ─── ReceiverIdentity Schema ──────────────────────────────────────────────────

export const ReceiverIdentitySchema = z.object({
  pubJwk: RSAPublicKeyJWKSchema,
  pubFpr: HexStringSchema,
  lockedAt: UnixMsSchema,
});

// ─── API Request / Response Schemas ──────────────────────────────────────────

export const CreateBeginRequestSchema = z.object({
  uuid: UUIDSchema,
  timestamp: UnixMsSchema,
  securityProfile: SecurityProfileSchema,
});

export const CreateBeginResponseSchema = z.object({
  ok: z.literal(true),
  /** Serialised PublicKeyCredentialCreationOptionsJSON — opaque pass-through. */
  creationOptions: z.record(z.string(), z.unknown()),
});

const CreateFinishWebAuthnSchema = z.object({
  adminMode: z.literal('webauthn'),
  uuid: UUIDSchema,
  attestation: AttestationJSONSchema,
  lockKeyB64u: Base64UrlSchema,
  timestamp: UnixMsSchema,
});

const CreateFinishPasswordSchema = z.object({
  adminMode: z.literal('password'),
  uuid: UUIDSchema,
  softkeyPubJwk: ECDSAPublicKeyJWKSchema,
  lockKeyB64u: Base64UrlSchema,
  timestamp: UnixMsSchema,
});

/** @deprecated Legacy alias for password mode. Retained for existing clients. */
const CreateFinishSoftkeySchema = z.object({
  adminMode: z.literal('softkey'),
  uuid: UUIDSchema,
  softkeyPubJwk: ECDSAPublicKeyJWKSchema,
  lockKeyB64u: Base64UrlSchema,
  timestamp: UnixMsSchema,
});

export const CreateFinishRequestSchema = z.discriminatedUnion('adminMode', [
  CreateFinishWebAuthnSchema,
  CreateFinishPasswordSchema,
  CreateFinishSoftkeySchema,
]);

export const CreateFinishResponseSchema = z.object({
  ok: z.literal(true),
  shareUrl: z.string().min(1),
  manageUrl: z.string().min(1),
});

export const LockBeginRequestSchema = z.object({
  uuid: UUIDSchema,
});

export const LockBeginResponseSchema = z.object({
  ok: z.literal(true),
  lockChallenge: LockChallengeSchema,
});

export const LockCommitRequestSchema = z.object({
  uuid: UUIDSchema,
  lockChallengeId: Base64UrlSchema,
  lockProof: HexStringSchema,
  receiverPubJwk: RSAPublicKeyJWKSchema,
  receiverPubFpr: HexStringSchema,
  lockedAt: UnixMsSchema,
});

export const LockCommitResponseSchema = z.object({
  ok: z.literal(true),
});

export const CompoundBeginRequestSchema = z.object({
  uuid: UUIDSchema,
});

export const CompoundBeginResponseSchema = z.object({
  ok: z.literal(true),
  challenge: CompoundChallengeSchema,
  allowCredentials: z.array(PublicKeyCredentialDescriptorJSONSchema).optional(),
  receiverPubFpr: HexStringSchema.optional(),
  receiverPubJwk: RSAPublicKeyJWKSchema.optional(),
  currentVersion: z.number().int().nonnegative(),
  securityProfile: SecurityProfileSchema,
  adminMode: AdminModeSchema,
});

// ─── Intent Schemas ───────────────────────────────────────────────────────────

export const UpdateIntentSchema = z.object({
  op: z.literal('update'),
  uuid: UUIDSchema,
  version: z.number().int().nonnegative(),
  timestamp: UnixMsSchema,
  nonce: Base64UrlSchema,
  receiverPubFpr: HexStringSchema,
  cipherBundle: CipherBundleSchema,
  // null means "retain the channel's original TTL".
  expireAt: z.union([UnixMsSchema, z.null()]),
});

export const DeleteIntentSchema = z.object({
  op: z.literal('delete'),
  uuid: UUIDSchema,
  version: z.number().int().nonnegative(),
  timestamp: UnixMsSchema,
  nonce: Base64UrlSchema,
});

export const ManageIntentSchema = z.discriminatedUnion('op', [
  UpdateIntentSchema,
  DeleteIntentSchema,
]);

export const CompoundCommitRequestSchema = z.object({
  uuid: UUIDSchema,
  assertion: AssertionJSONSchema,
  intentHash: HexStringSchema,
  intent: ManageIntentSchema,
});

/**
 * Compound commit request using a password/softkey ECDSA signature.
 * Used when channel adminMode is 'password' or 'softkey' (legacy alias).
 *
 * Strict: extra fields (e.g. an assertion) are rejected, making this schema
 * mutually exclusive with CompoundCommitRequestSchema and preventing a
 * type-confusion request that carries both adminMode and assertion.
 */
export const SoftkeyCompoundCommitRequestSchema = z
  .object({
    adminMode: z.enum(['password', 'softkey']),
    uuid: UUIDSchema,
    softkeySignature: HexStringSchema,
    intentHash: HexStringSchema,
    intent: ManageIntentSchema,
  })
  .strict();

export const CompoundCommitResponseSchema = z.object({
  ok: z.literal(true),
});

export const PublicStatusResponseSchema = z.object({
  ok: z.literal(true),
  state: ChannelStateSchema,
  adminMode: AdminModeSchema,
  securityProfile: SecurityProfileSchema,
  receiverPubFpr: HexStringSchema.optional(),
});

export const DecryptFetchResponseSchema = z.object({
  ok: z.literal(true),
  cipherBundle: CipherBundleSchema,
  receiverPubFpr: HexStringSchema,
  deliveredAt: UnixMsSchema,
});

export type DecryptFetchResponse = z.infer<typeof DecryptFetchResponseSchema>;

export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  code: z.string().min(1, 'error code must not be empty'),
});
