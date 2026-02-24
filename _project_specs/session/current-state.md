<!--
CHECKPOINT RULES (from session-management.md):
- Quick update: After any todo completion
- Full checkpoint: After ~20 tool calls or decisions
- Archive: End of session or major feature complete
-->

# Current Session State

*Last updated: 2026-02-24*

## Active Task
Completing monorepo initialization and Claude project structure setup.

## Current Status
- **Phase**: planning → implementing
- **Progress**: Infrastructure complete; ready to start writing source code
- **Blocking Issues**: None

## Context Summary
ZeroLink monorepo is fully initialized with pnpm workspaces (3 packages), Biome, Husky, commitlint,
and Changesets. Claude project structure created (CLAUDE.md, skills, specs). The packages contain
only empty placeholder `.ts` files — no source code written yet. Next step is implementing the
shared package foundations (types, schemas, constants, crypto).

## Files Being Modified
| File | Status | Notes |
|------|--------|-------|
| `packages/shared/src/types.ts` | pending | Next target |
| `packages/shared/src/schemas.ts` | pending | Needs Zod |
| `packages/shared/src/constants.ts` | pending | Crypto params |
| `packages/shared/src/index.ts` | pending | Re-exports |

## Next Steps
1. [ ] Implement `packages/shared/src/types.ts` — Result type, SecretPayload, CryptoConfig
2. [ ] Implement `packages/shared/src/constants.ts` — Argon2id params, AES key size, TTL options
3. [ ] Implement `packages/shared/src/schemas.ts` — Zod schemas for API shapes
4. [ ] Implement `packages/shared/src/index.ts` — Public exports
5. [ ] Create `packages/backend/wrangler.toml` — Cloudflare Workers config
6. [ ] Scaffold `packages/frontend/src/main.tsx` and `App.tsx`

## Key Context to Preserve
- URL fragment (`#`) is NEVER sent to server — it carries key material
- All crypto is browser-side using `window.crypto.subtle`
- `@noble/hashes` used for Argon2id (not WebCrypto, which lacks Argon2)
- Single-use enforcement via Durable Object atomic transactions
- Biome replaces ESLint+Prettier — use `pnpm lint` and `pnpm format`

## Resume Instructions
To continue this work:
1. Read this file and `_project_specs/todos/active.md`
2. Start with TODO-001: implement `packages/shared/src/` files
3. Run `pnpm --filter shared typecheck` to validate after each file
