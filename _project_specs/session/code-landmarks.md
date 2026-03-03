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
| `packages/frontend/src/main.tsx` | React app entry (to be created) |
| `packages/backend/src/index.ts` | Cloudflare Worker entry (to be created) |
| `packages/shared/src/index.ts` | Shared package exports (to be created) |

## Core Business Logic
| Location | Purpose |
|----------|---------|
| `packages/shared/src/crypto/` | All encryption/decryption (to be created) |
| `packages/backend/src/do/SecretVault.ts` | Durable Object — atomic single-use state (to be created) |
| `packages/frontend/src/stores/secretStore.ts` | Zustand store for secret flow state (to be created) |

## Configuration
| Location | Purpose |
|----------|---------|
| `tsconfig.base.json` | Root TypeScript config (strict mode) |
| `biome.json` | Lint/format config |
| `pnpm-workspace.yaml` | Monorepo workspace definition |
| `packages/backend/wrangler.toml` | Cloudflare Workers config (to be created) |
| `.changeset/config.json` | Changesets config |

## Key Patterns
| Pattern | Example Location | Notes |
|---------|-----------------|-------|
| `Result<T, E>` | `packages/shared/src/types.ts` | Never throw from crypto/network |
| Zod schemas | `packages/shared/src/schemas.ts` | Shared between frontend and backend |
| WebCrypto | `packages/shared/src/crypto/aes.ts` | Use `window.crypto.subtle` |
| Argon2id via @noble | `packages/shared/src/crypto/kdf.ts` | WebCrypto lacks Argon2 |

## Testing
| Location | Purpose |
|----------|---------|
| `packages/shared/src/**/*.test.ts` | Vitest unit tests |
| `packages/frontend/src/**/*.test.ts` | React component tests |
| `packages/backend/src/**/*.test.ts` | Worker unit tests |
| `packages/frontend/tests/` | Playwright E2E tests |

## Gotchas & Non-Obvious Behavior
| Location | Issue | Notes |
|----------|-------|-------|
| URL fragments | Never sent to server | Key material lives in `window.location.hash` |
| Durable Objects | Single-location consistency | DO must be in same region as KV for performance |
| `@noble/hashes` | Not WebCrypto | Runs synchronously; may block UI on heavy params |
| Biome | No ESLint plugins | Some rules need manual enforcement |
