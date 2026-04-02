<!--
UPDATE WHEN:
- Adding new entry points or key files
- Introducing new patterns
- Discovering non-obvious behavior
-->

# Code Landmarks

## Agent Docs
| Location | Purpose |
|----------|---------|
| `CLAUDE.md` | Claude router for shared repo guidance |
| `AGENTS.md` | Generic agent router and workflow summary |
| `GEMINI.md` | Gemini CLI router |
| `.ai/README.md` | Shared guidance index |
| `.ai/workflows.md` | Canonical workflow, branch naming, and wording rules |
| `docs/SELF_HOSTED_CONTRACT.md` | Self-hosted backend contract freeze: exact-match protocol surfaces, route matrix, error semantics, and open ambiguities |
| `docs/SELF_HOSTED_CONTRACT.zh.md` | Chinese mirror of the self-hosted backend contract freeze |
| `.agents/skills/` | Agent-neutral reusable skills compatibility layer |
| `_project_specs/session/decisions.md` | Newest-first workflow and architecture decision log |
| `_project_specs/session/code-landmarks.md` | Quick navigation map for key entrypoints and gotchas |

## Entry Points
| Location | Purpose |
|----------|---------|
| `packages/frontend/src/bootstrap-entry.ts` | Frontend bootstrap verifier entry; loads the app only after release verification |
| `packages/frontend/src/main.tsx` | React app renderer invoked by the bootstrap entry after verification |
| `packages/backend/src/index.ts` | Production Worker entry — routes API requests and exports only the active `SecretVaultV2` Durable Object binding |
| `packages/backend/src/index.staging.ts` | Staging-only Worker entry — mirrors production exports while keeping staging on its own Worker and namespace |
| `packages/backend/src/worker.ts` | Shared Worker fetch/router implementation used by both production and staging entrypoints; now also runs the hourly orphan-chunk cleanup hook |
| `packages/shared/src/index.ts` | Shared package exports (types, schemas, constants, crypto) |
| `services/selfhost-api/cmd/selfhost-api/main.go` | Self-hosted Go API entrypoint — loads config, opens PostgreSQL, boots the in-memory realtime hub, and serves health, protocol routes, and `/api/ws/:uuid` |
| `services/selfhost-api/cmd/selfhost-migrate/main.go` | Self-hosted Go migration entrypoint — runs embedded SQL migrations against PostgreSQL |

## Core Business Logic
| Location | Purpose |
|----------|---------|
| `packages/shared/src/crypto/` | Argon2id KDF, AES-GCM, HKDF, Ed25519 helpers |
| `packages/backend/src/do/SecretVault.ts` | Durable Object — atomic channel lifecycle state machine |
| `packages/backend/src/file-cleanup.ts` | Hourly R2 orphan-chunk reclaimer — scans `files/`, consults the channel DO for active multipart `fileRef`s, and deletes only stale unreferenced chunk objects |
| `packages/backend/src/do/SecretVaultCompound.ts` | Durable Object compound-commit path — validates signed update/delete intents, accepts typed multipart `fileRef` payloads when present, enforces inline file ciphertext ceilings for `payloadKind: "file"`, and persists delivery proofs used by anchored decrypt verification |
| `packages/backend/src/do/SecretVaultWebSocket.ts` | Durable Object WebSocket accept/broadcast helpers for channel state sync |
| `packages/frontend/src/crypto/orchestrator.ts` | Frontend crypto orchestration (create / lock / deliver / decrypt) |
| `packages/frontend/src/crypto/orchestrator-multipart.ts` | Frontend multipart file transport helper — streams `Blob`/byte inputs into chunked AES-GCM encryption, coordinates `/api/file/*` upload/download orchestration, and reassembles decrypted file bytes on receipt |
| `packages/frontend/src/crypto/orchestrator-decrypt.ts` | Delivered-payload decrypt path — resolves anchored delivery proof versions, preserves backward-compatible raw-text decoding, and only treats payloads as downloadable files when signed delivery metadata declares `payloadKind: "file"` |
| `packages/shared/src/payload.ts` | Shared encrypted payload envelope for delivered content — wraps text/file payloads, decodes decrypted bytes back into `payload.kind`, and sanitizes download filenames for receiver-side save actions |
| `packages/shared/src/multipart.ts` | Shared multipart helpers — derives per-chunk IV/AAD bindings, resolves chunk counts/total ciphertext sizing, and keeps frontend/backend chunk math aligned |
| `packages/backend/src/file-policy.ts` | Worker-side file policy resolver — parses env-configured file limits, validates the inline-only phase-1 ceiling, and serves `/api/file_policy` responses |
| `packages/backend/src/file-storage.ts` | Worker multipart storage helpers — signs upload-session IDs, builds R2 chunk keys, validates chunk presence, and materializes `fileRef` metadata for Durable Object delivery records |
| `packages/backend/src/file-routes.ts` | Worker file transport routes — coordinates multipart initiate/chunk/complete flows, resolves multipart decrypt fetches, and serves R2-backed chunk downloads outside the Durable Object hot path |
| `packages/frontend/src/pages/create/share-link-session-cache.ts` | Best-effort session-scoped cache for same-session sender recovery of one-time share links while a channel is still waiting; each entry expires against the selected channel TTL |
| `packages/frontend/src/pages/manage/use-manage-actions.ts` | Sender delivery action bridge — turns selected `File` objects into bytes for `cryptoOrchestrator.deliverSecret(...)` and enforces text/file mutual exclusivity through Manage page state |
| `packages/frontend/src/features/share/share-logic.ts` | Receiver-side delivered-state controller — owns decrypt submit/burn behavior and the explicit click-to-download path for decrypted files |
| `packages/frontend/src/components/safety/safety-code.tsx` | Shared sender/receiver fingerprint verification card; supports a compact density so terminal-state mobile layouts can stay verification-first without pushing the primary action too far below the fold |
| `packages/frontend/src/sync/` | Channel sync client: WebSocket-first subscription with `/api/public/:uuid` polling fallback |
| `packages/frontend/src/stores/` | Zustand stores: `create-store`, `decrypt-store`, `deliver-store`, `lock-store` |
| `packages/frontend/src/release/verification.ts` | Browser-side signed-manifest verifier |
| `packages/frontend/src/release/tiered-verification.ts` | Cached release verifier that revalidates signed manifest bytes before reusing trusted snapshots |
| `packages/shared/src/ws.ts` | Shared Zod schemas and types for channel sync WebSocket messages |
| `scripts/generate-manifest.ts` | Build-time manifest generator (hashes `dist/assets/`, records `entryAssetPath`, and prefers CI-injected `ZEROLINK_VERSION` over `packages/frontend/package.json`) |
| `scripts/sign-manifest.ts` | Ed25519 manifest signer (requires `MANIFEST_SIGNING_KEY` env var) |
| `scripts/verify-manifest.ts` | CLI manifest verifier — enforces entry binding + file hashes |
| `packages/frontend/e2e/happy-path.spec.ts` | Canonical end-to-end coverage for create-only share-link visibility and ManagePage sender flow |
| `services/selfhost-api/internal/service/protocol.go` | Self-hosted M3 protocol layer — validates create/public requests, generates WebAuthn-compatible creation options, delegates `create_finish` credential finalization, and maps store semantics to frontend-compatible HTTP errors |
| `services/selfhost-api/internal/service/protocol_create_finish.go` | Self-hosted WebAuthn/softkey create-finalize flow — loads the stored create challenge and persists finalized admin credentials inside one channel transaction, so verifier/save failures roll back cleanly instead of stranding waiting links |
| `services/selfhost-api/internal/service/protocol_manage.go` | Self-hosted manage-flow transaction layer — owns lock/compound entrypoints, shared delivery application, and realtime publish triggers |
| `services/selfhost-api/internal/service/protocol_manage_helpers.go` | Self-hosted manage payload helper layer — owns manage input validation, canonical intent hashing, delivery-proof serialization, fingerprint/signature helpers, and delivery precondition checks |
| `services/selfhost-api/internal/store/filestore/minio.go` | Self-hosted multipart object-store adapter — validates multipart request metadata, issues MinIO presigned upload/download URLs, and turns completed uploads into persisted `fileRef` records |
| `services/selfhost-api/internal/httpapi/websocket.go` | Self-hosted WebSocket route — upgrades `/api/ws/:uuid`, validates subscribe payloads, sends the initial snapshot, and preserves the shared close-code/message contract |
| `services/selfhost-api/internal/realtime/hub.go` | Self-hosted single-node realtime hub — tracks subscribed websocket clients, fan-outs `state_changed` / `channel_closed`, replies to pings, and auto-closes expired channels |
| `services/selfhost-api/internal/webauthn/attestation.go` | Go-native WebAuthn attestation verifier for self-hosted create flows — validates RP ID/origin/challenge, parses attested credential data, supports `fmt:none` and packed self-attestation, and returns `StoredCredential` fields for persistence |

## Configuration
| Location | Purpose |
|----------|---------|
| `tsconfig.base.json` | Root TypeScript config (strict mode) |
| `tsconfig.scripts.json` | Root TypeScript config for `scripts/` and root Vitest config typechecking |
| `biome.json` | Lint/format config |
| `pnpm-workspace.yaml` | Monorepo workspace definition |
| `packages/backend/src/security-headers.ts` | Worker-applied cache + security headers (`no-store` for SPA entry, immutable for `/assets/*`) |
| `.github/workflows/pr-validate.yml` | PR CI gates: root/workspace typecheck, root/workspace unit tests, frontend build on `pull_request` / `merge_group` (E2E suites run in `e2e-full.yml` nightly/manual only — PR #184 free-tier budget) |
| `.github/workflows/release-please.yml` | Automated release workflow — validates `RELEASE_PLEASE_TOKEN`, then runs the commit-pinned official `release-please` action to update root `version.txt` / `CHANGELOG.md`, open Release PRs on `main`, and create `v*` tags + GitHub Releases; current upstream Node 20 warning is tolerated until the pinned action is upgraded |
| `packages/backend/wrangler.toml` | Cloudflare Workers + Durable Objects config; both envs now bind to `SecretVaultV2`, while historical migration entries preserve the prior namespace cutovers |
| `services/selfhost-api/internal/config/config.go` | Self-hosted env loader — now also owns file policy env vars (`SELFHOST_API_FILE_*`) and enforces phase-1 inline file ceilings at startup |
| `services/selfhost-api/internal/httpapi/router.go` | Self-hosted protocol router — now serves `/api/file_policy` and applies a config-driven JSON body limit for file-capable protocol requests |
| `packages/backend/.env.e2e` | Test-only Wrangler env source for local realtime smoke E2E; provides non-secret RP and commit-token values without dashboard secrets |
| `deploy/selfhost/docker-compose.yml` | Self-hosted local stack bundle — starts PostgreSQL, migration job, Go API, and Caddy-served frontend with `.env` fallback to `.env.example` |
| `deploy/selfhost/Caddyfile` | Self-hosted reverse-proxy and SPA fallback config — `/api/*`, `/healthz`, and `/readyz` must route before static fallback |
| `deploy/selfhost/api.Dockerfile` | Multi-stage image build for `selfhost-api` and `selfhost-migrate` |
| `deploy/selfhost/frontend.Dockerfile` | Frontend build + Caddy runtime image for the self-hosted local stack |
| `services/selfhost-api/.env.example` | Self-hosted Go service env template — bind address, RP ID/origin, pool sizing, and PostgreSQL DSN |
| `services/selfhost-api/go.mod` | Nested Go module for the self-hosted backend track |
| `.github/workflows/deploy.yml` | Post-merge CI/CD: resolve `ZEROLINK_VERSION`, frontend build, manifest generate/sign/verify, then Worker deploy; staging adds a post-deploy smoke test |
| `version.txt` | Root release state tracked by Release Please's `simple` strategy; seed value is the last manual release (`0.2.0`) |

## File Size Rule

- **Target:** 200–400 lines. **Hard limit:** 800 lines — split before merging.
- Test files follow the same limit; split by describe block / feature domain.
- Extract shared test helpers to `__tests__/helpers/`; keep `vi.mock()` in each file (Vitest hoisting).
- See `.ai/coding-standards.md` § File Size for full details.

## Key Patterns
| Pattern | Example Location | Notes |
|---------|-----------------|-------|
| `Result<T, E>` | `packages/shared/src/types.ts` | Never throw from crypto/network |
| Zod schemas | `packages/shared/src/schemas.ts` | Shared between frontend and backend |
| WebCrypto | `packages/frontend/src/crypto/` | Use `window.crypto.subtle` |
| Argon2id via @noble | `packages/shared/src/crypto/kdf.ts` | WebCrypto lacks Argon2 |
| Immutable stores | `packages/frontend/src/stores/` | Zustand with no direct mutation |

## Testing
| Location | Purpose |
|----------|---------|
| `packages/shared/src/**/__tests__/` | Vitest unit tests for shared schemas/crypto |
| `packages/frontend/src/__tests__/` | React component and integration tests (Vitest + Testing Library) |
| `packages/frontend/src/__tests__/selfhost-contract-fixtures.test.ts` | Frontend-side deterministic fixtures for lock-key, lock-proof, and compound challenge derivation |
| `packages/frontend/src/__tests__/helpers/orchestrator-fixtures.ts` | Shared frontend crypto test helpers — defaults orchestrator tests to fast Argon2id params and provides seeded immutable decrypt fixtures for heavy flows |
| `packages/backend/src/**/__tests__/` | Worker + Durable Object unit tests |
| `packages/shared/src/__tests__/selfhost-contract-fixtures.test.ts` | Shared cross-runtime fixture verification for canonical JSON, intent hashes, AAD, delivery-proof challenge, and WS message schemas |
| `packages/shared/src/__tests__/payload.test.ts` | Shared payload-envelope tests for text/file round-trips, legacy text fallback, and tamper detection on encrypted file metadata |
| `packages/frontend/src/__tests__/crypto-orchestrator-deliver.test.ts` | Frontend deliver-flow coverage, including file-policy-driven file delivery and `MULTIPART_REQUIRED` rejection |
| `packages/frontend/src/__tests__/share-page-decrypt.test.tsx` | Receiver delivered-page UI coverage, including plaintext burn and download-only decrypted file UX |
| `packages/frontend/src/__tests__/manage-page-deliver.test.tsx` | Sender Manage page integration coverage for text/file delivery inputs and action error handling |
| `packages/backend/src/__tests__/worker-scheduled-file-cleanup.test.ts` | Worker scheduled cleanup regression test — proves stale orphan R2 chunks are deleted while active or fresh chunks survive |
| `services/selfhost-api/internal/app/app_test.go` | Self-hosted runtime regression tests for protocol body sizing, ensuring file-policy tightening does not reduce the inline text delivery ceiling |
| `services/selfhost-api/internal/httpapi/router_test.go` | Self-hosted Go HTTP smoke tests for health, readiness, M3 create/public routes, remaining placeholders, and websocket upgrade gating |
| `services/selfhost-api/internal/httpapi/websocket_test.go` | Self-hosted websocket route tests for subscribe bootstrap, ping/pong, state fan-out, and channel close notifications |
| `services/selfhost-api/internal/service/protocol_test.go` | Self-hosted Go M3 service tests covering quick/secure create flows, downgrade rejection, transactional WebAuthn finalize rollback, attestation failure mapping, and expired public-status tombstoning |
| `services/selfhost-api/internal/config/config_test.go` | Self-hosted Go config validation tests for required env vars and pool bounds |
| `services/selfhost-api/internal/webauthn/attestation_test.go` | Self-hosted Go WebAuthn verifier tests for challenge validation, `fmt:none` credential extraction, and packed self-attestation verification |
| `packages/frontend/e2e/` | Playwright E2E: happy-path, mocked realtime fallback/cross-device coverage, realtime WebSocket smoke, expiration, rate-limit, fragment cleanup, manifest-verification |
| `packages/frontend/playwright.config.ts` | Regular Playwright suite using a single non-verification build/server |
| `packages/frontend/playwright.realtime.config.ts` | Realtime smoke Playwright suite that starts frontend preview plus local `wrangler dev` with test-only env vars |
| `packages/frontend/playwright.verification.config.ts` | Manifest-verification-only Playwright suite using the verification-enabled build/server |
| `protocol-fixtures/selfhost-contract-v1.json` | Versioned language-agnostic protocol fixtures for the self-hosted backend contract freeze |
| `scripts/__tests__/` | Vitest unit tests for build scripts (manifest generation/verification) |

## Gotchas & Non-Obvious Behavior
| Location | Issue | Notes |
|----------|-------|-------|
| URL fragments | Never sent to server | Key material lives in `window.location.hash` |
| Durable Objects | Single-location consistency | All channel data stored in DO SQLite; no external KV dependency |
| `@noble/hashes` | Not WebCrypto | Runs synchronously; may block UI on heavy params |
| `packages/frontend/src/__tests__/helpers/orchestrator-fixtures.ts` | `createOrchestrator()` defaults to fast KDF params in tests | Opt out with `{ useFastKdf: false }` when a frontend smoke test must exercise production-strength Argon2id defaults |
| Biome | No ESLint plugins | Some rules need manual enforcement |
| `packages/frontend/src/crypto/webauthn.ts` | `useLiteralKeys` Biome errors | Cannot auto-fix; TypeScript `noPropertyAccessFromIndexSignature` requires bracket notation in this file — do not touch |
| `packages/frontend/src/release/verification.ts` | Verified Release covers only `dist/assets/*` | Root documents (`index.html`, `robots.txt`) are excluded from the signed manifest because Cloudflare can mutate edge responses; the executing bootstrap entry must still match `manifest.entryAssetPath` |
| `packages/frontend/src/release/tiered-verification.ts` | Cached release trust still revalidates `manifest.json` + `manifest.sig` | `manifest-hash.txt` is an unsigned helper and may only be used as a freshness hint before deciding whether to run full verification |
| `packages/shared/src/payload.ts` + `packages/frontend/src/features/share/share-logic.ts` | File delivery is intentionally download-only in phase 1 | Do not add preview rendering on the receiver page without a new security review; decrypted files must stay out of the DOM and only download on explicit click. Keep filename sanitization character-based instead of using control-character regex ranges so Biome stays green across the shared package, but preserve the legacy behavior that collapses consecutive invalid filename characters into a single underscore. |
| `packages/frontend/src/pages/manage/use-manage-page-state.ts` + `packages/frontend/src/pages/manage/manage-components.tsx` | The sender file picker now rejects oversize files immediately | Keep the displayed size hint aligned with `policy.maxFileBytes` and clear the native file input when a file is rejected, or the user cannot re-select the same file after an over-limit attempt. |
| `packages/frontend/src/crypto/orchestrator-deliver.ts` | Inline text deliveries intentionally stay on the legacy raw-byte path | File payloads must be size-checked after envelope metadata is added, but text shares keep the published 2 MB ceiling until multipart delivery changes the transport |
| `packages/frontend/src/crypto/orchestrator-decrypt.ts` + `packages/shared/src/payload.ts` | `payloadKind` stays optional for transport compatibility, but file decode is strict | New deliveries sign and persist `payloadKind`, and receiver-side download handling only activates when `payloadKind === "file"`. Undeclared payloads stay on the raw-text path so file-policy enforcement cannot be bypassed by omitting the type bit during proof generation. |
| `packages/shared/src/multipart.ts` + `packages/frontend/src/crypto/orchestrator-multipart.ts` | Multipart file delivery binds chunk order cryptographically | Each chunk derives its own AES-GCM IV from `baseIv XOR chunkIndex`, and AAD includes `channelUuid + "chunk" + index`, so storage backends cannot reorder encrypted chunks without breaking receiver-side verification. |
| `packages/backend/src/file-cleanup.ts` + `packages/backend/src/do/SecretVaultStorage.ts` | Hosted R2 cleanup now has two layers | Channel delete/expiry still removes the current multipart payload immediately, while the hourly Worker sweep only reclaims stale chunks that are no longer referenced by active channel state. |
| `services/selfhost-api/internal/config/config.go` + `deploy/selfhost/.env.example` | Self-hosted multipart thresholds stay capped by the inline ceiling | `maxFileBytes` may be much larger when `SELFHOST_API_FILE_STORAGE_BACKEND=minio`, but `SELFHOST_API_FILE_MULTIPART_THRESHOLD_BYTES` must stay at or below the inline envelope ceiling because only inline-capable files may remain on the legacy `cipherBundle` path. |
| `packages/backend/src/do/SecretVault.ts` | `/ws` upgrades require an active channel record and top-level redaction | Missing or terminal channels must fail the WebSocket upgrade so dead links do not keep idle Durable Object sockets alive, and unexpected `fetch()`-level `/ws` failures must still flow through `mapError()` with handler `ws_subscribe` |
| `packages/backend/src/do/SecretVaultHttp.ts` | Production observability intentionally omits raw exception text | `mapError()` keeps staging stacks/messages for debugging, but production emits only a structured error name + handler + fingerprint payload; `stack_fingerprint` is based on a normalized handler + error-name + frame signature, not raw stack text or bundle offsets; use `APP_ENV` from `packages/backend/wrangler.toml`, not hostnames, to reason about log detail |
| `packages/backend/src/security-headers.ts` | `Cache-Control: no-store` on SPA entry paths is intentional | Changing to `no-cache` causes stale HTML replay across signed deployments and breaks the Verified Release gate — see decisions.md [2026-03-10] |
| `packages/frontend/e2e/support/mock-api.ts` | Stateful mock E2E helper intentionally disables `window.WebSocket` before navigation | Mocked suites should exercise HTTP route mocks and the explicit polling fallback path without generating Vite proxy noise; real WebSocket transport coverage belongs in `realtime-smoke.spec.ts` |
| `deploy/selfhost/Caddyfile` | Handler order is a correctness boundary | Keep `/api/*`, `/healthz`, and `/readyz` inside the proxy route before `try_files` / `file_server`, or the SPA fallback will swallow API traffic and make the local stack look healthy while realtime and health checks are broken |
| `services/selfhost-api/internal/realtime/hub.go` | Self-hosted websocket fan-out is intentionally process-local | The frontend sync client still works because it already falls back to HTTP polling, but only connections attached to the same API process receive live pushes until a future shared pubsub layer exists |
