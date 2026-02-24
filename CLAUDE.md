# CLAUDE.md

## Skills
Read and follow these skills before writing any code:
- .claude/skills/base/SKILL.md
- .claude/skills/security/SKILL.md
- .claude/skills/typescript/SKILL.md
- .claude/skills/react-web/SKILL.md
- .claude/skills/playwright-testing/SKILL.md
- .claude/skills/session-management/SKILL.md
- .claude/skills/code-review/SKILL.md
- .claude/skills/commit-hygiene/SKILL.md

## Project Overview
ZeroLink is a zero-knowledge secret sharing tool with end-to-end encryption. Users share secrets (passwords, API keys, private messages) via single-use links. The server never sees plaintext or private keys. No accounts required.

**4-Step Protocol:**
1. **Create** — User enters secret; WebAuthn passkey optionally authenticates; `lock_secret` stored in URL fragment
2. **Lock** — RSA keypair generated; Argon2id KDF derives encryption key; AES-256-GCM encrypts the secret
3. **Deliver** — RSA-OAEP hybrid encryption wraps the symmetric key; ciphertext stored in Cloudflare KV
4. **Decrypt** — Recipient loads URL fragment; derives key; decrypts in-browser; link burns after first read

## Design

Figma Make file (React source + design system): https://www.figma.com/make/TrGpBuZS0cvhJaT9ecHrsd/UI-Design-for-ZeroLink

**This is a Figma Make file** — not a static design, but actual generated React code. Use `get_design_context` with fileKey `TrGpBuZS0cvhJaT9ecHrsd` to read source files directly via MCP.

Key resources in the Make file:
- `ZEROLINK_README.md` — product definition, user flows, design system spec
- `guidelines/Guidelines.md` — visual guidelines
- `src/styles/theme.css` — color tokens (neon-purple, neon-magenta, neon-cyan, neon-green, neon-orange)
- `src/app/pages/` — CreateChannel, UnlockAndLock, ManageAndDeliver page implementations
- `src/app/components/` — GlassCard, NeonButton, SafetyCode, PassphraseInput, SecurityProfileCard, StatusBadge

Design language: dark glassmorphism (`#0a0a0f` background), neon edge glow, Tailwind CSS v4, Radix UI primitives.

## Tech Stack
- **Language**: TypeScript (strict mode)
- **Frontend**: React 18 + Vite 5 + Zustand + React Router v6 + Zod
- **Crypto**: WebCrypto API + WebAuthn + Argon2id (`@noble/hashes`)
- **Backend**: Cloudflare Workers + Durable Objects + KV
- **Monorepo**: pnpm workspaces (`@zerolink/shared`, `@zerolink/frontend`, `@zerolink/backend`)
- **Tooling**: Biome (lint/format), Husky + lint-staged, commitlint, Changesets
- **Testing**: Vitest (unit), Playwright (E2E)

## Key Commands
```bash
# Development
pnpm dev                    # Start all packages in dev mode
pnpm --filter frontend dev  # Frontend only (Vite dev server)
pnpm --filter backend dev   # Backend only (wrangler dev)

# Quality
pnpm lint                   # Biome lint all packages
pnpm format                 # Biome format all packages
pnpm typecheck              # tsc --noEmit all packages
pnpm test                   # Vitest all packages

# Build
pnpm build                  # Build all packages
pnpm --filter backend deploy # Deploy to Cloudflare Workers

# Versioning
pnpm changeset              # Create a changeset
pnpm changeset version      # Bump versions
```

## Workspace Packages
| Package | Path | Description |
|---------|------|-------------|
| `@zerolink/shared` | `packages/shared/` | Types, Zod schemas, crypto constants |
| `@zerolink/frontend` | `packages/frontend/` | React SPA |
| `@zerolink/backend` | `packages/backend/` | Cloudflare Worker + Durable Object |

## Security Constraints
- **NEVER** log, store, or transmit plaintext secrets or private keys
- **NEVER** store secrets in React state beyond the encryption step
- All crypto operations use `window.crypto.subtle` (WebCrypto API)
- URL fragments (`#`) are never sent to the server — used for key material
- Secrets are single-use: burned on first successful decryption

## Documentation
- `docs/` - Technical documentation
- `_project_specs/` - Project specifications and todos

## Atomic Todos
All work is tracked in `_project_specs/todos/`:
- `active.md` - Current work
- `backlog.md` - Future work
- `completed.md` - Done (for reference)

Every todo must have validation criteria and test cases. See base.md skill for format.

## Session Management

### State Tracking
Maintain session state in `_project_specs/session/`:
- `current-state.md` - Live session state (update every 15-20 tool calls)
- `decisions.md` - Key architectural/implementation decisions (append-only)
- `code-landmarks.md` - Important code locations for quick reference
- `archive/` - Past session summaries

### Resuming Work
When starting a new session:
1. Read `_project_specs/session/current-state.md`
2. Check `_project_specs/todos/active.md`
3. Review recent entries in `decisions.md` if context needed
4. Continue from "Next Steps" in current-state.md

## Project-Specific Patterns

### Crypto Module Pattern
All crypto functions are pure, async, and isolated in `packages/shared/src/crypto/`:
```typescript
// Inputs: raw data (ArrayBuffer, Uint8Array, string)
// Outputs: encoded strings (base64url) or typed arrays
// NEVER accept or return plaintext secrets as strings after encryption
export async function encryptSecret(plaintext: string, key: CryptoKey): Promise<string>
export async function decryptSecret(ciphertext: string, key: CryptoKey): Promise<string>
```

### Error Handling
Use `Result<T, E>` pattern (never throw from crypto/network functions):
```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }
```

### Zod Schemas
Define all API request/response shapes in `packages/shared/src/schemas.ts`.
Frontend and backend both import from `@zerolink/shared/schemas`.
