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

## [2026-03-03] Adopt shared `.ai/` guidance and neutral AI workflow rules

**Decision**: Use short root entrypoints (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) plus a shared `.ai/` guidance layer, add `.agents/skills/` as a compatibility copy of `.claude/skills/`, require branch-and-PR-only AI changes, and standardize branch names to `<type>/<short-name>` without task IDs.
**Context**: The repo now needs to support multiple agents without duplicating long instructions, leaking tool branding, or keeping task IDs in branch names.
**Options Considered**: Keep a single long `CLAUDE.md`; keep tool-specific guidance under `.claude/`; continue using `task/<task-id>-<short-name>`; add tool-branded branch names.
**Choice**: Shared guidance in `.ai/`, compatibility skills in `.agents/skills/`, branch names based on Conventional Commit types, task tracking via issues/PRs, and neutral wording across repo artifacts.
**Reasoning**: This keeps shared guidance tool-neutral, reduces token overhead, aligns branch names with repo commit semantics, and avoids exposing tool authorship in shipped artifacts.
**Trade-offs**: `.agents/skills/` may drift from `.claude/skills/`, so copied skills are treated as compatibility assets rather than the canonical workflow source.

## [2026-03-03] Separate agent-neutral shared skills from Claude-local execution skills

**Decision**: Treat `.agents/skills/` as the agent-neutral shared skills layer, treat `.claude/skills/` as the Claude-local execution layer, and restore explicit `.claude/skills/*` loading in `CLAUDE.md`.
**Context**: The first multi-agent instruction refactor left Claude-only commands in `.agents/skills/` and removed the explicit Claude skill entrypoint, which broke the new shared-skill contract and weakened the Claude-local workflow.
**Options Considered**: Keep `.agents/skills/` as a byte-for-byte copy of `.claude/skills/`; mark `.agents/skills/` as compatibility-only and stop advertising it as shared; split shared and Claude-local responsibilities explicitly.
**Choice**: Shared skills stay agent-neutral, Claude-specific automation remains local to `.claude/skills/`, and `CLAUDE.md` continues to load Claude-local mandatory skills explicitly.
**Reasoning**: This preserves the multi-agent guidance layer without pretending Claude-only commands are portable, while keeping the original Claude workflow guarantees intact.
**Trade-offs**: The shared and Claude-local skill directories can now diverge intentionally, so future changes must update the correct layer instead of assuming one copy fits every agent.

## [2026-03-08] Replace 3-mode security with Quick Share + Secure Share

**Decision**: Replace Standard / Strict / Hardware-Only security profiles with two user-facing entry points: Quick Share (password) and Secure Share (passkey).
**Context**: The 3-profile design was technically correct but UX-confusing. Hardware-Only's x5c attestation enforcement was broken in practice. The "compatibility mode" for Standard profile was a hidden degraded path that confused users.
**Options Considered**:
1. Keep 3 profiles, improve docs/UX
2. Merge to 2 profiles, deprecate Hardware-Only
3. Keep 1 WebAuthn-only profile (block non-WebAuthn users)
**Choice**: Option 2 — two clear profiles
**Reasoning**:
- Quick Share is a legitimate secure option (Argon2id-derived keys), not a degraded fallback
- Secure Share = merged Standard+Strict (UV=required, RK=required)
- Hardware-Only attestation enforcement (x5c) was technically broken and complex to fix
- Legacy profiles (standard/strict/hardware_only) kept for backward-compatible reads
**Implementation**:
- New `SECURITY_PROFILE.QUICK` and `SECURITY_PROFILE.SECURE` constants
- `admin_mode: 'password'` replaces `'softkey'` as canonical name for Quick Share
- Backend treats `'password' || 'softkey'` identically for compound commits
- Hardware-only enforcement removed from backend (attestation: 'none' always)
- All 5 profile values remain valid in schemas for backward compatibility
**Trade-offs**: Legacy channels with hardware_only profile lose the cross-platform authenticator restriction and attestation enforcement (was already broken in practice)

## [2026-03-03] Follow-up fixes must stay on the existing open PR branch

**Decision**: When the current branch already maps to an open PR and the task is addressing that PR's review, comments, or follow-up regressions, continue on that branch instead of creating a new branch and PR.
**Context**: A review-driven fix was mistakenly moved to a child branch with a second PR, even though the work belonged on PR85.
**Options Considered**: Always create a fresh branch for every change; use stacked PRs for all follow-up fixes; continue on the existing PR branch unless a stacked PR is explicitly requested.
**Choice**: Keep review-driven fixes on the existing open PR branch by default, and only split them into a new PR when the user explicitly asks for stacked PRs.
**Reasoning**: This keeps the review conversation, diff, and fixes in one place and avoids redundant PR churn.
**Trade-offs**: Agents must do a quick branch/PR check before applying the generic "new branch for every change" rule.
