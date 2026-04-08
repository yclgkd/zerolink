> **Language**: English | [中文](./PRD.zh.md)

# ZeroLink Product Requirements Document (PRD) v3.0

**Security-First / Low-Friction / DO-Atomic / WebAuthn Admin / TOFU-Safe / Padded Ciphertext**

> **v3.0 Change Summary (relative to v2.5)**: Unified security tiers into two user-facing entry points: **Quick Share** (password mode) and **Secure Share** (Passkey mode).

---

## 1. Product Overview

ZeroLink is a zero-knowledge secret sharing tool: no accounts, and the server never holds plaintext or private keys. Content is end-to-end encrypted, and only the receiver's local private key can decrypt it. The sender holds administrative authority and can update/destroy ciphertext but cannot decrypt the content.

v3.0 product goals:

**Without sacrificing the "minimal-friction user experience," reduce real-world high-probability attack surfaces (preload lock-sniping, passkey synchronization, ciphertext length side-channel, malicious JS delivery) to an acceptable and even auditable level.**

---

## 2. Security Objectives and Threat Model

### 2.1 Security Objectives (Mandatory)

1. **Server Zero-Knowledge**: The server/DO never stores plaintext or any private key
2. **End-to-End Confidentiality**: Plaintext only appears locally on the receiver's device
3. **Unforgeable Update/Destroy**: Only the admin can authorize writes/destruction
4. **Replay/Reorder/Concurrent-Overwrite Resistance**: Monotonic version + nonce deduplication + DO serialization
5. **Minimal Metadata Leakage**: Public endpoints cannot infer state; receiver_pub is not exposed to unauthorized parties
6. **Frontend Integrity Verification**: CSP/Signed Manifest/zero third-party scripts/reproducible builds
7. **Non-Exportable Admin Private Key**: WebAuthn private key resides in the system/hardware
8. **Controllable TOFU Lock-Sniping Risk**: Preload crawlers cannot lock before the real receiver
9. **Significantly Reduced Ciphertext Length Leakage**: Default padding to fixed block boundaries

### 2.2 Explicit Boundaries (Must Be Documented)

- Client compromised by a malicious extension/trojan: may still abuse a single operation within the user confirmation window; cannot silently export the admin private key for long-term control
- The Web scenario cannot fundamentally solve the ultimate trust problem of "malicious server delivering JS": v2.5 provides **self-hosting/verifiable release chain** as optional "ceiling solutions"

---

## 3. Key Changes Overview (Relative to v2.4)

### 3.1 New: Lock Secret (URL Fragment) Anti-Lock-Sniping

- At creation, a lock_secret (32 random bytes) is generated and **placed only in the share link's URL fragment** (e.g., /s/UUID#k=...)
- **The fragment is never sent with HTTP requests**, so preload bots that access /s/UUID cannot obtain the lock_secret and therefore cannot lock
- Locking requires the lock_secret to participate in a challenge-response (Lock Challenge)

### 3.2 New: Padding (Block Alignment) to Reduce Ciphertext Length Leakage

- Plaintext is uniformly padded to multiples of 4KB/8KB (default 4KB) before encryption
- Padding structure includes: original text length + random fill
- cipher_bundle remains AES-GCM ciphertext, but lengths become discrete buckets

### 3.3 Tightened: Receiver KDF Enforces Argon2id

- Default and mandatory: Argon2id (parameter target latency 250-500ms)
- PBKDF2 is not implemented

### 3.4 Two User-Facing Tiers (v3.0 Simplification)

Two tiers available at creation:
- **Quick Share**: Password mode, locally generated ECDSA admin key (Argon2id-wrapped), no passkey required, 4KB padding
- **Secure Share**: Passkey mode, UV=required / RK=discouraged, 8KB padding

### 3.5 New: Self-Hosting / Verifiable Releases

- Official Cloudflare version remains the default
- Docker Compose one-click self-hosting (current package: Caddy + Go API + PostgreSQL + Garage, with protocol-equivalent routes for the shipped frontend contract)
- Release chain: Signed Manifest + reproducible builds

---

## 4. Product Modes and Security Tiers (Externally Clear)

Selectable `securityProfile` at creation (v3.0 two tiers):

### 1. Quick Share

- **Admin Authority**: Locally generated ECDSA P-256 keypair, wrapped by user password via Argon2id and encoded in the admin link's URL fragment (not stored in IndexedDB)
- **WebAuthn**: Not required
- **Receiver**: Argon2id enforced
- **Padding**: 4KB blocks
- **adminMode**: `password` (internal protocol field)
- **Suitable for**: Cross-device/cross-browser usage, environments without passkey support, or users who prefer password managers

### 2. Secure Share

- **Admin Authority**: WebAuthn passkey (device or platform), UV=required, RK=discouraged
- **WebAuthn**: Required, cannot be downgraded
- **Receiver**: Argon2id enforced
- **Padding**: 8KB blocks (higher privacy)
- **adminMode**: `webauthn` (internal protocol field)
- **Suitable for**: Highest security requirements, environments where passkey is available

---

## 5. User Flows (v2.5 UX Edition)

### 5.1 Create (Sender)

1. Choose mode: **Quick Share** (Password) or **Secure Share** (Passkey)
2. **Quick Share flow**: Enter password -> locally generate ECDSA keypair -> Argon2id wrapping -> Create Finish (adminMode=password)
3. **Secure Share flow**: Create Begin -> WebAuthn registration (UV=required, RK=discouraged) -> Create Finish
4. The page displays two links:
   - Share link (receiver): /s/:uuid#k=\<lock_secret_b64url\>[&af=\<sender_auth_fpr\>]
   - Admin link (sender): /m/:uuid#wk=\<wrapped_priv\> (Quick Share) or /m/:uuid (Secure Share)

> **Mandatory UI notice**: The share link must be copied in full (including the part after #), otherwise the receiver cannot lock

### 5.2 Receiver Locking (Receiver: Foolproof)

- After opening the share link, the page shows a minimal animation (3 frames):
    1. "Your passphrase stays only with you"
    2. "Your passphrase creates your personal decryption key — the sender never learns it"
    3. "After locking, only you can open the content"
- Enter password -> generate RSA keypair -> Argon2id-wrap private key and store locally
- Lock request must carry a lock challenge response (see protocol)
- After successful locking, display **Safety Code**:
    - Emoji sequence (8 emoji)
    - Color blocks (4x4 color grid)
    - "Advanced" section expands to show raw hex fingerprint

### 5.3 Sender Delivery (Sender: Soft Verification)

- The admin page shows the same Safety Code (emoji/color blocks), with copy:
    - "Please quickly verify that the safety code matches what the other party sent you (recommended via phone call/another messaging tool)"
- The default UI does not display terms like "fingerprint/hash/public key"; these appear only in advanced mode
- Click deliver: goes through compound_begin/commit, completing the write with a single system confirmation

### 5.4 WebAuthn Unavailable (Degraded UX)

When navigator.credentials is unavailable or the call fails:

- The page automatically detects WebAuthn support status
- **Quick Share**: Always available (does not depend on WebAuthn); auto-selected when WebAuthn is unavailable
- **Secure Share**: Displays "This environment does not support Passkey" warning; button is grayed out and unclickable
- UI shows prompt: "Secure Share requires WebAuthn support. Please switch browsers/devices, or use Quick Share"

---

## 6. Key Security Solutions in v2.5

### 6.1 TOFU Lock-Sniping (Preload Crawler Locks First)

**v2.5 Hard Fix: Lock Secret + Lock Challenge**

- Even if an attacker/crawler accesses /s/:uuid first, it cannot lock because it does not have the lock_secret from the fragment
- During locking, the DO issues a one-time challenge; the receiver must provide lock_proof = SHA256("GL-lock"||uuid||lock_challenge_id||lock_challenge||lock_key)
- The DO verifies lock_proof before accepting receiver_pub

The UX layer still recommends:

- Safety code verification via an out-of-band channel (phone call/another IM), but this is no longer the sole line of defense

### 6.2 Ciphertext Length Leakage

**v2.5 Default Padding**: Plaintext is padded to fixed block multiples before encryption, reducing length inference precision.

### 6.3 Passkey Synchronization Boundaries (v3.0 Simplification)

- **Quick Share**: Does not use WebAuthn; no passkey synchronization issue
- **Secure Share**: Uses WebAuthn (UV=required, RK=discouraged); allows platform passkey synchronization; if the browser provides backupState/backupEligibility, it can be detected and flagged, but not forcibly rejected

### 6.4 Malicious Server JS Delivery

v2.5 provides three layers of response:

1. **Verifiable release chain (Signed Manifest + reproducible builds)**: Increases the probability that "tampering can be detected"
2. **Self-hosting** (current): Docker Compose package provides a protocol-equivalent implementation, completely handing the trust root to the user

---

## 7. Cryptography and Data Formats (v2.5)

### 7.1 Content Encryption (Unchanged + Padding)

- AES-256-GCM encrypts the body (ciphertext bundle remains cipher_bundle)
- RSA-OAEP-256 wraps the AES key (enc_content_key)

#### Padding Scheme (Mandatory, Enabled by Default)

padded_plaintext format definition:

- len: uint32 (original text length, big-endian)
- data: original text bytes
- pad: random bytes, padded to ceil((4 + len)/PAD_BLOCK)*PAD_BLOCK
- Default PAD_BLOCK = 4096 (configurable to 8192)

The final encryption target is padded_plaintext; the receiver truncates to the original text by len after decryption.

> For very large content (e.g., >1MB), padding may be disabled or a larger block (e.g., 64KB) may be used, but the default remains enabled.

### 7.2 Receiver Private Key Wrapping (Argon2id Enforced)

- Argon2id parameters use a target latency strategy (250-500ms)
- Parameters are written to the local header: salt, m, t, p, version
- PBKDF2 is not implemented

### 7.3 Safety Code (Softened Fingerprint Verification)

Computed from receiver_pub_fpr = SHA256(SPKI(receiver_pub)):

- Emoji Safety Code: lower nibble (4 bits) of each hash byte mapped to 16-entry emoji palette (fixed table, stable output)
- Color Blocks: Hash nibbles mapped to a fixed color palette
Display rules:

- Default: Emoji or Color (switchable)
- Advanced: Short fingerprint (first 6/last 6) + full hex (collapsed)

---

## 8. State Machine (Similar to v2.4, with Lock Challenge Added)

States and transitions remain as in v2.4, but locking requires the lock_begin/lock_commit challenge flow (see API).

**State Set**: Waiting, Locked, Delivered, Deleted, Expired

**Allowed Transitions**:
- Waiting -> Locked (lock_commit succeeds)
- Locked -> Delivered (compound_commit update)
- Delivered -> Delivered (compound_commit update)
- Waiting|Locked|Delivered -> Deleted (delete_commit)
- Waiting|Locked|Delivered -> Expired (expire)

**Prohibited Transitions**:
- Repeated lock_commit in non-Waiting state
- Any write operation after Deleted/Expired
- lock_commit without a prior lock_begin (challenge must match and is single-use)

---

## 9. Quick Share (Password Mode) Protocol Definition

Quick Share is the official user entry point in v3.0, replacing "Compatibility Mode" rather than being a fallback option:

- **Admin Authority**: Locally generated ECDSA P-256 private key (Admin-Priv), wrapped via user password Argon2id and encoded in the manage link's URL fragment (not stored in IndexedDB)
- **Update/Delete Authorization**: ECDSA signature payload mode (DO still handles version/nonce atomicity)
- **Protocol Field**: `adminMode: "password"` (internal)
- **Padding**: 4KB blocks (compared to Secure Share's 8KB, lower bandwidth but slightly less privacy)
- **UI**: Not labeled as "lower security"; presented as an independent, valid sharing mode

> Note: Quick Share security depends on user password strength. The UI guides users to choose sufficiently strong passwords through a password strength indicator.

---

## 10. API (v3.0 Current)

General requirements:

- All responses: `Cache-Control: no-store`
- All sensitive write operations go through DO serialization
- Error responses have a constant shape: `{ok: false, code: string}`
- `adminMode` values: `"webauthn"` | `"password"` | `"softkey"` (`softkey` is a legacy alias for `password`, behaves identically)

### 10.1 GET /api/public/:uuid

Response:
```json
{
  "ok": true,
  "state": "waiting|locked|delivered|deleted|expired",
  "adminMode": "webauthn|password|softkey",
  "securityProfile": "quick|secure",
  "receiverPubFpr": "hex..."
}
```

- `receiverPubFpr` is only returned after the receiver has locked
- After a channel is physically deleted or expired, public reads return `404 NOT_FOUND`

### 10.2 Create

#### POST /api/create_begin/:uuid

Request:
```json
{
  "uuid": "string(21)",
  "timestamp": 1730000000000,
  "securityProfile": "quick|secure"
}
```

Response:
```json
{
  "ok": true,
  "creationOptions": { "...": "WebAuthn PublicKeyCredentialCreationOptions" }
}
```

- Creates a `waiting` channel and persists `securityProfile`
- Quick Share frontend does not use the returned `creationOptions`
- `lock_secret` is generated locally by the frontend; the server only persists the derived `lockKeyB64u`

#### POST /api/create_finish/:uuid

WebAuthn mode (`adminMode: "webauthn"`):
```json
{
  "adminMode": "webauthn",
  "uuid": "string(21)",
  "attestation": { "...": "WebAuthn AttestationJSON" },
  "lockKeyB64u": "base64url(SHA256('GL-lockkey'||uuid||lock_secret))",
  "timestamp": 1730000000000
}
```

Quick Share mode (`adminMode: "password"`):
```json
{
  "adminMode": "password",
  "uuid": "string(21)",
  "softkeyPubJwk": { "...": "ECDSA P-256 public key JWK" },
  "lockKeyB64u": "base64url(SHA256('GL-lockkey'||uuid||lock_secret))",
  "timestamp": 1730000000000
}
```

Response:
```json
{
  "ok": true,
  "shareUrl": "https://...",
  "manageUrl": "https://..."
}
```

### 10.3 Locking

#### POST /api/lock_begin/:uuid

Response:
```json
{
  "ok": true,
  "lockChallenge": {
    "id": "base64url",
    "challenge": "base64url(32 bytes)",
    "expiresAt": 1730000000000
  }
}
```

Challenge TTL 60s, single-use.

#### POST /api/lock_commit/:uuid

Request:
```json
{
  "uuid": "string(21)",
  "lockChallengeId": "base64url",
  "lockProof": "hex(SHA256('GL-lock'||uuid||challengeId||challenge||lock_key))",
  "receiverPubJwk": { "...": "RSA-OAEP-256 public key JWK" },
  "receiverPubFpr": "hex(SHA256(SPKI(receiver_pub)))",
  "lockedAt": 1730000000000
}
```

DO verifies the challenge has not expired or been consumed and that lock_proof is correct, then writes receiver_pub, fpr, status=Locked.

### 10.4 Management Operations (Deliver / Update / Delete)

All management operations share a two-phase flow: `compound_begin` to obtain a challenge, then `compound_commit` or `delete_commit` to submit.

#### POST /api/manage/compound_begin/:uuid

Request:
```json
{ "uuid": "string(21)" }
```

Response:
```json
{
  "ok": true,
  "challenge": {
    "id": "base64url",
    "seed": "base64url",
    "expiresAt": 1730000000000
  },
  "allowCredentials": [ "...optional, WebAuthn allow list..." ],
  "receiverPubFpr": "hex...",
  "receiverPubJwk": { "...": "RSA-OAEP-256 public key JWK" },
  "currentVersion": 0,
  "securityProfile": "quick|secure",
  "adminMode": "webauthn|password|softkey"
}
```

#### POST /api/manage/compound_commit/:uuid

WebAuthn mode:
```json
{
  "uuid": "string(21)",
  "assertion": { "...": "WebAuthn AssertionJSON" },
  "intentHash": "hex(SHA256(canonical(intent)))",
  "intent": {
    "op": "update",
    "uuid": "string(21)",
    "version": 1,
    "timestamp": 1730000000000,
    "nonce": "base64url(24 bytes)",
    "receiverPubFpr": "hex...",
    "payloadKind": "text|file",
    "cipherBundle": { "...": "see below" },
    "expireAt": 1730000000000
  }
}
```

Quick Share mode (adds `adminMode` + `softkeySignature`, no `assertion`):
```json
{
  "adminMode": "password|softkey",
  "uuid": "string(21)",
  "softkeySignature": "hex(ECDSA P-256 signature)",
  "intentHash": "hex...",
  "intent": { "...": "same as above" }
}
```

`cipherBundle` structure (inline text payload):
```json
{
  "ciphertext": "base64url",
  "iv": "base64url(12 bytes)",
  "aad": "base64url",
  "encContentKey": "base64url",
  "ciphertextHash": "hex(SHA256(ciphertext))",
  "padBlock": 4096
}
```

New file payloads use `fileRef` (see § 10.6) instead of `cipherBundle`, with `payloadKind: "file"`.

#### POST /api/delete_commit/:uuid

Delete reuses the `compound_begin` challenge, with `intent.op` set to `"delete"`:
```json
{
  "uuid": "string(21)",
  "assertion": { "...": "WebAuthn AssertionJSON" },
  "intentHash": "hex...",
  "intent": {
    "op": "delete",
    "uuid": "string(21)",
    "version": 1,
    "timestamp": 1730000000000,
    "nonce": "base64url(24 bytes)"
  }
}
```

Quick Share mode substitutes `softkeySignature` for `assertion`.

### 10.5 Decrypt Fetch

#### GET /api/decrypt_fetch/:uuid

Called by the receiver after locking and entering their passphrase to retrieve the cipher payload.

Response:
```json
{
  "ok": true,
  "cipherBundle": { "...": "inline payload, same structure as § 10.4" },
  "fileRef": { "...": "replaces cipherBundle for delivered file payloads" },
  "receiverPubFpr": "hex...",
  "cipherVersion": 1,
  "deliveryAuth": { "...": "delivery proof, optional" },
  "deliveredAt": 1730000000000
}
```

`cipherBundle` and `fileRef` are mutually exclusive; exactly one must be present.

### 10.6 File API (Object Storage / Multipart)

#### GET /api/file_policy

Returns the current deployment's file upload policy. Called by the frontend after a file is selected to confirm upload support and size limits.

Response:
```json
{
  "ok": true,
  "policy": {
    "maxFileBytes": 104857600,
    "multipartThresholdBytes": 5242880,
    "chunkSizeBytes": 5242880,
    "maxChunks": 20,
    "multipartSupported": true
  }
}
```

#### POST /api/file/initiate

Request:
```json
{
  "channelUuid": "string(21)",
  "chunkCount": 3,
  "totalCiphertextBytes": 15728640
}
```

Response:
```json
{
  "ok": true,
  "uploadId": "base64url",
  "chunks": [
    { "index": 0, "uploadUrl": "https://r2-presigned-url..." },
    { "index": 1, "uploadUrl": "https://..." },
    { "index": 2, "uploadUrl": "https://..." }
  ]
}
```

The frontend PUTs each encrypted chunk directly to object storage using the provided `uploadUrl`.

#### POST /api/file/complete

Request:
```json
{
  "uploadId": "base64url",
  "baseIv": "base64url(12 bytes)",
  "encContentKey": "base64url",
  "chunkSizeBytes": 5242880,
  "totalPlaintextBytes": 15000000,
  "totalCiphertextBytes": 15728640,
  "chunks": [
    { "index": 0, "etag": "abc123", "ciphertextBytes": 5242896, "ciphertextHash": "hex..." },
    { "index": 1, "etag": "def456", "ciphertextBytes": 5242896, "ciphertextHash": "hex..." },
    { "index": 2, "etag": "ghi789", "ciphertextBytes": 5242848, "ciphertextHash": "hex..." }
  ]
}
```

Response:
```json
{
  "ok": true,
  "fileRef": { "...": "MultipartFileRef, submitted as the intent's fileRef field" }
}
```

#### GET /api/file/fetch/:uuid

Called by the receiver during decryption to obtain pre-signed download URLs for each chunk.

Response:
```json
{
  "ok": true,
  "chunks": [
    { "index": 0, "downloadUrl": "https://r2-presigned-url..." },
    { "index": 1, "downloadUrl": "https://..." }
  ]
}
```

### 10.7 WebSocket

#### GET /api/ws/:uuid (Upgrade: websocket)

Real-time channel state subscription. After connecting, the server pushes state change events (e.g. receiver locked, sender delivered). The frontend uses this to detect channel changes without polling.

---

## 11. WebAuthn Verification (v3.0, Inheriting v2.4 Byte-Level Specification)

- origin, rpIdHash, UV/UP, challenge exact matching, COSE ES256 signature verification
- Secure Share:
    - userVerification="required"
    - residentKey="discouraged"
    - attestation="none"

---

## 12. Frontend Integrity and "Verifiable Release Chain" (Ceiling Solution for Malicious JS Delivery)

### 12.1 Signed Manifest (Recommended)

- At release, generate manifest.json containing:
    - Version number
    - SHA-256 of each static resource
    - Build time, commit hash
- Sign the manifest with the project's **offline signing private key (Ed25519)**, publishing manifest.sig
- The app displays the manifest hash at runtime (advanced users can verify)

> Note: This cannot prevent an attacker from directly tampering with index.html to disable verification, but it makes "download + verification tool" viable.

### 12.2 Self-Hosting (Current)

- Provide Docker Compose:
    - Frontend static files
    - API service (protocol-equivalent implementation: challenge/nonce/version/lockkey/padding/WebAuthn verification)
    - DB (Postgres/MySQL) or SQLite + transaction locks
- The self-hosted version must pass the same protocol test vectors (canonical, challenge, nonce)

---

## 13. UI/UX Specification (Implementing Product Manager Recommendations)

### 13.1 Softened Fingerprint Verification Presentation

- Default: Emoji Safety Code (e.g., 8 emoji)
- Secondary: Color Blocks (e.g., 4x4)
- Advanced: Short fingerprint + full hex (collapsed)

Copy principles:

- Do not use terms like "fingerprint/hash/public key" (except in advanced mode)
- Strongly suggest "out-of-band verification" but without creating anxiety (use gentle prompts)

### 13.2 Receiver Foolproof Animation and Copy

- Animation within 3 frames + 1 strong prompt:
    - "Your passphrase creates your decryption key — the sender never learns it"
- Password strength prompt (but not forcing overly strong passwords to avoid discouraging users; Secure Share is available separately as a higher security option)

### 13.3 Guidance When WebAuthn Is Unavailable

- On failure, provide a clear reason classification (without leaking sensitive information):
    - "Browser not supported"
    - "Current page is insecure (not https / not same-origin)"
    - "System has not enabled biometrics/security key"
- Quick Share: Remains available, with explanation that this is password mode
- Secure Share: Blocked, with suggestion to "switch devices/browsers"

---

## 14. Test Vectors and Acceptance (v3.0)

New tests required:

1. **TOFU Lock-Sniping**: Access without the fragment cannot complete lock_commit (lock_proof verification fails)
2. **lock_challenge Replay**: Reusing the same challenge_id for lock_commit must fail
3. **Padding**: Different plaintext lengths map to the same bucket-length ciphertext (at least 4KB buckets)
4. **Argon2id Enforcement**: Receiver private key wrapping must use Argon2id; Quick Share admin key must also use Argon2id wrapping
5. **Secure Share Policy**: secure must require UV=required and use non-discoverable credentials for registration (`residentKey="discouraged"`)

---

## 15. Protocol Diagram (Mermaid)

```mermaid
sequenceDiagram
  autonumber
  participant S as Sender (Browser)
  participant R as Receiver (Browser)
  participant W as Worker
  participant D as DO(uuid)

  rect rgb(240,240,240)
  Note over S,D: Create (creationOptions + local lock_secret)
  S->>W: POST /api/create_begin/{uuid} (securityProfile)
  W->>D: forward
  D-->>W: creationOptions
  W-->>S: creationOptions
  S->>S: generate local lock_secret
  S->>S: lock_key = sha256("GL-lockkey"||uuid||lock_secret)
  S->>S: build share URL: /s/{uuid}#k=lock_secret[&af=sender_auth_fpr]
  S->>S: navigator.credentials.create(...) or generate local ECDSA admin key
  S->>S: build manage URL: /m/{uuid}#wk=wrapped_priv [Quick Share] or /m/{uuid} [Secure Share]
  S->>W: POST /api/create_finish/{uuid} (attestation or softkeyPubJwk + lockKeyB64u)
  W->>D: forward
  D->>D: store admin credential + lock_key + status=Waiting
  D-->>W: ok
  W-->>S: ok
  end

  rect rgb(240,240,240)
  Note over R,D: Lock begin/commit (TOFU-safe)
  R->>W: POST /api/lock_begin/{uuid}
  W->>D: forward
  D-->>W: lock_challenge_id + lock_challenge
  W-->>R: lock_challenge_id + lock_challenge
  R->>R: read lock_secret from URL fragment
  R->>R: lock_key = sha256("GL-lockkey"||uuid||lock_secret)
  R->>R: lock_proof = sha256("GL-lock"||uuid||cid||chal||lock_key)
  R->>W: POST /api/lock_commit/{uuid} (receiver_pub + fpr + lock_proof)
  W->>D: forward
  D->>D: verify lock_proof using stored lock_key, then store receiver_pub/fpr, status=Locked
  D-->>W: ok
  W-->>R: ok + SafetyCode shown locally
  end

  rect rgb(240,240,240)
  Note over S,D: Deliver (compound one-confirm)
  S->>W: POST /api/manage/compound_begin/{uuid}
  W->>D: forward
  D-->>W: challenge_id/seed + receiver_pub/fpr + last_version (if locked)
  W-->>S: begin
  S->>S: pad plaintext (4KB buckets) + hybrid encrypt + intent_hash
  S->>S: expected_challenge = sha256("GL-delivery-proof"||uuid||intent_hash)
  S->>S: Secure Share: navigator.credentials.get(...) / Quick Share: ECDSA sign with Admin-Priv
  S->>W: POST /api/manage/compound_commit/{uuid} (assertion or softkeySignature + update)
  W->>D: forward
  D->>D: verify intent_hash + delivery_proof challenge + admin signature (WebAuthn or ECDSA) + version/nonce
  D->>D: write cipher_bundle + status=Delivered + last_version++
  D-->>W: ok
  W-->>S: ok
  end

  rect rgb(240,240,240)
  Note over S,D: Delete (reuses compound_begin)
  S->>W: POST /api/manage/compound_begin/{uuid}
  W->>D: forward
  D-->>W: challenge_id/seed + last_version
  W-->>S: begin
  S->>S: intent_hash + expected_challenge = sha256("GLv2.5"||uuid||cid||intent_hash||seed)
  S->>S: admin sign (WebAuthn get or ECDSA sign)
  S->>W: POST /api/delete_commit/{uuid}
  W->>D: forward
  D->>D: verify intent_hash + nonce-bound challenge + admin signature
  D->>D: delete record
  D-->>W: ok
  W-->>S: ok
  end

  rect rgb(240,240,240)
  Note over R,D: Decrypt (receiver reads delivered secret)
  R->>W: GET /api/public/{uuid}
  W->>D: forward
  D-->>W: state=delivered
  W-->>R: state=delivered
  R->>W: GET /api/decrypt_fetch/{uuid}
  W->>D: forward
  D-->>W: cipherBundle + receiverPubFpr + cipherVersion + deliveryAuth
  W-->>R: cipher payload
  R->>R: load wrappedPrivateKey from IndexedDB
  R->>R: Argon2id(passphrase) → unwrap receiver_priv
  R->>R: RSA-OAEP unwrap AES content key
  R->>R: AES-GCM decrypt + remove padding → plaintext
  R->>R: verify deliveryAuth proof (if anchored channel)
  end
```

---

## Appendix A: Parameter Table and Constants (Mandatory)

- UUID_LENGTH = 21 (nanoid)
- TIMESTAMP_SKEW_MS = 120000 (+/-120s)
- NONCE_BYTES = 24 (base64url)
- NONCE_TTL_MS = 600000 (10min)
- CHALLENGE_BYTES = 32
- CHALLENGE_TTL_MS = 60000 (60s)
- LOCK_SECRET_BYTES = 32 (base64url, stored in URL fragment)
- LOCK_KEY_BYTES = 32 (server storage, sha256 output)
- PAD_BLOCK_DEFAULT = 4096 (configurable to 8192)
- PAD_BLOCK_MAX = 65536 (upper limit)
- MAX_PLAINTEXT_BYTES = 2MB (inline plaintext ceiling for text payloads and legacy compatibility; new file uploads require object-storage support)
- WebAuthn: default alg = -7 (ES256), UV required (Strict/HardwareOnly)

---

## Appendix B: Canonical (Ghost Canon v1) Specification and Test Vectors (Mandatory)

### B1. Rules

- Object keys sorted recursively by Unicode code point in ascending order
- Arrays preserve order
- Numbers must be integers, decimal, no scientific notation
- Output minified JSON, no whitespace
- UTF-8 bytes

### B2. Test Vectors (update / delete)

#### B2.1 update (without sig)

Input object (conceptual):

```json
{
  "op": "update",
  "uuid": "u",
  "version": 1,
  "timestamp": 1730000000000,
  "nonce": "n",
  "receiver_pub_fpr": "f",
  "cipher_bundle": {
    "ciphertext": "ct",
    "iv": "iv",
    "aad": "aad",
    "enc_content_key": "ek",
    "ciphertext_hash": "h"
  },
  "expire_at": null,
  "pad_block": 4096
}
```

Canonical output must be:

```json
{"cipher_bundle":{"aad":"aad","ciphertext":"ct","ciphertext_hash":"h","enc_content_key":"ek","iv":"iv"},"expire_at":null,"nonce":"n","op":"update","pad_block":4096,"receiver_pub_fpr":"f","timestamp":1730000000000,"uuid":"u","version":1}
```

#### B2.2 delete

Input object (conceptual):

```json
{
  "op": "delete",
  "uuid": "u",
  "version": 2,
  "timestamp": 1730000000000,
  "nonce": "n"
}
```

Canonical output must be:

```json
{"nonce":"n","op":"delete","timestamp":1730000000000,"uuid":"u","version":2}
```

---

## Appendix C: TOFU Lock-Sniping Fix (Lock Secret / Lock Key / Lock Proof) Precise Definition

### C1. Generation and Storage at Create Time (Critical)

- Frontend locally generates lock_secret: 32 random bytes, written to the share link fragment:
    ```
    share_url = /s/<uuid>#k=<b64url(lock_secret)>
    ```
- Frontend computes lock_key:
    ```
    lock_key = SHA256( UTF8("GL-lockkey") || UTF8(uuid) || lock_secret )
    ```
- Frontend sends lock_key_b64u back in create_finish
- Server stores lock_key (base64url or hex; must be consistent; base64url recommended)

> Note: lock_secret must never be logged or stored as plaintext.

### C2. Lock Two-Phase Flow

1. lock_begin: DO issues {lock_challenge_id, lock_challenge} (32 random bytes, TTL 60s, single-use)
2. lock_commit: Client submits receiver_pub + fpr + lock_proof

### C3. lock_proof Computation (Client-Side)

- Client reads lock_secret from the fragment, locally computes lock_key (same as C1)
- Then computes:
    ```
    lock_proof = SHA256( UTF8("GL-lock") || UTF8(uuid) || b64url_decode(lock_challenge_id) || b64url_decode(lock_challenge) || lock_key )
    ```
- lock_commit only submits lock_proof (hex or base64url; lowercase hex recommended)

### C4. DO Verification (Server-Side)

- Retrieves lock_key from DO storage
- Recomputes expected lock_proof using the same concatenation
- Only allows receiver_pub to be written if the values match

### C5. Security Properties

- Preload crawlers do not have the fragment -> cannot obtain lock_secret -> cannot obtain lock_key -> cannot forge lock_proof
- Even if lock_proof is obtained, it can only be used with the single-use lock_challenge; replay fails (challenge consumed)

---

## Appendix D: Lock API Schema (v2.5)

### D1. POST /api/lock_begin/:uuid

Response:

```json
{
  "ok": true,
  "uuid": "string(21)",
  "lock_challenge_id": "base64url(16-32)",
  "lock_challenge": "base64url(32)",
  "expires_at": 1730000000000
}
```

### D2. POST /api/lock_commit/:uuid

Request:

```json
{
  "uuid": "string(21)",
  "lock_challenge_id": "base64url",
  "lock_proof": "hex(lowercase)",
  "receiver_pub_jwk": {
    "kty": "RSA",
    "alg": "RSA-OAEP-256",
    "n": "...",
    "e": "...",
    "ext": true,
    "key_ops": ["encrypt"]
  },
  "receiver_pub_fpr": "hex(lowercase)",
  "locked_at": 1730000000000
}
```

Response:

```json
{
  "ok": true
}
```

Error semantics (coarse-grained):

- 401: Challenge expired/does not exist
- 403: lock_proof mismatch / no longer in Waiting state
- 409: Challenge already consumed (replay)

---

## Appendix E: Padding Specification (Precise Byte Format + Notes)

### E1. padded_plaintext Format (bytes)

- orig_len: uint32 big-endian (4 bytes)
- orig_data: orig_len bytes
- pad_rand: random bytes, length such that total length is a multiple of PAD_BLOCK
- Total length: ceil((4+orig_len)/PAD_BLOCK) * PAD_BLOCK

### E2. Generation Rules (Client-Side)

- PAD_BLOCK defaults to 4096; can be included in the update payload as pad_block (for audit consistency; not recommended for public display)
- pad_rand must be cryptographically secure random numbers
- Text payloads stay on the inline path. New file payloads do not use this size gate for transport selection: they must upload encrypted chunks and commit a `fileRef`, or be rejected when the deployment does not advertise object-storage support

### E3. Decoding Rules (Receiver)

- Decrypt to obtain padded_plaintext
- Read the first 4 bytes to get orig_len
- Extract the subsequent orig_len bytes as the plaintext
- Ignore the remaining pad_rand

### E4. Relationship with AES-GCM

- AES-GCM is still used; padding does not introduce a padding oracle
- AAD continues to bind uuid/version/fpr, preventing substitution and context confusion

---

## Appendix F: Cipher Bundle Structure and Length Leakage Bucket Strategy

CipherBundle (base64url):

- enc_content_key (RSA-OAEP output, fixed length ~256 bytes)
- ciphertext (length ~= padded_plaintext_len + GCM tag)
- iv (12 bytes)
- aad (recommended: base64url AAD bytes)
- ciphertext_hash (SHA-256 hex)

Bucket strategy:

- Default PAD_BLOCK=4096, leakage granularity is 4KB buckets
- Higher security tiers can increase to 8KB/16KB (more private but more bandwidth-intensive)

---

## Appendix G: WebAuthn Policy (v3.0) Specification

### G1. Quick Share (quick)

- Does not use WebAuthn; fully password mode
- adminMode = "password"

### G2. Secure Share (secure)

- userVerification = "required" (mandatory)
- residentKey = "discouraged" (uses non-discoverable credential)
- attestation = "none"
- Suitable for platform passkeys and hardware security keys

---

## Appendix H: WebAuthn Verification Byte-Level Steps (Continuing v2.4, with Supplementary Constraints for Lock/Profile)

Commit (compound/delete) verification order must include:

1. Verify credentialId == stored cred_id
2. clientDataJSON:
    - type=="webauthn.get"
    - origin strict match
    - challenge strict match expected_challenge
3. authenticatorData:
    - rpIdHash == SHA256(rpId)
    - flags: UP=1; UV per policy
4. Signature verification:
    - signedData = authenticatorData || SHA256(clientDataJSON)
    - COSE ES256 -> P-256 public key
5. signCount strategy: Log anomalies without hard-blocking (to avoid false positives from synchronization)

---

## Appendix I: Quick Share (password/softkey) Protocol Specification

Quick Share is the official user entry point in v3.0 (no longer a degraded mode).

### I1. Admin Key Generation

- Frontend generates ECDSA P-256 keypair
- Admin-Priv is Argon2id-wrapped and encoded in the manage link's URL fragment (not stored in IndexedDB; password provided by user)
- Server stores Admin-Pub (JWK) + adminMode="password"
### I2. Write Authorization

- update/delete requests are based on ECDSA sig (Ghost Canon v1 canonical payload)
- DO still handles version/nonce/challenge serial consistency

### I3. UI Labeling

- Displays "Quick Share (Password)" badge (not "Compatibility Mode")
- Does not force a secondary risk confirmation (password strength indicator guides the user)
- When password strength is low, the UI offers suggestions but does not forcibly block

---

## Appendix J: Error Codes, Constant Response Shape, and Anti-Enumeration Strategy

Unified response body:

```json
{
  "ok": false
}
```

Recommended status codes:

- 400: Malformed request
- 401: Timestamp window failure / challenge expired (unified)
- 403: Permission/state not allowed / WebAuthn failure / lock_proof failure (unified)
- 404: uuid does not exist (Deleted/Expired may also return 404 to further reduce leakage)
- 409: Nonce replay / version conflict / challenge already consumed (unified)

Public endpoint /api/public/:uuid:

- Returns current `state`, `adminMode`, `securityProfile`, and optional `receiverPubFpr`
- Returns `404 NOT_FOUND` after physical deletion or expiration

---

## Appendix K: Safety Code Visual Specification (Emoji / Color)

### K1. Input

- receiver_pub_fpr (32 bytes sha256)

### K2. Emoji Scheme (Recommended Default)

- Split fpr bytes into 8 groups; for each group take lower nibble (4 bits) -> mapped to 16-entry emoji palette (fixed table)
- Output 8 emoji, consistent across platforms
- UI displays as: (example)

### K3. Color Blocks

- Take the 32 bytes of fpr -> each nibble mapped to a 16-color fixed palette
- Output 4x4 color blocks (fixed layout), consistent across platforms

### K4. Advanced Display

- Short fingerprint: first 6 bytes + last 6 bytes (hex)
- Full hex displayed collapsed (user must explicitly expand)
