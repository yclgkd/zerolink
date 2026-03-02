<!--
LOG DECISIONS WHEN:
- Choosing between architectural approaches
- Selecting libraries or tools
- Making security-related choices
- Deviating from standard patterns

This is append-only. Never delete entries.
-->

# Decision Log

## [2026-02-24] Use pnpm workspaces monorepo

**Decision**: Single pnpm monorepo with 3 packages
**Context**: Need to share types/schemas between frontend and backend without duplication
**Options Considered**: Separate repos, npm workspaces, Turborepo, Nx
**Choice**: pnpm workspaces (flat, no build orchestration layer)
**Reasoning**: Simplest setup; ZeroLink is small enough that Turborepo/Nx overhead not warranted; pnpm's strict mode prevents phantom dependencies
**Trade-offs**: No incremental builds (acceptable at current scale)

## [2026-02-24] Use Biome instead of ESLint+Prettier

**Decision**: Biome for linting and formatting
**Context**: Project spec mandated Biome from the start
**Options Considered**: ESLint+Prettier (industry standard), Rome (deprecated), Biome
**Choice**: Biome
**Reasoning**: Single tool, faster, already configured in repo
**Trade-offs**: Fewer community plugins vs ESLint; some rules not yet available

## [2026-02-24] Use @noble/hashes for Argon2id

**Decision**: `@noble/hashes` library for Argon2id KDF
**Context**: WebCrypto API does not support Argon2id natively (only PBKDF2 and HKDF)
**Options Considered**: PBKDF2 (WebCrypto), bcrypt.js, argon2-browser, @noble/hashes
**Choice**: `@noble/hashes`
**Reasoning**: Audited library; pure JS; no WASM complications; maintained by Paulmillr
**Trade-offs**: Larger bundle than PBKDF2 (pure WebCrypto); @noble/hashes is worth the security

## [2026-03-02] Graded Atomic Project Specs Update Rule

**Decision**: Refine the "Atomic Update Rule" to differentiate between AI Agents and External Contributors.
**Rationale**: To maintain project context without discouraging open-source contributions. AI agents have the strict duty to sync specs, while human contributors are exempt to reduce friction. Core maintainers (or AI in subsequent sessions) will bridge the gap for community PRs.
**Mechanism**: 
1. **AI Agents**: Mandatory synchronization in every PR.
2. **External Contributors**: Recommended but NOT required.
3. **Post-Merge**: AI will automatically sync the `_project_specs` after community code is merged.
**Status**: Updated in `CLAUDE.md`.

## [2026-03-02] Atomic Project Specs Update Rule

**Decision**: Enforce an "Atomic Update Rule" where every code change must include a corresponding update to `_project_specs/`.
**Rationale**: The `_project_specs` directory was becoming outdated (stale context), leading to AI assistants losing track of project progress and architectural decisions. Versioning these files alongside code ensures the project's "external brain" is always accurate.
**Mechanism**: 
1. Every `feat` or `fix` commit must bundle updates to `current-state.md` and `active.md/completed.md`.
2. PR templates and AI instructions (`CLAUDE.md`) will enforce this.
**Status**: Implemented in `CLAUDE.md`. Enforced from PR #83 onwards.

## [2026-03-02] Cloudflare Durable Objects Pricing Update

**Decision**: Support Cloudflare Durable Objects Free Tier with SQLite backend.
**Rationale**: Cloudflare introduced a free tier for Durable Objects (100k requests/day) specifically for the SQLite storage backend. This significantly lowers the barrier to entry for self-hosting ZeroLink.
**Status**: Implemented in docs and README. PR #82 merged.

## [2026-02-24] Cloudflare Workers + Durable Objects for backend

**Decision**: Cloudflare Workers for API, Durable Objects for atomic state
**Context**: Need single-use (burn-after-read) guarantee with no race conditions
**Options Considered**: Vercel serverless + Redis, AWS Lambda + DynamoDB, Cloudflare Workers + DO
**Choice**: Cloudflare Workers + Durable Objects
**Reasoning**: DO provides strong consistency within a single location; perfect for single-use enforcement; global edge deployment; no separate database
**Trade-offs**: Cloudflare vendor lock-in; DO has location constraints

## [2026-02-24] URL fragment for key material

**Decision**: Store lock_secret/decryption key in URL fragment (#)
**Context**: Need to share key with recipient without server ever seeing it
**Options Considered**: Query params (server-visible), fragment (#, browser-only), out-of-band channel
**Choice**: URL fragment
**Reasoning**: Browsers never send fragments to servers (HTTP spec); recipient copies entire URL; zero-knowledge guarantee
**Trade-offs**: Entire link must be shared intact; no server-side logging of key material (intentional)
