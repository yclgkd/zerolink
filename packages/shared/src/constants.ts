// ─── Protocol / App ───────────────────────────────────────────────────────────

/**
 * Channel ID length in characters (NanoID).
 * 21 chars with a 64-character alphabet gives ~126 bits of entropy.
 * PRD Appendix A: UUID_LENGTH = 21.
 */
export const UUID_LENGTH = 21 as const;

/**
 * Channel lifecycle states (Durable Object state machine).
 * PRD §8 / ARCHITECTURE.md state machine diagram.
 *
 *   waiting   → receiver has not locked yet
 *   locked    → receiver locked; sender can verify Safety Code and deliver
 *   delivered → sender delivered the secret; receiver can decrypt
 *   deleted   → permanently destroyed by sender
 *   expired   → auto-expired past TTL
 */
export const CHANNEL_STATE = {
  WAITING: 'waiting',
  LOCKED: 'locked',
  DELIVERED: 'delivered',
  DELETED: 'deleted',
  EXPIRED: 'expired',
} as const;

export type ChannelState = (typeof CHANNEL_STATE)[keyof typeof CHANNEL_STATE];

/**
 * Security profiles selectable at channel creation.
 *
 *   quick  → password-protected; no WebAuthn required; Argon2id KDF; 4KB padding
 *   secure → passkey required; UV=required; RK=required; attestation=none; 8KB padding
 *
 * Legacy values (read-side only, for existing channels in storage):
 *   standard      → UV=preferred; RK=preferred (lower assurance than 'secure')
 *   strict        → UV=required; RK=required (equivalent to 'secure')
 *   hardware_only → UV=required; RK=required; attestation enforcement removed
 */
export const SECURITY_PROFILE = {
  QUICK: 'quick',
  SECURE: 'secure',
  // Legacy — retained for backward-compatible reads of existing channel records
  STANDARD: 'standard',
  STRICT: 'strict',
  HARDWARE_ONLY: 'hardware_only',
} as const;

export type SecurityProfile = (typeof SECURITY_PROFILE)[keyof typeof SECURITY_PROFILE];

/**
 * TTL options for channel auto-expiry (values in milliseconds).
 * Covers the common use-cases: short-lived (1h), daily (24h), weekly (7d).
 */
export const CHANNEL_TTL_MS = {
  ONE_HOUR: 3_600_000,
  ONE_DAY: 86_400_000,
  SEVEN_DAYS: 604_800_000,
} as const;

export type ChannelTtlMs = (typeof CHANNEL_TTL_MS)[keyof typeof CHANNEL_TTL_MS];

/**
 * Maximum plaintext size enforced client-side before encryption begins.
 * PRD Appendix A: MAX_PLAINTEXT_BYTES = 2 MB.
 */
export const MAX_PLAINTEXT_BYTES = 2_097_152 as const; // 2 × 1024 × 1024

/**
 * API base path. All backend routes are mounted under /api.
 */
export const API_BASE_PATH = '/api' as const;

/**
 * URL route patterns (React Router v6 path syntax).
 * PRD §5 / ARCHITECTURE.md routes.
 *
 *   SHARE  → /s/:uuid  Receiver "Unlock & Lock" page
 *   MANAGE → /m/:uuid  Sender "Manage & Deliver" page
 */
export const ROUTE_PATTERN = {
  SHARE: '/s/:uuid',
  MANAGE: '/m/:uuid',
} as const;

// ─── Timing Windows ──────────────────────────────────────────────────────────

/**
 * Maximum clock skew tolerated between client and server.
 * PRD Appendix A / SECURITY.md §4: TIMESTAMP_SKEW_MS = ±120 s.
 */
export const TIMESTAMP_SKEW_MS = 120_000 as const; // 120 s

/**
 * Time-to-live for a lock challenge issued by the Durable Object.
 * PRD Appendix A: CHALLENGE_TTL_MS = 60 s.
 * Short enough to prevent offline precomputation; long enough for slow connections.
 */
export const CHALLENGE_TTL_MS = 60_000 as const; // 60 s

/**
 * Time-to-live for a consumed nonce record stored in the DO.
 * PRD Appendix A: NONCE_TTL_MS = 10 min.
 */
export const NONCE_TTL_MS = 600_000 as const; // 600 s

/**
 * WebAuthn user-gesture timeout passed to navigator.credentials.create/get.
 * Explicit value prevents browser variance. SECURITY.md §"Protocol Constants".
 */
export const WEBAUTHN_TIMEOUT_MS = 60_000 as const; // 60 s

// ─── Random Material Lengths (bytes) ─────────────────────────────────────────

/**
 * lock_secret: 32 random bytes placed exclusively in the URL fragment (#k=...).
 * PRD Appendix A + C: LOCK_SECRET_BYTES = 32.
 * Fragments are never sent in HTTP requests (RFC 3986 §3.5) — zero-knowledge guarantee.
 */
export const LOCK_SECRET_BYTES = 32 as const;

/**
 * lock_key = SHA-256(DOMAIN.LOCK_KEY || uuid || lock_secret) — 32 bytes.
 * PRD Appendix A: LOCK_KEY_BYTES = 32.
 * Stored server-side in KV; used to verify the receiver's lock_proof.
 */
export const LOCK_KEY_BYTES = 32 as const;

/**
 * Challenge nonce: 32 random bytes.
 * PRD Appendix A + D: CHALLENGE_BYTES = 32.
 * 256 bits of one-time challenge entropy for replay prevention.
 */
export const CHALLENGE_BYTES = 32 as const;

/**
 * General-purpose nonce: 24 random bytes (192 bits).
 * PRD Appendix A: NONCE_BYTES = 24.
 * Collision probability negligible even at high request volume.
 */
export const NONCE_BYTES = 24 as const;

// ─── Domain Separation Prefixes ──────────────────────────────────────────────

/**
 * Domain-separation labels prefixed to hash inputs.
 * PRD Appendix C / SECURITY.md §"Protocol Constants".
 * Prevents cross-protocol hash collisions.
 *
 *   lock_key   = SHA256(DOMAIN.LOCK_KEY   || uuid || lock_secret)
 *   lock_proof = SHA256(DOMAIN.LOCK_PROOF || uuid || cid || challenge || lock_key)
 *   challenge  = SHA256(DOMAIN.CHALLENGE  || uuid || cid || intent_hash || seed)
 */
export const DOMAIN = {
  LOCK_KEY: 'GL-lockkey',
  LOCK_PROOF: 'GL-lock',
  CHALLENGE: 'GLv2.5',
} as const;

// ─── Argon2id (KDF) ──────────────────────────────────────────────────────────

/**
 * Argon2id parameters for wrapping the receiver's RSA private key.
 *
 * MEMORY_COST_KB = 65536 (64 MiB)
 *   RFC 9106 §4 "second recommended option": m=64 MiB, t=3, p=4.
 *   OWASP Password Storage Cheat Sheet 2023 minimum: 19 MiB.
 *   64 MiB is memory-hard against GPU cracking while fitting within
 *   WebAssembly heap limits in modern browsers. PRD targets 250–500 ms
 *   on typical hardware at these parameters.
 *
 * TIME_COST = 3
 *   Three iterations reach 250–500 ms on mid-range devices. Argon2id's
 *   memory-hard mixing resists GPU parallelism far better than PBKDF2.
 *
 * PARALLELISM = 1
 *   Single-threaded; browser crypto workers are typically single-core.
 *   Higher values require SharedArrayBuffer (cross-origin isolation headers)
 *   and provide minimal benefit for a single-user operation.
 *
 * HASH_LENGTH = 32  →  256-bit AES key material for wrapping the RSA private key.
 * SALT_LENGTH = 16  →  128-bit random salt per RFC 9106 §3.1 minimum.
 */
export const ARGON2ID = {
  MEMORY_COST_KB: 65_536, // 64 MiB
  TIME_COST: 3,
  PARALLELISM: 1,
  HASH_LENGTH: 32, // bytes → 256-bit output
  SALT_LENGTH: 16, // bytes → 128-bit random salt
} as const;

/**
 * PBKDF2-SHA-256 iteration count for compatibility mode (softkey fallback).
 * OWASP Password Storage Cheat Sheet 2023: minimum 600,000 for SHA-256.
 * Only usable under Standard security profile with explicit user acknowledgment.
 */
export const PBKDF2_ITERATIONS = 600_000 as const;

// ─── AES-256-GCM ─────────────────────────────────────────────────────────────

/**
 * AES-256-GCM symmetric encryption parameters.
 *
 * KEY_LENGTH_BITS = 256
 *   NIST SP 800-57 Part 1 Rev. 5: 256-bit security strength.
 *
 * IV_LENGTH = 12 bytes (96 bits)
 *   NIST SP 800-38D §5.2.1.1: recommended length; produces 128-bit counter
 *   block without extra hashing. Each IV must be unique per key.
 *
 * TAG_LENGTH_BITS = 128
 *   NIST SP 800-38D maximum tag length; 2^-128 forgery probability.
 *
 * PAD_BLOCK_DEFAULT = 4096 bytes
 *   PRD Appendix A/E: default 4 KB padding block. Reduces ciphertext-length
 *   side-channel to 4 KB granularity.
 *
 * PAD_BLOCK_STRICT = 8192 bytes
 *   Secure profile uses 8 KB block for higher privacy.
 *
 * PAD_BLOCK_MAX = 65536 bytes
 *   PRD Appendix A: absolute upper bound; prevents abuse via oversized requests.
 *
 * PAD_LENGTH_PREFIX_BYTES = 4
 *   PRD Appendix E: orig_len stored as uint32 big-endian at the start of
 *   padded_plaintext before encryption.
 */
export const AES_GCM = {
  ALGORITHM_NAME: 'AES-GCM',
  KEY_LENGTH_BITS: 256,
  IV_LENGTH: 12, // bytes
  TAG_LENGTH_BITS: 128,
  PAD_BLOCK_DEFAULT: 4_096, // bytes
  PAD_BLOCK_STRICT: 8_192, // bytes
  PAD_BLOCK_MAX: 65_536, // bytes
  PAD_LENGTH_PREFIX_BYTES: 4,
} as const;

// ─── RSA-OAEP (Key Wrapping) ─────────────────────────────────────────────────

/**
 * RSA-OAEP-256 parameters for receiver public-key-based key encapsulation.
 *
 * MODULUS_LENGTH_BITS = 2048
 *   NIST SP 800-57 Part 1 Rev. 5: 112-bit security strength; adequate to 2030+.
 *   SECURITY.md §"非对称加密". Balances in-browser keygen latency (~100–400 ms)
 *   against security margin.
 *
 * PUBLIC_EXPONENT_BYTES = Uint8Array([0x01, 0x00, 0x01]) = 65537
 *   Standard Fermat prime F4; universally supported by WebCrypto.
 *   Required as Uint8Array for RsaHashedKeyGenParams.publicExponent.
 *
 * HASH_ALGORITHM = 'SHA-256'
 *   SECURITY.md: RSA-OAEP-256. Exact WebCrypto API string.
 *
 * KEY_USAGES_PUBLIC / KEY_USAGES_PRIVATE
 *   WebCrypto requires declaring usages at key generation/import time.
 *   Note: downstream callers may need [...RSA_OAEP.KEY_USAGES_PUBLIC] to
 *   satisfy WebCrypto's mutable KeyUsage[] parameter (readonly array widening).
 */
export const RSA_OAEP = {
  ALGORITHM_NAME: 'RSA-OAEP',
  MODULUS_LENGTH_BITS: 2048,
  HASH_ALGORITHM: 'SHA-256',
  PUBLIC_EXPONENT_BYTES: new Uint8Array([0x01, 0x00, 0x01]),
  KEY_USAGES_PUBLIC: ['encrypt'] as const,
  KEY_USAGES_PRIVATE: ['decrypt'] as const,
} as const;

// ─── Safety Code ─────────────────────────────────────────────────────────────

/**
 * Safety Code display parameters derived from receiver_pub_fpr.
 * The Safety Code is the human-verifiable fingerprint of the receiver's public key.
 * PRD Appendix K / PRD §7.3 / Figma README §"Safety Code".
 *
 * EMOJI_COUNT = 8
 *   PRD Appendix K2: 8 bytes of fpr, each mapped to 1 emoji (256-entry table).
 *   64 bits of displayed fingerprint content.
 *
 * COLOR_GRID_SIZE = 4
 *   PRD Appendix K3: 4×4 grid of color blocks (16 cells × 4-bit nibble = 64 bits).
 *
 * COLOR_PALETTE_SIZE = 16
 *   PRD Appendix K3: each nibble maps to 1 of 16 fixed colors.
 *   Palette defined in frontend theme CSS, not here.
 *
 * SHORT_FINGERPRINT_BYTES = 6
 *   PRD Appendix K4: "前 6 bytes + 后 6 bytes (hex)" shown in Advanced mode only.
 *
 * INPUT_BYTES = 32
 *   receiver_pub_fpr = SHA256(SPKI(receiver_pub)) → 32 bytes.
 */
export const SAFETY_CODE = {
  EMOJI_COUNT: 8,
  COLOR_GRID_SIZE: 4, // n×n grid → 4×4 = 16 cells
  COLOR_PALETTE_SIZE: 16,
  SHORT_FINGERPRINT_BYTES: 6,
  INPUT_BYTES: 32, // SHA-256 output
} as const;

// ─── ECDSA P-256 (Softkey Compat Mode) ───────────────────────────────────────

/**
 * ECDSA P-256 (ES256) constants for the softkey compatibility-mode admin credential.
 * PRD §9: when WebAuthn is unavailable on Standard profile, an ECDSA keypair
 * is used in place of a hardware authenticator.
 *
 * ALGORITHM_NAME / CURVE / HASH_ALGORITHM → WebCrypto API strings.
 * KEY_USAGES_SIGN / KEY_USAGES_VERIFY     → declare usages at importKey time.
 */
export const ECDSA = {
  ALGORITHM_NAME: 'ECDSA',
  CURVE: 'P-256',
  HASH_ALGORITHM: 'SHA-256',
  KEY_USAGES_SIGN: ['sign'] as const,
  KEY_USAGES_VERIFY: ['verify'] as const,
} as const;

// ─── WebAuthn ────────────────────────────────────────────────────────────────

/**
 * WebAuthn / FIDO2 constants.
 *
 * COSE_ALG_ES256 = -7
 *   IANA COSE Algorithms registry (RFC 8152): ECDSA with P-256 and SHA-256.
 *   SECURITY.md / PRD §"WebAuthn": "默认 alg = -7 (ES256)".
 *
 * UV_* strings match WebAuthn UserVerificationRequirement exactly.
 *   preferred     → Standard profile (platform passkey allowed)
 *   required      → Strict and Hardware-Only profiles
 *
 * ATTACHMENT_CROSS_PLATFORM → Hardware-Only profile requires external key.
 * ATTESTATION_NONE / DIRECT → Standard vs Hardware-Only attestation policy.
 */
export const WEBAUTHN = {
  COSE_ALG_ES256: -7 as const,
  UV_PREFERRED: 'preferred' as const,
  UV_REQUIRED: 'required' as const,
  ATTACHMENT_CROSS_PLATFORM: 'cross-platform' as const,
  ATTESTATION_NONE: 'none' as const,
  ATTESTATION_DIRECT: 'direct' as const,
} as const;
