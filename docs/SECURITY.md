> **Language**: English | [中文](./SECURITY.zh.md)

# ZeroLink Security Model

## Threat Model

### Assumptions (Trust Boundaries)

#### We Trust:
- ✅ The user's device and browser (under user control)
- ✅ Web Crypto API and WebAuthn API implementations
- ✅ System/hardware keystores (TPM, Secure Enclave, hardware keys)
- ✅ Security of cryptographic primitives (AES-GCM, RSA-OAEP, SHA-256, Argon2id)

#### We Do Not Trust:
- ❌ The server (zero-knowledge design)
- ❌ Network transport (assumed to be eavesdropped)
- ❌ Preload crawlers/bots
- ❌ Cloud passkey sync (optionally trusted; see security profiles)

#### Boundaries:
- ⚠️ Malicious browser extensions/trojans: may abuse a single operation, but cannot export admin private keys
- ⚠️ Malicious JS served by the server: inherent risk of web architecture; mitigated by self-hosting

---

## Security Goals and Guarantees

### 1. Server Zero-Knowledge ✅

**Goal**: The server/DO stores no plaintext and no private keys

**Guarantees**:
- Plaintext is encrypted on the client before being sent
- Receiver private key is generated on the client, wrapped with Argon2id, and stored locally only
- Sender admin private key is managed by WebAuthn (Secure Share: resides in system/hardware keystore) or generated locally as ECDSA and encoded in the manage link fragment (Quick Share)
- lock_secret exists only in the URL fragment; the server stores only lock_key (one-way derivation)

**Verification**:
- Audit server code: there should be no plaintext/private key storage
- Inspect DO storage: only ciphertext, public keys, hashes, and metadata

---

### 2. End-to-End Confidentiality ✅

**Goal**: Plaintext appears only on the receiver's local device

**Guarantees**:
- Hybrid encryption: AES-256-GCM (content) + RSA-OAEP-256 (key encapsulation)
- Only the receiver holds receiver_priv (password-derived, stored locally)
- The sender also cannot decrypt (only has receiver_pub)

**Attack Surface**:
- Weak receiver password: Argon2id (250-500ms) raises brute-force cost
- Receiver device stolen: password protection + optional auto-expiration
- Man-in-the-middle attack: HTTPS + out-of-band Safety Code verification

---

### 3. Update/Destroy Non-Forgeability ✅

**Goal**: Only the admin can authorize writes/destroys

**Guarantees**:
- Admin authority is based on WebAuthn (Secure Share: private key is non-exportable) or ECDSA signature (Quick Share: Argon2id-wrapped key in manage link fragment)
- Each operation requires a WebAuthn signature (Secure Share) or ECDSA signature (Quick Share)
- Intent Binding: challenge binds to operation details, preventing induced signatures

**Verification** — two domain-separated challenge derivations:
```
intent_hash = SHA256(canonical_payload)  // includes full operation

// Deliver/Update — deterministic; server-side challenge consumption prevents replay
expected_challenge = SHA256("GL-delivery-proof" || uuid || intent_hash)

// Delete — server nonce (challenge_id + seed) ensures freshness
expected_challenge = SHA256("GLv2.5" || uuid || challenge_id || intent_hash || seed)
```

The WebAuthn/ECDSA assertion's challenge must === expected_challenge

---

### 4. Anti-Replay/Reorder/Concurrent Overwrite ✅

**Goal**: All write operations are atomic, ordered, and deduplicated

**Guarantees**:
- **Durable Objects**: serialize all write operations
- **version**: monotonically increasing; rejects old versions
- **nonce**: random 24 bytes; DO stores used nonces (TTL 10min); rejects duplicates
- **timestamp**: window check (±120s); prevents time manipulation

**Attack Surface**:
- Replay attacks: nonce deduplication
- Concurrent overwrites: DO serialization + monotonic version
- Out-of-order delivery: version check

---

### 5. Minimal Metadata Leakage ✅

**Goal**: Public endpoints expose only the minimum metadata required for the frontend to operate, without exposing ciphertext, admin credentials, or plaintext key material

**Guarantees**:
- `/api/public/:uuid`: returns a minimal public state snapshot needed for frontend synchronization (`state`, `adminMode`, `securityProfile`, plus an optional `receiverPubFpr` that appears only after locking), but does not return ciphertext, admin credentials, `lock_secret`, or the receiver public key itself
- receiver_pub is only returned to the sender after successful authentication
- Error responses have a constant shape: `{ok: false}`, leaking no details
- Deleted/Expired can uniformly return 404

**Information Leakage Risks**:
- Ciphertext length: Padding reduces precision (4KB blocks)
- Timing attacks: constant response format + Cache-Control: no-store

---

### 6. Frontend Integrity Verifiable ✅

**Goal**: Frontend code has not been tampered with

**Guarantees**:
- CSP restricts third-party scripts and cross-origin resources; runtime scripts remain same-origin, styles currently allow `unsafe-inline`
- Signed Manifest + same-origin runtime resource hash verification, applicable only to signed release builds with `VITE_RELEASE_VERIFICATION_REQUIRED=true` enabled and signed artifacts published alongside
- Zero third-party scripts/fonts
- Regular `pnpm build` / unsigned manual deployments still work, but constitute unverified startup
- Reproducible builds + Signed Manifest (implemented in the official signed release path)

**Boundaries**:
- Malicious JS served by the server: inherent risk of web architecture
- Mitigation: self-hosting + Signed Manifest (for the signed release path)

---

### 7. Admin Private Key Non-Exportable ✅ (Secure Share)

**Goal**: Attackers cannot permanently steal admin authority (Secure Share: non-exportable; Quick Share: password-protected)

**Guarantees**:
- Secure Share: WebAuthn private key resides in system keystore/hardware
- Even with malicious extensions/trojans, only a single operation can be abused (requires user confirmation)
- Cannot silently export Secure Share admin private key for offline attacks

**Quick Share Boundaries**:
- Quick Share generates an ECDSA private key locally, wraps it with Argon2id, and encodes it in the admin link's URL fragment (not stored in IndexedDB)
- It is a full product mode, not a fallback degradation
- Anyone with the admin link and channel password can manage the channel from any device; it does not provide WebAuthn's non-exportable guarantee

---

### 8. TOFU Preemptive Lock Risk Controlled ✅ (v2.5 Core)

**Problem**: Preload crawlers/attackers may access the link and lock before the real receiver

**v2.5 Solution**:

#### Lock Secret (URL Fragment)
- lock_secret (32 bytes random) is **placed only in the URL fragment**
- Fragments are not sent with HTTP requests (RFC 3986, Section 3.5)
- Preload bots accessing `/s/:uuid` cannot obtain lock_secret

#### Lock Key (Server Storage)
```
lock_key = SHA256("GL-lockkey" || uuid || lock_secret)
```
- The server stores only lock_key (cannot be reversed to lock_secret)
- Used to verify lock_proof, but cannot recover lock_secret

#### Lock Challenge (Anti-Replay)
```
lock_begin → {lock_challenge_id, lock_challenge}  (one-time, TTL 60s)
lock_proof = SHA256("GL-lock" || uuid || challenge_id || challenge || lock_key)
lock_commit → submit lock_proof
```

#### Security Properties
- Without lock_secret → cannot compute lock_key → cannot generate a valid lock_proof
- Even if lock_proof is stolen, it can only be used with a one-time challenge (replay fails)

#### UX Layer Supplement
- Safety Code out-of-band verification (phone call / another IM)
- But this is no longer the sole defense (the protocol layer has a hard fix)

---

### 9. Ciphertext Length Leakage Significantly Reduced ✅ (v2.5)

**Problem**: Ciphertext length may leak plaintext length information (e.g., inferring "password" vs. "long text")

**v2.5 Solution**:

#### Padding Scheme
```
padded_plaintext = [orig_len(4 bytes, big-endian)] + [orig_data] + [random_padding]
total_length = ceil((4 + orig_len) / PAD_BLOCK) * PAD_BLOCK
default PAD_BLOCK = 4096 bytes
```

#### Security Properties
- Different plaintext lengths map to discrete buckets (4KB multiples)
- Leakage granularity reduced to 4KB (or 8KB/16KB)
- Padding uses cryptographically secure random numbers
- Does not introduce a padding oracle (AES-GCM includes authentication)

#### Policy
- Quick Share: 4KB blocks (default)
- Secure Share: 8KB blocks (higher privacy)
- Very large files (>1MB): can be disabled or use larger blocks

---

## Current Product Profiles

### Quick Share (Password)
- **Use case**: Environments without WebAuthn support, cross-device/cross-browser scenarios, users who prefer password managers
- **Admin authority**: Local ECDSA P-256 admin key, wrapped with Argon2id and encoded in the manage link's URL fragment (not stored in IndexedDB)
- **Padding**: 4KB
- **Risk boundary**: Does not have WebAuthn's non-exportable property; password strength and endpoint security are more critical

### Secure Share (Passkey)
- **Use case**: Higher-security scenarios using system/hardware passkeys
- **Admin authority**: WebAuthn, `userVerification = "required"`, `residentKey = "discouraged"`
- **Padding**: 8KB
- **Risk boundary**: Still affected by the web-scenario malicious JS boundary, but admin private key is non-exportable

---

## Attack Scenario Analysis

### 1. Network Eavesdropping (Passive Attack)

**Threat**: Attacker monitors network traffic

**Defenses**:
- ✅ HTTPS encrypted transport
- ✅ Server stores only ciphertext; eavesdropping cannot obtain plaintext
- ✅ lock_secret in fragment (not transmitted)
- ⚠️ Ciphertext length leakage: Padding reduces precision

**Residual Risks**:
- Metadata (UUID, timestamps, IP)
- Ciphertext length buckets (4KB granularity)

---

### 2. Malicious Server (Active Attack)

**Threat**: Server operator attempts to steal content

**Defenses**:
- ✅ Zero-knowledge design: server has no plaintext/private keys
- ✅ End-to-end encryption: only receiver can decrypt
- ❌ Cannot prevent: serving malicious JS, denial of service

**Mitigations**:
- 🔒 Self-hosting (full server control)
- 🔒 Signed Manifest (detect tampering)

**Boundaries**:
- Web architecture cannot fully solve "malicious JS delivery"
- Self-hosting is the highest guarantee

---

### 3. TOFU Preemptive Lock

**Threat**: Preload crawlers/attackers lock before the real receiver

**v2.5 Defenses**:
- ✅ lock_secret in URL fragment (crawlers cannot obtain it)
- ✅ lock_proof based on lock_key (server can verify but cannot forge)
- ✅ lock_challenge is one-time (anti-replay)

**Attack Flow Failure Points**:
```
Attacker accesses /s/:uuid (no fragment)
  → Calls lock_begin to obtain challenge
  → Cannot compute lock_key (no lock_secret)
  → Cannot generate valid lock_proof
  → lock_commit fails (403 Forbidden)
```

---

### 4. Man-in-the-Middle Attack (MITM)

**Threat**: Attacker hijacks the link and replaces receiver_pub

**Defenses**:
- ✅ Safety Code out-of-band verification (Emoji/Color)
- ✅ lock_secret in fragment (HTTPS does not encrypt fragments, but browsers do not send them)
- ⚠️ Relies on user verifying Safety Code

**Attack Flow**:
```
Attacker hijacks share link
  → Locks with their own receiver_pub
  → Sender sees different Safety Code upon delivery
  → Out-of-band verification fails → operation aborted
```

**User Behavior Dependency**:
- If the user does not verify the Safety Code, the attack succeeds
- UX should prominently prompt (without creating anxiety)

---

### 5. Malicious Browser Extension/Trojan

**Threat**: Malware is installed on the user's device

**Defenses**:
- ✅ WebAuthn private key is non-exportable (can only be abused once)
- ✅ Each operation requires user confirmation (limits automation)
- ❌ Cannot prevent: single operation abuse

**Attack Flow**:
```
Trojan monitors user operations
  → Intercepts during user confirmation window
  → Replaces payload or triggers one malicious operation
  → But cannot export private key for persistent control
```

**Quick Share Risk Boundary**:
- Local ECDSA private key wrapped with Argon2id and encoded in the manage link's URL fragment (not stored in IndexedDB); theoretically more dependent on endpoint security than Secure Share
- UI should guide users to set a sufficiently strong password rather than presenting it as a "fallback mode"

---

### 6. Receiver Password Brute Force

**Threat**: Attacker steals wrapped_receiver_priv and brute-forces offline

**Defenses**:
- ✅ Argon2id KDF (target time 250-500ms)
- ✅ Password strength hints (UX layer)
- ⚠️ Users may still use weak passwords

**Cracking Cost**:
```
Assumptions:
  - Argon2id parameters: m=64MB, t=3, p=1 (~500ms/attempt)
  - Attacker hardware: modern GPU (optimizing Argon2id is difficult, but still better than PBKDF2)

Weak password (6-digit numeric):
  - Space: 10^6 = 1,000,000
  - Cost: ~500,000 seconds ≈ 5.8 days (single-threaded)

Strong password (12-char mixed):
  - Space: 95^12 ≈ 5.4 × 10^23
  - Cost: infeasible
```

**Residual Risk**:
- User chooses an extremely weak password (UX should guide but not force)

---

### 7. Malicious JS Served by Server

**Threat**: The server (or CDN hijack) serves tampered frontend code

**Defenses**:
- ⚠️ Inherent risk of web architecture; cannot be fully solved
- 🔒 CSP + Signed Manifest (raise tampering cost and detect tampering)
- 🔒 Reproducible builds + Signed Manifest (detectable)
- 🔒 Self-hosting (full control)

**Attack Flow**:
```
Attacker controls the server
  → Serves malicious JS (steals passwords/private keys)
  → User runs it without awareness
  → Attack succeeds
```

**Layered Mitigations**:
1. **Default deployment** (Cloudflare): trust the hosting provider
2. **Self-hosting**: full autonomous control
3. **Signed Manifest**: user can verify (requires technical ability)

**Boundaries**:
- Non-technical users have difficulty verifying frontend integrity
- Tools + documentation are provided, but cannot be enforced

---

## Cryptographic Specification

### Symmetric Encryption (Content)
- **Algorithm**: AES-256-GCM
- **Key**: random 256 bits (generated by Web Crypto API)
- **IV**: random 96 bits (unique per encryption)
- **AAD**: `uuid || version || receiver_pub_fpr` (prevents substitution)
- **Tag**: 128 bits (built into GCM)

### Asymmetric Encryption (Key Encapsulation)
- **Algorithm**: RSA-OAEP-256
- **Key length**: 2048 bits (receiver)
- **Hash**: SHA-256
- **Purpose**: encapsulate AES key

> **Design Decision — Why RSA-2048, not ECDH P-256?**
>
> RSA-2048 provides ~112 bits of classical security, while ECDH P-256 provides ~128 bits.
> Both are far beyond current brute-force capability, and both are equally broken by
> Shor's algorithm on a sufficiently large quantum computer. Migrating to P-256 would
> require ~50 file changes (crypto primitives, protocol format, schemas, backend storage,
> and all tests), a breaking change to the cipher bundle wire format (`encContentKey` →
> `ephemeralPublicKey`), and a backward-compatibility strategy for existing channels —
> all for a marginal classical security gain that does not address the real quantum threat.
>
> The actual weakest link in the current system is the receiver passphrase (mitigated by
> Argon2id + 12-character minimum + 7-day max TTL), not the RSA modulus size.
>
> **Planned migration path**: wait for WebCrypto to natively support ML-KEM (FIPS 203),
> then migrate directly to a hybrid KEM (ECDH P-256 + ML-KEM) in a single protocol
> version bump — avoiding an intermediate P-256-only migration that would become obsolete.
> NIST recommends phasing out RSA-2048 after 2030; this timeline aligns with expected
> browser support for post-quantum primitives.

### KDF (Key Derivation)
- **Algorithm**: Argon2id (default)
- **Parameters**: target time 250-500ms
  - Recommended: m=64MB, t=3, p=1
- **Salt**: random 128 bits
- **Output**: 256 bits (used to wrap private key with AES-256)

### Digital Signatures (Admin Authority)
- **WebAuthn**: ES256 (ECDSA P-256 + SHA-256)
- **Quick Share**: ECDSA P-256
- **Update Delivery Proof**: `SHA256("GL-delivery-proof" || uuid || intent_hash)` as a deterministic challenge; anchored channels locally re-verify the proof on the receiver side

### Hashing (Integrity/Fingerprints)
- **Algorithm**: SHA-256
- **Uses**:
  - receiver_pub_fpr: SHA256(SPKI(receiver_pub))
  - sender_auth_fpr: SHA256(SPKI(sender_admin_verify_key))
  - ciphertext_hash: SHA256(ciphertext)
  - lock_key: SHA256("GL-lockkey" || uuid || lock_secret)
  - lock_proof: SHA256("GL-lock" || ...)
  - intent_hash: SHA256(canonical_payload)
  - delivery_proof_challenge: SHA256("GL-delivery-proof" || uuid || intent_hash)

---

## Protocol Constants

```typescript
// Domain Separation
const DOMAIN_PREFIX = {
  LOCK_KEY: "GL-lockkey",
  LOCK_PROOF: "GL-lock",
  DELIVERY_PROOF: "GL-delivery-proof",
  CHALLENGE: "GLv2.5",  // v2.5-specific prefix
};

// Time Windows
const TIMESTAMP_SKEW_MS = 120000;    // ±2min
const CHALLENGE_TTL_MS = 60000;      // 60s
const NONCE_TTL_MS = 600000;         // 10min

// Random Value Lengths
const LOCK_SECRET_BYTES = 32;        // lock_secret
const LOCK_KEY_BYTES = 32;           // lock_key (SHA256 output)
const CHALLENGE_BYTES = 32;          // challenge
const NONCE_BYTES = 24;              // nonce

// Padding
const PAD_BLOCK_DEFAULT = 4096;      // 4KB
const PAD_BLOCK_MAX = 65536;         // 64KB
const MAX_PLAINTEXT_BYTES = 2097152; // 2MB inline plaintext ceiling before multipart

// WebAuthn
const WEBAUTHN_ALG = -7;             // ES256
const WEBAUTHN_TIMEOUT_MS = 60000;   // 60s
```

---

## Security Invariants (Implementation)

### Server-Side
- All responses include `Cache-Control: no-store`
- lock_secret never enters logs/storage
- lock_key is one-way derived (irreversible)
- challenge is consumed once (TTL + marking)
- nonce deduplication (TTL 10min)
- version is monotonically increasing
- timestamp window check (±120s)
- WebAuthn byte-level verification (origin/challenge/signature)
- intent_hash strict matching
- Error responses have constant shape `{ok: false}`
- DO serializes all write operations

### Client-Side
- lock_secret only in fragment (not sent to server)
- New share link fragment additionally carries `af=sender_auth_fpr`
- lock_key computed locally then sent back (create_finish)
- lock_proof includes challenge (anti-replay)
- Receiver private key wrapped with Argon2id
- Padding randomness is secure (crypto.getRandomValues)
- AAD binds uuid/version/fpr
- Multipart file chunks derive per-chunk IV/AAD (`baseIv XOR index`, `uuid || "chunk" || index`) to prevent storage-side reordering
- Anchored channel locally pins `sender_auth_fpr`
- Anchored channel locally re-verifies `deliveryAuth` proof
- Locally persists `lastAcceptedDelivery(version,ciphertextHash)` to prevent rollback
- Safety Code deterministically generated from receiver_pub_fpr
- WebAuthn challenge binds to intent_hash
- Sensitive data zeroed out (burned after use)
- Strict CSP policy
- Signed Manifest and runtime hash verification

### UX
- Share link prompt: "must copy in full (including after #)"
- Safety Code out-of-band verification guidance (without creating anxiety)
- Receiver onboarding animation ("the password stays only with you")
- Difference between Quick Share and Secure Share is accurately described; Quick Share is not labeled as a "compatibility mode"
- WebAuthn failure provides clear fallback guidance
- Password strength hints (without forcing)

---

## Known Limitations

### Limitations
1. **Metadata leakage**: UUID, timestamps, ciphertext length buckets
2. **User behavior dependency**: Safety Code verification is not enforced
3. **Malicious JS delivery**: inherent problem of web architecture (mitigation: self-hosting)
4. **Weak password risk**: cannot force users to use strong passwords
5. **Profile differences**: Quick Share relies more on password and local endpoint security; Secure Share relies more on the WebAuthn ecosystem
6. **Freshness boundary**: anchored A+B can only prevent on-device rollback and forgery of unanchored sender proofs; it alone cannot prove "the server is not withholding updates" — that requires future witness / transparency schemes

---

## Security Audit Recommendations

### Audit Focus Areas
1. **lock_secret does not leak**: check all code paths to ensure it is not uploaded/logged
2. **lock_proof verification logic**: ensure it cannot be forged (requires lock_key)
3. **WebAuthn verification**: byte-level exact matching (origin/challenge/signature)
4. **DO atomicity**: concurrency testing (version/nonce conflicts)
5. **Padding correctness**: length calculation, randomness, unpadding logic
6. **Argon2id parameters**: ensure compliance with OWASP recommendations (2023)

### Test Vectors
See PRD Appendix B (Canonical), Appendix C (Lock), Appendix E (Padding)

### Penetration Testing Scenarios
- TOFU preemption (attempt lock without fragment)
- Challenge replay (submit same challenge_id multiple times)
- Nonce replay (submit same nonce multiple times)
- Version rollback (submit old version)
- Timestamp manipulation (exceed window)
- intent_hash tampering (replace payload)

---

## References

- **WebAuthn Specification**: https://www.w3.org/TR/webauthn-2/
- **Argon2 RFC**: https://datatracker.ietf.org/doc/html/rfc9106
- **OWASP Password Storage**: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- **URL Fragment Semantics**: https://datatracker.ietf.org/doc/html/rfc3986#section-3.5
- **Full PRD**: [PRD.md](./PRD.md)
- **Architecture Overview**: [ARCHITECTURE.md](./ARCHITECTURE.md)
