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

## Entry Points
| Location | Purpose |
|----------|---------|
| `packages/frontend/src/bootstrap-entry.ts` | Frontend bootstrap verifier entry; loads the app only after release verification |
| `packages/frontend/src/main.tsx` | React app renderer invoked by the bootstrap entry after verification |
| `packages/backend/src/index.ts` | Cloudflare Worker entry — routes all API requests |
| `packages/shared/src/index.ts` | Shared package exports (types, schemas, constants, crypto) |

## Core Business Logic
| Location | Purpose |
|----------|---------|
| `packages/shared/src/crypto/` | Argon2id KDF, AES-GCM, HKDF, Ed25519 helpers |
| `packages/backend/src/do/SecretVault.ts` | Durable Object — atomic channel lifecycle state machine |
| `packages/frontend/src/crypto/orchestrator.ts` | Frontend crypto orchestration (create / lock / deliver / decrypt) |
| `packages/frontend/src/stores/` | Zustand stores: `create-store`, `decrypt-store`, `deliver-store`, `lock-store` |
| `packages/frontend/src/release/verification.ts` | Browser-side signed-manifest verifier |
| `scripts/generate-manifest.ts` | Build-time manifest generator (hashes `dist/assets/` + records `entryAssetPath`) |
| `scripts/sign-manifest.ts` | Ed25519 manifest signer (requires `MANIFEST_SIGNING_KEY` env var) |
| `scripts/verify-manifest.ts` | CLI manifest verifier — enforces entry binding + file hashes |

## Configuration
| Location | Purpose |
|----------|---------|
| `tsconfig.base.json` | Root TypeScript config (strict mode) |
| `biome.json` | Lint/format config |
| `pnpm-workspace.yaml` | Monorepo workspace definition |
| `packages/frontend/public/_headers` | Cloudflare Pages cache and security headers (`no-store` for SPA entry, immutable for `/assets/*`) |
| `packages/frontend/public/_redirects` | SPA catch-all redirect (`/* /index.html 200`) |
| `packages/backend/wrangler.toml` | Cloudflare Workers + Durable Objects config (no `[[rate_limiting]]` — requires paid plan, removed in favour of Cloudflare WAF DDoS protection) |
| `.github/workflows/deploy.yml` | CI/CD: test → deploy Worker → build → generate/sign/verify manifest → deploy Pages |
| `.changeset/config.json` | Changesets config |

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
| `packages/backend/src/**/__tests__/` | Worker + Durable Object unit tests |
| `packages/frontend/e2e/` | Playwright E2E: happy-path, expiration, rate-limit, manifest-verification |
| `scripts/__tests__/` | Vitest unit tests for build scripts (manifest generation/verification) |

## Gotchas & Non-Obvious Behavior
| Location | Issue | Notes |
|----------|-------|-------|
| URL fragments | Never sent to server | Key material lives in `window.location.hash` |
| Durable Objects | Single-location consistency | DO must be in same region as KV for performance |
| `@noble/hashes` | Not WebCrypto | Runs synchronously; may block UI on heavy params |
| Biome | No ESLint plugins | Some rules need manual enforcement |
| `packages/frontend/src/crypto/webauthn.ts` | `useLiteralKeys` Biome errors | Cannot auto-fix; TypeScript `noPropertyAccessFromIndexSignature` requires bracket notation in this file — do not touch |
| `packages/frontend/src/release/verification.ts` | Verified Release covers only `dist/assets/*` | Root documents (`index.html`, `robots.txt`) are excluded from the signed manifest because Cloudflare can mutate edge responses; the executing bootstrap entry must still match `manifest.entryAssetPath` |
| `packages/frontend/public/_headers` | `Cache-Control: no-store` on `/*` is intentional | Changing to `no-cache` causes stale HTML replay across signed deployments and breaks the Verified Release gate — see decisions.md [2026-03-10] |
