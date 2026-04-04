> **Language**: English | [中文](./TECH_STACK.zh.md)

# ZeroLink Tech Stack

## Monorepo

pnpm workspaces with three packages: `@zerolink/frontend`, `@zerolink/backend`, `@zerolink/shared`.

`shared` is the protocol layer — constants, Zod schemas, canonical serialization, and crypto primitives are shared between frontend and backend to prevent protocol divergence (e.g. `intent_hash` mismatches).

## Frontend

| Technology | Purpose |
|---|---|
| React 18 + TypeScript (strict) | UI framework; strict mode catches crypto data type errors |
| Vite | Build tool and dev server |
| Tailwind CSS v4 + shadcn/ui | Utility CSS + Radix-based component primitives |
| Zustand | Lightweight state management |
| React Router v6 | Client-side routing |
| Zod | Runtime schema validation; defends against unexpected server responses |
| i18next | Bilingual support (en / zh) |
| MSW | Mock Service Worker for UI-layer tests only — never for protocol logic tests |

## Backend

| Technology | Purpose |
|---|---|
| Cloudflare Workers | Serverless runtime |
| Durable Objects | Serialized state per channel (version, nonce, lock, ciphertext) |
| TypeScript (strict) | Type safety across the protocol boundary |

## Cryptography

| Library | Purpose |
|---|---|
| Web Crypto API | AES-256-GCM encryption, RSA-OAEP key wrapping, SHA-256 hashing |
| `@noble/hashes` | Argon2id KDF for password-based private key wrapping |
| `@noble/ed25519` | Browser-side Ed25519 manifest signature verification |
| `@github/webauthn-json` | WebAuthn API type helpers |

## Testing

| Tool | Scope |
|---|---|
| Vitest | Unit and integration tests across all packages |
| Playwright | E2E tests including WebAuthn simulation |
| React Testing Library | Component tests |

Protocol logic tests (Canonical, lock_proof, intent_hash) must run against the real backend — MSW is not a substitute here.

## Tooling

| Tool | Purpose |
|---|---|
| Biome | Linting + formatting (replaces ESLint + Prettier) |
| Husky + lint-staged | Pre-commit: biome check on staged files + full typecheck |
| GitHub Actions | CI (pr-validate.yml) and deployment (deploy.yml, release.yml) |

## Deployment

Frontend assets are bundled with the Worker via `wrangler.toml` `[assets]` binding — not Cloudflare Pages. Production releases are triggered by pushing a `v*` tag; staging deploys on every merge to `main`.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for setup instructions and [ARCHITECTURE.md](./ARCHITECTURE.md) for system design.
