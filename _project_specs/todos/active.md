# Active Todos

Current work in progress. Each todo follows the atomic todo format from base.md skill.

---

## TODO-001: Scaffold shared package types and schemas

**Status**: pending
**Priority**: P0 (blocking everything else)

**Description**: Implement the foundational types and Zod schemas in `@zerolink/shared` that both frontend and backend will use.

**Files to create/modify**:
- `packages/shared/src/types.ts` — TypeScript interfaces and types
- `packages/shared/src/schemas.ts` — Zod validation schemas
- `packages/shared/src/constants.ts` — Crypto parameters and app constants
- `packages/shared/src/index.ts` — Public re-exports

**Validation criteria**:
- [ ] `pnpm --filter shared typecheck` passes
- [ ] `pnpm --filter shared test` passes (unit tests for schema validation)
- [ ] All exports are accessible via `@zerolink/shared`, `@zerolink/shared/types`, etc.

**Test cases**:
- Schema rejects invalid secret payloads (too long, missing fields)
- Schema rejects expired TTL values
- Types correctly model the 4-step protocol state machine

---

## TODO-002: Implement frontend app shell

**Status**: pending
**Priority**: P1 (depends on TODO-001)

**Description**: Set up React app entry point with routing and global state store.

**Files to create**:
- `packages/frontend/src/main.tsx` — React entry point
- `packages/frontend/src/App.tsx` — Root component with router
- `packages/frontend/src/routes/` — Route components (Create, Lock, Decrypt)
- `packages/frontend/src/stores/secretStore.ts` — Zustand store for secret flow state

**Validation criteria**:
- [ ] `pnpm --filter frontend build` succeeds with no TypeScript errors
- [ ] Vite dev server starts without errors
- [ ] React Router routes render correct placeholder pages

---

## TODO-003: Implement Cloudflare Worker entry point

**Status**: pending
**Priority**: P1 (depends on TODO-001)

**Description**: Create the Worker handler with routing and the Durable Object class skeleton.

**Files to create**:
- `packages/backend/src/index.ts` — Worker entry point
- `packages/backend/src/do/SecretVault.ts` — Durable Object class
- `packages/backend/wrangler.toml` — Cloudflare Workers config

**Validation criteria**:
- [ ] `pnpm --filter backend typecheck` passes
- [ ] `wrangler dev` starts without errors
- [ ] `POST /api/secrets` and `GET /api/secrets/:id` routes are stubbed

---

## TODO-004: Implement crypto primitives in shared

**Status**: pending
**Priority**: P1 (depends on TODO-001)

**Description**: Implement all cryptographic operations using WebCrypto API.

**Files to create**:
- `packages/shared/src/crypto/aes.ts` — AES-256-GCM encrypt/decrypt
- `packages/shared/src/crypto/rsa.ts` — RSA-OAEP key generation and wrap/unwrap
- `packages/shared/src/crypto/kdf.ts` — Argon2id key derivation
- `packages/shared/src/crypto/index.ts` — Public crypto exports

**Validation criteria**:
- [ ] Round-trip tests: encrypt then decrypt returns original plaintext
- [ ] Key derivation is deterministic for same input
- [ ] 100% test coverage (security-critical code)
- [ ] No plaintext in any intermediate state after encryption
