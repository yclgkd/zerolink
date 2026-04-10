# Self-Hosted Backend Contract Freeze

This document freezes the protocol-facing contract that the self-hosted backend reproduces today.

## Scope

- Enumerate the current HTTP and WebSocket contract that the frontend depends on
- Freeze the exact-match surfaces that must stay byte-for-byte compatible
- Document the externally visible error semantics
- Call out open ambiguities that must be resolved explicitly instead of drifting implicitly
- Include the file-policy and multipart file-delivery overlay the frontend now depends on

## Exact-Match Surfaces

These helpers are implementation details today, but their outputs are protocol contract and must be reproduced exactly by the self-hosted backend.

| Surface | Current TS location | Why exact match matters | Fixture coverage |
| --- | --- | --- | --- |
| Canonical JSON sorting | `packages/shared/src/canonical.ts` | `intentHash` must match across runtimes | `canonicalJson` |
| `intentHash = SHA-256(canonicalJson)` | `packages/shared/src/canonical.ts` | WebAuthn / softkey proof binding depends on it | `canonicalJson` |
| Cipher bundle AAD string and UTF-8 bytes | `packages/shared/src/protocol.ts` | Receiver decrypt integrity depends on the same AAD | `aad` |
| `lock_key = SHA-256("GL-lockkey" || uuid || lock_secret)` | `packages/frontend/src/crypto/protocol-utils.ts` | Receiver lock proof verification | `challengeDerivation.lock` |
| `lock_proof = SHA-256("GL-lock" || uuid || challenge_id || challenge || lock_key)` | `packages/frontend/src/crypto/protocol-utils.ts` | TOFU preemption defense | `challengeDerivation.lock` |
| `expectedCompoundChallenge = SHA-256("GLv2.5" || uuid || challenge_id || intent_hash || seed)` | `packages/frontend/src/crypto/protocol-utils.ts` | Intent-bound WebAuthn challenge | `challengeDerivation.compound` |
| `deliveryProofChallenge = SHA-256("GL-delivery-proof" || uuid || intent_hash)` | `packages/shared/src/senderAuth.ts` | Detached delivery proof verification | `challengeDerivation.deliveryProof` |
| Multipart chunk IV/AAD derivation (`baseIv XOR chunkIndex`, AAD = `uuid || "chunk" || be32(index)`) | `packages/shared/src/multipart.ts` | Large-file decrypt integrity and anti-reordering | — |
| WebSocket message schemas | `packages/shared/src/ws.ts` | Realtime sync compatibility | `ws` |

The frozen JSON fixtures live at `protocol-fixtures/selfhost-contract-v1.json`.

### Input Encoding Rules

All hash derivations follow the same pattern: each input is encoded independently, then the resulting byte slices are concatenated in order before hashing with SHA-256.

| Parameter kind | Encoding | Examples |
| --- | --- | --- |
| Domain prefix string | UTF-8 → bytes | `"GL-lockkey"`, `"GL-lock"`, `"GLv2.5"`, `"GL-delivery-proof"` |
| UUID | UTF-8 → bytes (the string itself, not decoded) | `uuid` in all derivations |
| Base64url-encoded input | **base64url decode → raw bytes** | `lock_secret`, `challenge_id`, `challenge`, `lock_key`, `seed` |
| Intent hash (hex string) | **UTF-8 → bytes (the 64-char hex string as-is, NOT hex-decoded)** | `intentHash` in compound challenge and delivery proof |

Output encoding varies per function:

| Function | Output encoding |
| --- | --- |
| `lock_key` | base64url |
| `lock_proof` | lowercase hex (64 chars) |
| `expectedCompoundChallenge` | base64url |
| `deliveryProofChallenge` | base64url |
| `intentHash` | lowercase hex (64 chars) |

### Canonical JSON Rules

`canonicalJsonStringify` applies **recursive** alphabetical key sorting:

- Object keys at every nesting level are sorted lexicographically (JavaScript `Array.sort()` default)
- Array element order is preserved; only object keys within arrays are sorted
- `undefined` values are omitted from output (key is dropped)
- `null` is preserved as `null` in the JSON output
- The sorted object is serialized via `JSON.stringify` (standard JSON encoding)

## HTTP Contract Matrix

| Route | Method | Request schema | Success schema | Current frontend caller | Notes |
| --- | --- | --- | --- | --- | --- |
| `/api/create_begin/:uuid` | `POST` | `CreateBeginRequestSchema` | `CreateBeginResponseSchema` | `apiClient.createBegin()` | Always returns `creationOptions`; password-mode compatibility stays frozen for now |
| `/api/create_finish/:uuid` | `POST` | `CreateFinishRequestSchema` | `CreateFinishResponseSchema` | `apiClient.createFinish()` | Accepts `webauthn`, `password`, and legacy `softkey` schema variants; `secure` channels must finalize with `webauthn`, while `quick` channels may use any of the three |
| `/api/lock_begin/:uuid` | `POST` | `LockBeginRequestSchema` | `LockBeginResponseSchema` | `apiClient.lockBegin()` | Begin step for receiver locking; may set caller-binding commit-cookie state via response headers |
| `/api/lock_commit/:uuid` | `POST` | `LockCommitRequestSchema` | `LockCommitResponseSchema` | `apiClient.lockCommit()` | Consumes the active lock challenge; may clear or rotate commit-cookie state via response headers |
| `/api/manage/compound_begin/:uuid` | `POST` | `CompoundBeginRequestSchema` | `CompoundBeginResponseSchema` | `apiClient.compoundBegin()` | Returns current admin mode, security profile, version, and optional receiver identity; may set caller-binding commit-cookie state via response headers |
| `/api/manage/compound_commit/:uuid` | `POST` | `CompoundCommitRequestSchema` or `SoftkeyCompoundCommitRequestSchema` | `CompoundCommitResponseSchema` | `apiClient.compoundCommit()` | Handles update delivery flow; may clear or rotate commit-cookie state via response headers |
| `/api/delete_commit/:uuid` | `POST` | Same commit unions with `intent.op = delete` | `{ ok: true }` | `apiClient.deleteCommit()` | Delete-only alias over compound commit path; inherits the same commit-cookie caller-binding semantics |
| `/api/public/:uuid` | `GET` | none | `PublicStatusResponseSchema` | `apiClient.publicStatus()` and polling fallback | Active-channel public snapshot only; once a channel is tombstoned or lazily purged, canonical external behavior is `404 NOT_FOUND` rather than a `200` terminal snapshot |
| `/api/decrypt_fetch/:uuid` | `GET` | none | `DecryptFetchResponseSchema` | `apiClient.decryptFetch()` | Returns decrypt payload after delivery; the response includes exactly one of `cipherBundle` or `fileRef`, and `cipherVersion` is the delivered payload version (`record.version - 1` in the current DO implementation), not the raw channel record version |
| `/api/file_policy` | `GET` | none | `FilePolicyResponseSchema` | `apiClient.filePolicy()` | Returns deployment file ceilings, legacy inline compatibility bounds, chunk sizing, and multipart capability; frontend uses this to validate whether file delivery is available and to configure upload/chunking limits |
| `/api/file/initiate` | `POST` | `FileUploadInitiateRequestSchema` | `FileUploadInitiateResponseSchema` | `apiClient.fileUploadInitiate()` | When `S3_PUBLIC_ENDPOINT` is set, returns S3 presigned PUT URLs per chunk; when unset, returns relative API-proxied `file/chunk/<token>` targets with short-lived in-memory authorization, and the Go API streams chunk bytes on behalf of the browser |
| `/api/file/complete` | `POST` | `FileUploadCompleteRequestSchema` | `FileUploadCompleteResponseSchema` | `apiClient.fileUploadComplete()` | Validates uploaded chunk metadata and returns the typed `fileRef` later embedded in `compound_commit` |
| `/api/file/fetch/:uuid` | `GET` | none | `FileFetchResponseSchema` | `apiClient.fileFetch()` | For delivered multipart payloads, returns one download URL per chunk (presigned S3 when `S3_PUBLIC_ENDPOINT` is set, relative API-proxied single-use `file/download/<token>` targets when unset); inline payloads continue through `decrypt_fetch` only |
| `/api/ws/:uuid` | `GET` + WebSocket upgrade | `WsClientMessageSchema` after subscribe | `WsServerMessageSchema` | `ChannelSync.connect()` | Upgrade must reject non-WS requests with `426` + `{ ok: false, code: "BAD_REQUEST" }` today |

When `SELFHOST_API_S3_PUBLIC_ENDPOINT` is set (external S3 reachable by the browser), chunk bytes
go directly to S3 presigned URLs returned by `/api/file/initiate` and `/api/file/fetch/:uuid`.
When unset (e.g., Docker-internal Garage), the Go API issues short-lived opaque proxy targets under
`/api/file/chunk/{token}` (PUT) and `/api/file/download/{token}` (GET). The browser receives those
targets as relative `file/...` URLs so custom API base paths still work, and direct storage keys are
not exposed through the proxy path. Download proxy targets are single-use: once a GET consumes the
token, the client must call `/api/file/fetch/:uuid` again to obtain a fresh target if it needs to retry.

### Multipart Delivery Overlay

- All new `payloadKind: "file"` deliveries use object storage `fileRef`; only text payloads use inline `cipherBundle`. The `multipartThresholdBytes` in `/api/file_policy` is retained as a legacy compatibility/config bound, but it does not switch new file writes between inline and multipart.
- Update intents must carry exactly one of `cipherBundle` or `fileRef`; multipart deliveries also require `payloadKind: "file"`.
- `/api/decrypt_fetch/:uuid` still remains the source of truth for delivery metadata and returns exactly one of `cipherBundle` or `fileRef`.
- `/api/file/fetch/:uuid` is only meaningful after `decrypt_fetch` reveals a multipart `fileRef`.

## Error Semantics Matrix

| Code | HTTP status | Current source | Meaning |
| --- | --- | --- | --- |
| `BAD_REQUEST` | `400` | Worker edge validation | Malformed JSON, schema mismatch, invalid UUID, path/body UUID mismatch |
| `BAD_REQUEST` | `426` | Worker WS upgrade gate | `/api/ws/:uuid` hit without `Upgrade: websocket` |
| `METHOD_NOT_ALLOWED` | `405` | Worker router | Wrong HTTP verb; `Allow` header is set |
| `NOT_FOUND` | `404` | Worker router or DO | Unknown API route, missing channel, finalized terminal state, or `/api/file/fetch/:uuid` when no multipart file payload is available |
| `BAD_REQUEST` | `400` | File coordination routes / S3 metadata validation | Invalid file-policy input, malformed multipart metadata, missing chunks, or S3 presign/stat validation failure |
| `STORAGE_ERROR` | `502` | Self-host file proxy routes | Proxied upload/download could not reach the configured object storage backend |
| `NOT_IMPLEMENTED` | `501` | Worker router | Placeholder route matched but no implementation exists |
| `INTERNAL_ERROR` | `500` | Worker or DO | Unexpected exception or invalid upstream response |
| `RATE_LIMITED` | `429` | DO | Application-layer throttling; `Retry-After` may be present |
| `CHANNEL_NOT_DELIVERED` | `409` | DO decrypt-fetch read path | Channel exists, but ciphertext is not yet available for decrypt |
| `CHALLENGE_INVALID` | `401` | DO | Challenge missing, expired, or otherwise invalid |
| `CHALLENGE_CONSUMED` | `409` | DO | Challenge already used |
| `LOCK_FORBIDDEN` | `403` | DO | Invalid transition, terminal state, or lock not allowed |
| `VERSION_MISMATCH` | `409` | DO | Stale or out-of-order update/delete intent |
| `NONCE_REPLAY` | `409` | DO | Nonce already consumed |
| `TIMESTAMP_OUT_OF_RANGE` | `400` | DO | Timestamp outside allowed skew window |
| `INTENT_HASH_MISMATCH` | `400` | DO | Signed payload does not match declared `intentHash` |
| `CIPHER_BUNDLE_INVALID` | `400` | DO | Cipher bundle integrity / shape rejection |
| `ASSERTION_INVALID` | `403` | DO | WebAuthn or softkey signature verification failed |
| `ATTESTATION_UNVERIFIABLE` | `403` | DO | Creation attestation validation failed |

## Channel State Machine

The backend must enforce these state transitions exactly. Any transition not listed below must be rejected with `LOCK_FORBIDDEN`.

| From | To | Trigger | Notes |
| --- | --- | --- | --- |
| `waiting` | `locked` | `lock_commit` | Valid `lock_proof` required |
| `locked` | `delivered` | `compound_commit` | First delivery; cipher bundle required |
| `delivered` | `delivered` | `compound_commit` | Update delivery; version must increment |
| `waiting`, `locked`, `delivered` | `deleted` | `delete_commit` | Valid sender auth (WebAuthn or softkey) |
| any non-terminal | `expired` | TTL expiration | Automatic; no API trigger |

Terminal states (`deleted`, `expired`) allow no outbound transitions. Once a terminal state has been finalized into a tombstone, or an expired record has been lazily purged, subsequent external requests canonically return `NOT_FOUND`. `LOCK_FORBIDDEN` remains the invalid-transition code for active non-terminal records.

Valid states: `waiting`, `locked`, `delivered`, `deleted`, `expired`.

Valid admin modes: `webauthn`, `password`, `softkey` (legacy alias for `password`; must be accepted everywhere `password` is).

Valid security profiles: `quick`, `secure`.

Admin-mode binding invariant: `secure` channels must use `webauthn` at `create_finish`; `quick` channels may use `webauthn`, `password`, or `softkey`.

## WebSocket Compatibility

- Client messages are validated against `WsClientMessageSchema`
- Server messages are validated against `WsServerMessageSchema`
- Frontend behavior is WS-first and HTTP-polling fallback second
- Message ordering requirement is semantic, not just transport-level: frontend only accepts `version >= lastVersion`
- Server message types: `state_changed`, `channel_closed` (reasons: `deleted` | `expired`), `pong`
- Client message types: `subscribe`, `ping`

### Polling Fallback

When WebSocket disconnects, the frontend falls back to polling `/api/public/:uuid` every 18 seconds (`POLL_INTERVAL_MS`). This path is compatibility-equivalent, not byte-for-byte identical, to WebSocket `state_changed`: the response still uses `PublicStatusResponseSchema`, which has no `version`, and the frontend reuses its local `lastVersion` when turning poll responses into `ChannelStateUpdate`s. Canonical external behavior for missing, deleted, or expired channels is `404 NOT_FOUND`; the frontend still tolerates legacy `200` terminal snapshots, but the Go backend should target the tombstone-driven `404` semantics.

## Open Ambiguities

These points are intentionally frozen as open questions so the Go implementation does not guess.

1. Commit-cookie binding is a backend-only security mechanism today. The frontend does not read it, but the self-hosted backend must preserve equivalent begin/commit caller binding before M4/M5 lands.
2. `create_begin` always returns `creationOptions` even though password-mode creation does not consume WebAuthn in the same way. Keep the response shape stable unless a separate frontend contract change is made.
3. Rate-limit bucket sizes and windows are not part of the shared schema contract. The self-hosted backend should preserve code/status semantics first, then document policy separately.
4. WebSocket transport can only be replaced if `/api/ws/:uuid` semantics and the current polling fallback remain compatible without frontend changes.

## Fixture Consumption Rules

- Add new fixture groups by extending `protocol-fixtures/selfhost-contract-v1.json` instead of scattering constants across tests
- Keep fixture inputs ASCII and transport-safe unless a protocol requirement needs otherwise
- Treat fixture updates as contract changes: update this document, fixture JSON, and the tests together
