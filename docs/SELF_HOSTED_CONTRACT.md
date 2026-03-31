# Self-Hosted Backend Contract Freeze

This document freezes the protocol-facing contract that the self-hosted backend must reproduce before any Go implementation starts.

## Scope

- Enumerate the current HTTP and WebSocket contract that the frontend depends on
- Freeze the exact-match surfaces that must stay byte-for-byte compatible
- Document the externally visible error semantics
- Call out open ambiguities that must be resolved explicitly instead of drifting implicitly

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
| WebSocket message schemas | `packages/shared/src/ws.ts` | Realtime sync compatibility | `ws` |

The frozen JSON fixtures live at `protocol-fixtures/selfhost-contract-v1.json`.

## HTTP Contract Matrix

| Route | Method | Request schema | Success schema | Current frontend caller | Notes |
| --- | --- | --- | --- | --- | --- |
| `/api/create_begin/:uuid` | `POST` | `CreateBeginRequestSchema` | `CreateBeginResponseSchema` | `apiClient.createBegin()` | Always returns `creationOptions`; password-mode compatibility stays frozen for now |
| `/api/create_finish/:uuid` | `POST` | `CreateFinishRequestSchema` | `CreateFinishResponseSchema` | `apiClient.createFinish()` | Accepts `webauthn`, `password`, and legacy `softkey` admin modes |
| `/api/lock_begin/:uuid` | `POST` | `LockBeginRequestSchema` | `LockBeginResponseSchema` | `apiClient.lockBegin()` | Begin step for receiver locking |
| `/api/lock_commit/:uuid` | `POST` | `LockCommitRequestSchema` | `LockCommitResponseSchema` | `apiClient.lockCommit()` | Current backend may set a commit-cookie via response headers |
| `/api/manage/compound_begin/:uuid` | `POST` | `CompoundBeginRequestSchema` | `CompoundBeginResponseSchema` | `apiClient.compoundBegin()` | Returns current admin mode, security profile, version, and optional receiver identity |
| `/api/manage/compound_commit/:uuid` | `POST` | `CompoundCommitRequestSchema` or `SoftkeyCompoundCommitRequestSchema` | `CompoundCommitResponseSchema` | `apiClient.compoundCommit()` | Handles update delivery flow |
| `/api/delete_commit/:uuid` | `POST` | `DeleteIntent` wrapped in the same commit unions | `{ ok: true }` | `apiClient.deleteCommit()` | Delete-only alias over compound commit path |
| `/api/public/:uuid` | `GET` | none | `PublicStatusResponseSchema` | `apiClient.publicStatus()` and polling fallback | Public state snapshot only |
| `/api/decrypt_fetch/:uuid` | `GET` | none | `DecryptFetchResponseSchema` | `apiClient.decryptFetch()` | Returns decrypt payload after delivery |
| `/api/ws/:uuid` | `GET` + WebSocket upgrade | `WsClientMessageSchema` after subscribe | `WsServerMessageSchema` | `ChannelSync.connect()` | Upgrade must reject non-WS requests with `426` + `{ ok: false, code: "BAD_REQUEST" }` today |

## Error Semantics Matrix

| Code | HTTP status | Current source | Meaning |
| --- | --- | --- | --- |
| `BAD_REQUEST` | `400` | Worker edge validation | Malformed JSON, schema mismatch, invalid UUID, path/body UUID mismatch |
| `BAD_REQUEST` | `426` | Worker WS upgrade gate | `/api/ws/:uuid` hit without `Upgrade: websocket` |
| `METHOD_NOT_ALLOWED` | `405` | Worker router | Wrong HTTP verb; `Allow` header is set |
| `NOT_FOUND` | `404` | Worker router or DO | Unknown API route, missing channel, or finalized terminal state |
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

## WebSocket Compatibility

- Client messages are validated against `WsClientMessageSchema`
- Server messages are validated against `WsServerMessageSchema`
- Frontend behavior is WS-first and HTTP-polling fallback second
- Message ordering requirement is semantic, not just transport-level: frontend only accepts `version >= lastVersion`

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
