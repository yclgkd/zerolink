import type { ChannelState, ChannelTtlMs, SecurityProfile } from './constants.ts';

// ─── Branded Primitive Types ──────────────────────────────────────────────────

/**
 * NanoID-based channel identifier (21 chars, base64url alphabet).
 * PRD Appendix A: UUID_LENGTH = 21.
 */
export type UUID = string & { readonly _brand: 'UUID' };

/**
 * URL-safe base64 string without padding (RFC 4648 §5).
 * Used for all binary-to-string conversions over the wire and in storage.
 */
export type Base64Url = string & { readonly _brand: 'Base64Url' };

/**
 * Lowercase hexadecimal string.
 * Used for hash outputs (lock_proof, receiver_pub_fpr, ciphertext_hash).
 */
export type HexString = string & { readonly _brand: 'HexString' };

/**
 * Unix timestamp in milliseconds.
 * All timestamp fields use this type to avoid mixing seconds/ms.
 */
export type UnixMs = number & { readonly _brand: 'UnixMs' };

// ─── Channel Protocol Types ───────────────────────────────────────────────────

/**
 * How the sender authenticated when creating the channel.
 *
 *   webauthn  → standard passkey / hardware key flow (default)
 *   softkey   → PBKDF2-derived keypair fallback (Standard profile only)
 */
export type AdminMode = 'webauthn' | 'softkey';

/**
 * Full channel record persisted in Cloudflare KV by the Durable Object.
 * This is the server-side source of truth for a channel's lifecycle.
 * PRD §8 / ARCHITECTURE.md §"Data Model".
 */
export interface ChannelRecord {
  uuid: UUID;
  state: ChannelState;
  createdAt: UnixMs;
  expiresAt: UnixMs;
  ttl: ChannelTtlMs;
  securityProfile: SecurityProfile;
  adminMode: AdminMode;

  /** Sender's WebAuthn credential used to verify compound_commit assertions. */
  adminCredential: StoredCredential;

  /**
   * lock_key = SHA-256("GL-lockkey" || uuid || lock_secret).
   * Stored to verify the receiver's lock_proof at lock_commit time.
   */
  lockKey: Base64Url;

  /** Receiver's RSA-OAEP-256 public key. Set after lock_commit. */
  receiverPubJwk?: RSAPublicKeyJWK;

  /** SHA-256 of the SPKI-encoded receiver public key (hex). Set after lock_commit. */
  receiverPubFpr?: HexString;

  lockedAt?: UnixMs;

  /** Encrypted secret payload. Set after a successful compound_commit update. */
  cipherBundle?: CipherBundle;

  deliveredAt?: UnixMs;

  /**
   * Monotonic version counter; incremented on each compound_commit.
   * Prevents replay of older compound_commit requests.
   */
  version: number;
}

// ─── Cryptographic Types ──────────────────────────────────────────────────────

/**
 * JSON Web Key representation of the receiver's RSA-OAEP-256 public key.
 * Stored server-side in KV after lock_commit; sent to the sender at deliver time.
 * PRD Appendix C / SECURITY.md §"非对称加密".
 */
export interface RSAPublicKeyJWK {
  kty: 'RSA';
  alg: 'RSA-OAEP-256';
  /** RSA modulus (base64url, 2048-bit = 256 bytes encoded). */
  n: Base64Url;
  /** Public exponent (base64url, F4 = 65537). */
  e: Base64Url;
  ext: true;
  key_ops: readonly ['encrypt'];
}

/**
 * Argon2id KDF parameters persisted alongside the wrapped private key.
 * Storing parameters allows future cost upgrades without re-wrapping immediately.
 * PRD Appendix A / SECURITY.md §"Argon2id".
 */
export interface Argon2idParams {
  /** Memory cost in KiB (64 MiB = 65 536). */
  m: number;
  /** Time cost / iteration count (3). */
  t: number;
  /** Parallelism factor (1; browser crypto workers are single-threaded). */
  p: number;
  /** 128-bit random salt (base64url, 16 bytes). */
  salt: Base64Url;
}

/**
 * Receiver's RSA private key wrapped under an Argon2id-derived AES-256-GCM key.
 * Stored in browser IndexedDB; never leaves the receiver's device in cleartext.
 * PRD Appendix B / SECURITY.md §"Key Wrapping".
 */
export interface WrappedPrivateKey {
  /** AES-256-GCM ciphertext of the PKCS8-encoded private key (base64url). */
  encryptedKey: Base64Url;
  /** AES-GCM IV (12 bytes, base64url). */
  iv: Base64Url;
  kdfParams: Argon2idParams;
}

/**
 * Encrypted secret payload produced by the sender.
 * Stored in Cloudflare KV until the receiver fetches and decrypts it.
 *
 * Construction:
 *   content_key  = random 32-byte AES key
 *   enc_content_key = RSA-OAEP-256.encrypt(receiver_pub, content_key)
 *   padded_pt    = uint32_BE(orig_len) || orig_data || random_pad
 *   ciphertext   = AES-256-GCM.encrypt(content_key, iv, padded_pt, aad)
 *
 * PRD Appendix E / SECURITY.md §"AES-256-GCM".
 */
export interface CipherBundle {
  /** AES-256-GCM ciphertext including 128-bit GCM tag (base64url). */
  ciphertext: Base64Url;
  /** AES-GCM IV (12 bytes, base64url). Unique per encryption. */
  iv: Base64Url;
  /** Additional Authenticated Data binding UUID to ciphertext (base64url). */
  aad: Base64Url;
  /** RSA-OAEP encrypted 32-byte AES content key (base64url). */
  encContentKey: Base64Url;
  /**
   * SHA-256 of the raw ciphertext bytes (hex).
   * Allows the server to verify integrity before the receiver decrypts.
   */
  ciphertextHash: HexString;
  /** Padding block size used (bytes); required to strip padding at decrypt time. */
  padBlock: number;
}

// ─── Safety Code Types ────────────────────────────────────────────────────────

/**
 * 8-emoji Safety Code derived from the first 8 bytes of
 * SHA-256(SPKI(receiver_pub)).
 * PRD Appendix K2.
 */
export interface SafetyCodeEmoji {
  readonly type: 'emoji';
  /** Exactly 8 emoji characters, one per fingerprint byte. */
  readonly emojis: readonly [string, string, string, string, string, string, string, string];
}

/**
 * 4×4 color-grid Safety Code derived from the low nibbles of the fingerprint.
 * Each of the 16 cells maps a 4-bit nibble to one of 16 fixed palette colors.
 * PRD Appendix K3.
 */
export interface SafetyCodeColor {
  readonly type: 'color';
  /** 16 nibble values (0–15), stored in row-major order. */
  readonly cells: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

/** Union of all Safety Code display variants. */
export type SafetyCode = SafetyCodeEmoji | SafetyCodeColor;

/**
 * Complete Safety Code display bundle surfaced in the UI.
 * Bundles all representations derived from the same fingerprint.
 * PRD Appendix K / §7.3.
 */
export interface SafetyCodeDisplay {
  readonly emoji: SafetyCodeEmoji;
  readonly color: SafetyCodeColor;
  /** Advanced mode: "{hex6}...{hex6}" — first and last 6 bytes of the fingerprint. */
  readonly shortFpr: string;
  /** Full 64-character lowercase hex fingerprint. */
  readonly fullFpr: HexString;
}

// ─── WebAuthn Credential Storage ─────────────────────────────────────────────

/**
 * WebAuthn credential record persisted by the Durable Object.
 * All binary fields are base64url-encoded to survive JSON serialisation.
 * PRD §6 / SECURITY.md §"WebAuthn".
 */
export interface StoredCredential {
  credentialId: Base64Url;
  /** SPKI-encoded P-256 public key (base64url). */
  publicKey: Base64Url;
  /** Authenticator signature counter; used to detect cloned authenticators. */
  signCount: number;
  /** Authenticator AAGUID (base64url, 16 bytes). */
  aaguid: Base64Url;
  transports?: AuthenticatorTransport[];
}

// ─── Challenge & Nonce Types ──────────────────────────────────────────────────

/**
 * Lock challenge issued by the Durable Object in response to lock_begin.
 * The receiver must compute:
 *   lock_proof = SHA-256("GL-lock" || uuid || challenge_id || challenge || lock_key)
 * and submit it within CHALLENGE_TTL_MS (60 s).
 * PRD Appendix D.
 */
export interface LockChallenge {
  /** Random challenge ID (base64url, 16 bytes). */
  id: Base64Url;
  /** 256-bit one-time random challenge (base64url, 32 bytes). */
  challenge: Base64Url;
  expiresAt: UnixMs;
}

/**
 * Challenge issued by the Durable Object for compound_begin and delete_begin.
 * The WebAuthn assertion's clientDataJSON.challenge must equal:
 *   SHA-256("GLv2.5" || uuid || challenge_id || intent_hash || seed)
 * PRD Appendix D.
 */
export interface CompoundChallenge {
  /** Random challenge ID (base64url). */
  id: Base64Url;
  /**
   * 256-bit random seed (base64url, 32 bytes).
   * Participates in the challenge derivation to add entropy even if
   * intent_hash is known before the challenge is issued.
   */
  seed: Base64Url;
  expiresAt: UnixMs;
}

/**
 * Consumed nonce record stored in Durable Object memory.
 * Prevents replay of compound_commit requests within NONCE_TTL_MS (10 min).
 */
export interface NonceRecord {
  nonce: Base64Url;
  usedAt: UnixMs;
  expiresAt: UnixMs;
}

// ─── Serialised WebAuthn Types ────────────────────────────────────────────────
//
// The WebAuthn browser API returns binary fields as ArrayBuffer.
// Over the wire (HTTP JSON) they are transmitted as base64url strings.
// These types represent the JSON-serialisable form used in API requests.

/**
 * JSON-serialisable AuthenticatorAttestationResponse sent to create_finish.
 * PRD §6.1.
 */
export interface AttestationJSON {
  id: Base64Url;
  rawId: Base64Url;
  type: 'public-key';
  response: {
    clientDataJSON: Base64Url;
    attestationObject: Base64Url;
    transports?: AuthenticatorTransport[];
  };
}

/**
 * JSON-serialisable AuthenticatorAssertionResponse sent to compound_commit.
 * PRD §6.2.
 */
export interface AssertionJSON {
  id: Base64Url;
  rawId: Base64Url;
  type: 'public-key';
  response: {
    clientDataJSON: Base64Url;
    authenticatorData: Base64Url;
    signature: Base64Url;
    userHandle?: Base64Url | null;
  };
}

// ─── API Request / Response Types ────────────────────────────────────────────
//
// Pure TypeScript shapes for all HTTP endpoints.
// Zod schemas that validate and coerce them live in schemas.ts (ZL-003).

export interface CreateBeginRequest {
  uuid: UUID;
  timestamp: UnixMs;
  securityProfile: SecurityProfile;
}

export interface CreateBeginResponse {
  ok: true;
  /** Serialised PublicKeyCredentialCreationOptionsJSON. */
  creationOptions: Record<string, unknown>;
}

export interface CreateFinishRequest {
  uuid: UUID;
  attestation: AttestationJSON;
  /** base64url of lock_key = SHA-256("GL-lockkey" || uuid || lock_secret). */
  lockKeyB64u: Base64Url;
  timestamp: UnixMs;
}

export interface CreateFinishResponse {
  ok: true;
  /** /s/:uuid#k=<lock_secret_b64url> */
  shareUrl: string;
  /** /m/:uuid */
  manageUrl: string;
}

export interface LockBeginRequest {
  uuid: UUID;
}

export interface LockBeginResponse {
  ok: true;
  lockChallenge: LockChallenge;
}

export interface LockCommitRequest {
  uuid: UUID;
  lockChallengeId: Base64Url;
  /**
   * hex(SHA-256("GL-lock" || uuid || challenge_id || challenge || lock_key)).
   * Proves receiver possesses lock_secret without revealing it to the server.
   */
  lockProof: HexString;
  receiverPubJwk: RSAPublicKeyJWK;
  /** hex(SHA-256(SPKI(receiver_pub))) */
  receiverPubFpr: HexString;
  lockedAt: UnixMs;
}

export interface LockCommitResponse {
  ok: true;
}

export interface CompoundBeginRequest {
  uuid: UUID;
}

export interface CompoundBeginResponse {
  ok: true;
  challenge: CompoundChallenge;
  /** Present when state is 'locked' or 'delivered'. */
  receiverPubFpr?: HexString;
  /** Present when state is 'locked' or 'delivered'. */
  receiverPubJwk?: RSAPublicKeyJWK;
  currentVersion: number;
}

/** Canonical update payload; SHA-256 of its JSON form becomes intent_hash. */
export interface UpdateIntent {
  op: 'update';
  uuid: UUID;
  version: number;
  timestamp: UnixMs;
  nonce: Base64Url;
  receiverPubFpr: HexString;
  cipherBundle: CipherBundle;
  /** null means "use channel's default TTL". */
  expireAt: UnixMs | null;
}

/** Canonical delete payload; SHA-256 of its JSON form becomes intent_hash. */
export interface DeleteIntent {
  op: 'delete';
  uuid: UUID;
  version: number;
  timestamp: UnixMs;
  nonce: Base64Url;
}

export type ManageIntent = UpdateIntent | DeleteIntent;

export interface CompoundCommitRequest {
  uuid: UUID;
  assertion: AssertionJSON;
  /** hex(SHA-256(canonical_json(intent))). Binds assertion to exact payload. */
  intentHash: HexString;
  intent: ManageIntent;
}

export interface CompoundCommitResponse {
  ok: true;
}

export interface PublicStatusResponse {
  ok: true;
  state: ChannelState;
}

/** Standard error envelope for all 4xx / 5xx API responses. */
export interface ErrorResponse {
  ok: false;
  /** Short machine-readable error code. */
  code: string;
}

export type ApiResponse<T> = T | ErrorResponse;

// ─── Result Type ──────────────────────────────────────────────────────────────

/**
 * Discriminated union result for operations that can fail.
 * Avoids throwing exceptions across module boundaries.
 *
 * @example
 *   function parse(raw: string): Result<number> {
 *     const n = Number(raw);
 *     return Number.isNaN(n)
 *       ? { ok: false, error: 'not a number' }
 *       : { ok: true, data: n };
 *   }
 */
export type Result<T, E = string> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };
