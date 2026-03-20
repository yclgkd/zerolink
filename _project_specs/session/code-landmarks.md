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
| `packages/backend/src/worker.ts` | Shared Worker fetch/router implementation used by both production and staging entrypoints |
| `packages/shared/src/index.ts` | Shared package exports (types, schemas, constants, crypto) |

## Core Business Logic
| Location | Purpose |
|----------|---------|
| `packages/shared/src/crypto/` | Argon2id KDF, AES-GCM, HKDF, Ed25519 helpers |
| `packages/backend/src/do/SecretVault.ts` | Durable Object — atomic channel lifecycle state machine |
| `packages/backend/src/do/SecretVaultWebSocket.ts` | Durable Object WebSocket accept/broadcast helpers for channel state sync |
| `packages/frontend/src/crypto/orchestrator.ts` | Frontend crypto orchestration (create / lock / deliver / decrypt) |
| `packages/frontend/src/sync/` | Channel sync client: WebSocket-first subscription with `/api/public/:uuid` polling fallback |
| `packages/frontend/src/stores/` | Zustand stores: `create-store`, `decrypt-store`, `deliver-store`, `lock-store` |
| `packages/frontend/src/release/verification.ts` | Browser-side signed-manifest verifier |
| `packages/frontend/src/release/tiered-verification.ts` | Cached release verifier that revalidates signed manifest bytes before reusing trusted snapshots |
| `packages/shared/src/ws.ts` | Shared Zod schemas and types for channel sync WebSocket messages |
| `scripts/generate-manifest.ts` | Build-time manifest generator (hashes `dist/assets/`, records `entryAssetPath`, and prefers CI-injected `ZEROLINK_VERSION` over `packages/frontend/package.json`) |
| `scripts/sign-manifest.ts` | Ed25519 manifest signer (requires `MANIFEST_SIGNING_KEY` env var) |
| `scripts/verify-manifest.ts` | CLI manifest verifier — enforces entry binding + file hashes |
| `packages/frontend/e2e/happy-path.spec.ts` | Canonical end-to-end coverage for create-only share-link visibility and ManagePage sender flow |

## Configuration
| Location | Purpose |
|----------|---------|
| `tsconfig.base.json` | Root TypeScript config (strict mode) |
| `biome.json` | Lint/format config |
| `pnpm-workspace.yaml` | Monorepo workspace definition |
| `packages/frontend/public/_headers` | Cloudflare Pages cache and security headers (`no-store` for SPA entry, immutable for `/assets/*`) |
| `packages/frontend/public/_redirects` | SPA catch-all redirect (`/* /index.html 200`) |
| `.github/workflows/pr-validate.yml` | PR CI gates: typecheck, unit tests, frontend build, mocked Playwright E2E, realtime WebSocket smoke E2E, and manifest-verification E2E on `pull_request` / `merge_group` |
| `.github/workflows/release-please.yml` | Automated release workflow — updates root `version.txt` / `CHANGELOG.md`, opens Release PRs on `main`, and creates `v*` tags + GitHub Releases with `RELEASE_PLEASE_TOKEN` |
| `packages/backend/wrangler.toml` | Cloudflare Workers + Durable Objects config; both envs now bind to `SecretVaultV2`, while historical migration entries preserve the prior namespace cutovers |
| `packages/backend/.env.e2e` | Test-only Wrangler env source for local realtime smoke E2E; provides non-secret RP and commit-token values without dashboard secrets |
| `.github/workflows/deploy.yml` | Post-merge CI/CD: typecheck, unit tests, mocked E2E, realtime WebSocket smoke E2E, verification E2E, resolve `ZEROLINK_VERSION`, frontend build, manifest generate/sign/verify, then Worker deploy |
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
| `packages/frontend/src/__tests__/helpers/orchestrator-fixtures.ts` | Shared frontend crypto test helpers — defaults orchestrator tests to fast Argon2id params and provides seeded immutable decrypt fixtures for heavy flows |
| `packages/backend/src/**/__tests__/` | Worker + Durable Object unit tests |
| `packages/frontend/e2e/` | Playwright E2E: happy-path, mocked realtime fallback/cross-device coverage, realtime WebSocket smoke, expiration, rate-limit, fragment cleanup, manifest-verification |
| `packages/frontend/playwright.config.ts` | Regular Playwright suite using a single non-verification build/server |
| `packages/frontend/playwright.realtime.config.ts` | Realtime smoke Playwright suite that starts frontend preview plus local `wrangler dev` with test-only env vars |
| `packages/frontend/playwright.verification.config.ts` | Manifest-verification-only Playwright suite using the verification-enabled build/server |
| `scripts/__tests__/` | Vitest unit tests for build scripts (manifest generation/verification) |

## Gotchas & Non-Obvious Behavior
| Location | Issue | Notes |
|----------|-------|-------|
| URL fragments | Never sent to server | Key material lives in `window.location.hash` |
| Durable Objects | Single-location consistency | DO must be in same region as KV for performance |
| `@noble/hashes` | Not WebCrypto | Runs synchronously; may block UI on heavy params |
| `packages/frontend/src/__tests__/helpers/orchestrator-fixtures.ts` | `createOrchestrator()` defaults to fast KDF params in tests | Opt out with `{ useFastKdf: false }` when a frontend smoke test must exercise production-strength Argon2id defaults |
| Biome | No ESLint plugins | Some rules need manual enforcement |
| `packages/frontend/src/crypto/webauthn.ts` | `useLiteralKeys` Biome errors | Cannot auto-fix; TypeScript `noPropertyAccessFromIndexSignature` requires bracket notation in this file — do not touch |
| `packages/frontend/src/release/verification.ts` | Verified Release covers only `dist/assets/*` | Root documents (`index.html`, `robots.txt`) are excluded from the signed manifest because Cloudflare can mutate edge responses; the executing bootstrap entry must still match `manifest.entryAssetPath` |
| `packages/frontend/src/release/tiered-verification.ts` | Cached release trust still revalidates `manifest.json` + `manifest.sig` | `manifest-hash.txt` is an unsigned helper and may only be used as a freshness hint before deciding whether to run full verification |
| `packages/backend/src/do/SecretVault.ts` | `/ws` upgrades require an active channel record and top-level redaction | Missing or terminal channels must fail the WebSocket upgrade so dead links do not keep idle Durable Object sockets alive, and unexpected `fetch()`-level `/ws` failures must still flow through `mapError()` with handler `ws_subscribe` |
| `packages/backend/src/do/SecretVaultHttp.ts` | Production observability intentionally omits raw exception text | `mapError()` keeps staging stacks/messages for debugging, but production emits only a structured error name + handler + fingerprint payload; `stack_fingerprint` is based on a normalized handler + error-name + frame signature, not raw stack text or bundle offsets; use `APP_ENV` from `packages/backend/wrangler.toml`, not hostnames, to reason about log detail |
| `packages/frontend/public/_headers` | `Cache-Control: no-store` on `/*` is intentional | Changing to `no-cache` causes stale HTML replay across signed deployments and breaks the Verified Release gate — see decisions.md [2026-03-10] |
| `packages/frontend/e2e/support/mock-api.ts` | Stateful mock E2E helper intentionally disables `window.WebSocket` before navigation | Mocked suites should exercise HTTP route mocks and the explicit polling fallback path without generating Vite proxy noise; real WebSocket transport coverage belongs in `realtime-smoke.spec.ts` |
