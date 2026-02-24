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
