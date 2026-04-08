> **Language**: English | [中文](./ARCHITECTURE.zh.md)

# ZeroLink Architecture Overview

## Core Architecture Principles

### 1. Zero-Knowledge Architecture
- **Server never stores plaintext**: All content is encrypted client-side; the server only stores ciphertext
- **Server never stores private keys**: Receiver private keys are generated client-side and stored locally (wrapped with Argon2id)
- **Dual-path admin authority**: Secure Share uses WebAuthn (private key resides in system/hardware); Quick Share uses a password-wrapped local ECDSA key

### 2. Three-Party Role Model

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│    Sender    │         │    Server    │         │   Receiver   │
│   (Admin)    │         │ (Zero-know.) │         │(Sole decrypt)│
├──────────────┤         ├──────────────┤         ├──────────────┤
│ WebAuthn Key │────────▶│  Ciphertext  │◀────────│   RSA-OAEP   │
│(non-export.) │  Manage │(no plaintext)│ Decrypt │ Private key  │
│              │         │              │         │   (local)    │
│ Can update/  │         │ DO atomicity │         │  (Argon2id)  │
│ delete but   │         │   Prevents   │         │ One-way pwd  │
│ can't decrypt│         │  concurrent  │         │  derivation  │
│              │         │  overwrites  │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
```

### 3. Technology Stack

#### Frontend
- **Runtime**: Browser Web Crypto API
- **Authentication**: WebAuthn (FIDO2)
- **Encryption**:
  - Content: AES-256-GCM (symmetric encryption)
  - Key wrapping: RSA-OAEP-256 (hybrid encryption)
  - KDF: Argon2id (receiver private key wrapping)
- **Storage**: IndexedDB (encrypted private keys)

#### Backend
- **Cloudflare runtime**: Workers + Durable Objects + R2
- **Self-hosted runtime**: Go API + PostgreSQL + S3-compatible storage (Garage or external)
- **State management**: Durable Objects (serialization, atomicity)
- **Persistence**: DO storage / SQLite or PostgreSQL rows for channel metadata, plus object storage for multipart file chunks
- **Realtime**: DO WebSocket fan-out on Cloudflare; process-local WebSocket hub with HTTP polling fallback in self-hosted mode

## Core Protocol Flows

### 1. Create
```
Sender → Choose Quick Share or Secure Share → Generate lock_secret
     → Quick Share: Generate local ECDSA admin key and wrap with Argon2id
     → Secure Share: Register WebAuthn admin credential
     → Return two links:
       - /s/:uuid#k=<lock_secret>[&af=<sender_auth_fpr>]  (share link; af= appended when sender auth fingerprint exists)
       - /m/:uuid#wk=<wrapped_priv> (manage link; Quick Share — fragment carries Argon2id-wrapped Admin-Priv)
       - /m/:uuid                   (manage link; Secure Share — no fragment needed)
```

### 2. Lock (Receiver Locks)
```
Receiver → Visit share link (obtain lock_secret from fragment)
        → Enter password → Generate RSA keypair
        → Wrap private key with Argon2id(password) and store locally
        → lock_begin to obtain challenge
        → lock_commit to submit receiver_pub + lock_proof
        → Server verifies lock_proof (based on lock_key)
```

**TOFU Preemptive Lock Protection**:
- lock_secret is only in the URL fragment (never sent with HTTP requests)
- Preload crawlers cannot obtain lock_secret → cannot compute lock_proof → cannot lock

### 3. Deliver (Deliver Content)
```
Sender → Fetch receiver_pub (already locked)
      → Client-side hybrid encryption:
        - Random AES-256 key
        - Text payloads: AES-GCM encrypt padded_plaintext into inline cipher_bundle
        - File payloads: derive baseIv/contentKey, AES-GCM encrypt each chunk independently
        - RSA-OAEP wrap AES key
      → File payloads:
        - /api/file/initiate → upload encrypted chunks → /api/file/complete
        - Receive typed fileRef metadata
      → compound_begin to obtain challenge
      → Secure Share: WebAuthn signature confirmation
      → Quick Share: Local ECDSA signature confirmation
      → compound_commit to atomically write inline text cipher_bundle or fileRef
```

### 4. Update/Delete (Management)
```
Sender → Secure Share: WebAuthn signature authorization
      → Quick Share: Local ECDSA signature authorization
      → DO verification: monotonic version + nonce deduplication
      → Atomic update/delete
```

## Security Mechanisms

### 1. TOFU Preemptive Lock Protection (v2.5 Core)

**Problem**: Preload bots may visit the link and lock it before the real receiver

**Solution**:
- `lock_secret` (32 bytes random) is placed only in the URL fragment
- Fragments are never sent with HTTP requests (RFC 3986)
- Server stores `lock_key = SHA256("GL-lockkey" || uuid || lock_secret)`
- Locking requires `lock_proof = SHA256("GL-lock" || uuid || challenge_id || challenge || lock_key)`
- Without lock_secret → cannot compute lock_key → cannot generate valid lock_proof

### 2. Ciphertext Length Leakage Mitigation (Padding)

**Problem**: Ciphertext length may leak information about plaintext length

**Solution**:
```
padded_plaintext = [orig_len(4 bytes)] + [orig_data] + [random_padding]
Total length = ceil((4 + orig_len) / PAD_BLOCK) * PAD_BLOCK
Default PAD_BLOCK = 4096 bytes
```

### 3. Concurrency Safety (Durable Objects)

**Problem**: Multiple concurrent requests may cause state inconsistency

**Solution**:
- All write operations go through DO (serialized)
- Monotonically increasing version
- Nonce deduplication (TTL 10min)
- Single-use challenge consumption

### 4. Intent Binding

**Problem**: WebAuthn signatures could be tricked into signing unintended operations

**Solution**: Two domain-separated challenge derivations depending on the operation:
```
intent_hash = SHA256(canonical_payload)  // payload contains full operation details

// Deliver/Update — deterministic, no server nonce; replay protection via single-use challenge consumption
expected_challenge = SHA256("GL-delivery-proof" || uuid || intent_hash)

// Delete — includes server nonce (challenge_id + seed) for freshness
expected_challenge = SHA256("GLv2.5" || uuid || challenge_id || intent_hash || seed)

WebAuthn/ECDSA challenge must === expected_challenge
```

## Product Modes (Current Profiles)

### Quick Share (Password)
- Locally generated ECDSA P-256 admin key
- Admin-Priv is wrapped with Argon2id and encoded in the manage link's URL fragment (not stored in IndexedDB)
- Anyone with the manage link and channel password can manage the channel from any device
- Default 4KB padding

### Secure Share (Passkey)
- Uses WebAuthn passkey for admin authority
- userVerification = "required"
- residentKey = "discouraged"
- Default 8KB padding

## Data Flow Diagrams

```
┌─────────────────────────────────────────────────────────────┐
│                    Sender Perspective                       │
├─────────────────────────────────────────────────────────────┤
│  1. Choose Quick Share or Secure Share                      │
│     - Quick: Local ECDSA admin key + Argon2id wrapping      │
│     - Secure: WebAuthn admin key (system/hardware,          │
│       non-exportable)                                       │
│  2. Obtain lock_secret (only for share link fragment)       │
│  3. Wait for Receiver to lock                               │
│  4. After obtaining receiver_pub:                           │
│     - Hybrid encrypt content (AES-GCM + RSA-OAEP)           │
│     - Text payloads stay inline; file payloads upload       │
│       encrypted chunks first and then commit a fileRef      │
│     - Pad to 4KB / 8KB blocks                               │
│     - Quick: Local ECDSA signature / Secure: WebAuthn       │
│       signature                                             │
│     - Deliver ciphertext to Server                          │
│  5. Can update/delete at any time (authorized per chosen    │
│     mode)                                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Receiver Perspective                      │
├─────────────────────────────────────────────────────────────┤
│  1. Obtain lock_secret from share link fragment             │
│  2. Enter password → Generate RSA keypair                   │
│  3. Wrap private key with Argon2id(password) and store      │
│     locally                                                 │
│  4. Compute lock_proof to lock                              │
│  5. Display Safety Code (Emoji/Color) for verification      │
│  6. After Sender delivers:                                  │
│     - Enter password → Unwrap private key                   │
│     - RSA-OAEP unwrap AES key                               │
│     - AES-GCM decrypt and remove padding                    │
│     - Display plaintext                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Server Perspective                       │
├─────────────────────────────────────────────────────────────┤
│  - Stores:                                                  │
│    * admin_webauthn or admin_pub (sender admin credential)  │
│    * lock_key (used to verify lock_proof; cannot reverse    │
│      to lock_secret)                                        │
│    * receiver_pub (receiver public key; exists only after   │
│      locking)                                               │
│    * cipher_bundle (inline text payloads) or fileRef        │
│      metadata (file deliveries)                             │
│    * encrypted multipart chunks in R2 / S3-compatible storage               │
│    * version, nonce, challenge (anti-replay/concurrency)    │
│  - Can:                                                     │
│    * Verify WebAuthn signatures                             │
│    * Verify lock_proof                                      │
│    * Atomic updates (DO)                                    │
│    * Time window checks (±120s)                             │
│  - Cannot:                                                  │
│    * Decrypt content (no receiver_priv)                     │
│    * Forge sender operations (no admin_priv)                │
│    * Know lock_secret (only stores lock_key)                │
└─────────────────────────────────────────────────────────────┘
```

## State Machine

```
┌─────────┐  lock_commit   ┌────────┐  compound_commit  ┌───────────┐
│ Waiting ├───────────────▶│ Locked ├──────────────────▶│ Delivered │
└────┬────┘                └────┬───┘                   └─────┬─────┘
     │                          │                             │
     │        delete_commit     │      delete_commit          │
     └──────────┬───────────────┴──────────────┬──────────────┘
                │                              │
                ▼                              ▼
          ┌─────────┐                    ┌─────────┐
          │ Deleted │                    │ Expired │
          └─────────┘                    └─────────┘
```

**State Transition Rules**:
- Waiting → Locked: lock_commit (requires lock_proof)
- Locked → Delivered: compound_commit (first delivery)
- Delivered → Delivered: compound_commit (update)
- Any → Deleted: delete_commit (admin authorization: WebAuthn or ECDSA)
- Any → Expired: TTL expiration

**Immutability**:
- Cannot recover after Deleted/Expired
- Version can only increment
- Nonce cannot be reused

## Key Constants

```typescript
// Identifiers
UUID_LENGTH = 21  // nanoid

// Time Windows
TIMESTAMP_SKEW_MS = 120000  // ±2min
CHALLENGE_TTL_MS = 60000    // 60s
NONCE_TTL_MS = 600000       // 10min

// Cryptography
LOCK_SECRET_BYTES = 32      // lock_secret length
LOCK_KEY_BYTES = 32         // lock_key length (SHA256 output)
CHALLENGE_BYTES = 32        // challenge length
NONCE_BYTES = 24            // nonce length

// Padding
PAD_BLOCK_DEFAULT = 4096    // Default 4KB block
PAD_BLOCK_MAX = 65536       // Maximum 64KB block
MAX_PLAINTEXT_BYTES = 2MB   // Inline plaintext ceiling for text payloads / legacy compatibility

// WebAuthn
WEBAUTHN_ALG = -7           // ES256 (ECDSA P-256)
```

## Verifiable Release Chain (Current Approach)

### Signed Manifest
- Each release generates manifest.json (file hashes + version + commit)
- Ed25519 offline signing → manifest.sig
- Users can verify frontend integrity

### Self-Hosting (Current)
- Docker Compose package with Caddy + Go API + PostgreSQL + Garage (optional S3-compatible storage)
- Protocol-equivalent implementation for the current frontend contract, including `/api/file_policy` and multipart `fileRef` delivery
- Full autonomous control over keys, storage, and runtime

## References

- Full PRD: [PRD.md](./PRD.md)
- Security model: [SECURITY.md](./SECURITY.md)
- API specification: See PRD Section 10
- Protocol diagrams: See PRD Section 15
