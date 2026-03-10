# Completed

Done items for reference. Move here from active.md when complete.

---

## DONE-009: E2E coverage for expiration, rate-limit, and manifest verification

**Completed**: 2026-03-10

Added `expiration.spec.ts`, `rate-limit.spec.ts`, and `manifest-verification.spec.ts` to cover
the three previously untested failure paths: 404/NOT_FOUND channel state (expiration), 429
rate-limit responses on both share and manage pages, and the verification-gate failure modes
(manifest unavailable, signature unavailable, signature invalid). Updated `playwright.config.ts`
with a `verification-gate` project that builds with `VITE_RELEASE_VERIFICATION_REQUIRED=true`
and serves on port 4174. Also fixed the share-page 429 silent-fail bug: non-ok, non-404 responses
now surface a `share-public-status-error` notice instead of silently falling back to WAITING state.

---

## DONE-010: Automated signed manifest in CI

**Completed**: 2026-03-08

Added manifest generation and Ed25519 signing steps to `.github/workflows/deploy.yml`. Every
official Pages deploy now runs: `pnpm build` → `pnpm manifest:generate` → `pnpm manifest:sign`
(using `MANIFEST_SIGNING_KEY` secret) → `pnpm manifest:verify`, and uploads `manifest.json` and
`manifest.sig` alongside the built assets.

---

## DONE-001: Monorepo initialization

**Completed**: 2026-02-24

Set up pnpm monorepo with 3 packages (`@zerolink/shared`, `@zerolink/frontend`, `@zerolink/backend`).
Configured Biome, Husky + lint-staged, commitlint (Conventional Commits), Changesets.
Installed 226 packages. Git hooks activated. Changesets initialized.

## DONE-002: Claude project structure

**Completed**: 2026-02-24

Created CLAUDE.md, `.claude/skills/` with 7 skills (base, security, typescript, react-web,
playwright-testing, session-management, code-review), and `_project_specs/` directory tree.

## DONE-003: Multi-agent instruction structure

**Completed**: 2026-03-03

Replaced the long root `CLAUDE.md` with short agent routers, added `AGENTS.md`, `GEMINI.md`,
and a shared `.ai/` guidance layer, copied `.claude/skills/` to `.agents/skills/` as a
compatibility directory, migrated branch naming to `<type>/<short-name>`, and codified the
branch-plus-PR workflow plus neutral wording policy for AI-authored changes.

## DONE-004: Physical delete semantics for channel destroy/expiry

**Completed**: 2026-03-08

Changed sender destroy and TTL expiry from logical terminal-state persistence to real physical
purge of Durable Object channel state, including the main `ChannelRecord`, creation/compound/lock
challenges, nonce records, nonce indexes, and scheduled alarms. Public status and decrypt-fetch
now return `404 NOT_FOUND` after purge, frontend manage/share flows render an unavailable state on
revisit, and sender-side `deleted` remains a current-session-only confirmation UI state.

## DONE-005: Tombstone reservation and legacy terminal-state compatibility

**Completed**: 2026-03-08

Followed up the physical-delete change by retaining a private terminal tombstone to reserve
destroyed/expired UUIDs, restoring public-status schema compatibility for legacy `deleted` and
`expired` payloads, normalizing those legacy states to the same unavailable UX as `404 NOT_FOUND`,
and tightening the Playwright stateful API mock so deleted channels no longer get recreated by
lock/manage begin routes.

## DONE-006: Verified Release bootstrap gate

**Completed**: 2026-03-08

Replaced the post-load `Build Manifest` card with a bootstrap-first `Verified Release` flow.
The frontend now embeds the manifest signing public key, verifies the signed manifest plus the
same-origin runtime asset hashes before loading React, renders a fail-closed blocking screen when
verification is not trusted, removes third-party hosted fonts from the verified runtime path, and
updates the trust card to expose verified build metadata only after a successful boot snapshot.

## DONE-007: Trust page clarity and return-path fix

**Completed**: 2026-03-09

Expanded the frontend Trust Model page from four generic cards into six focused cards that
accurately describe which secrets never reach the server, which protocol metadata is stored at each
channel stage, what remains on sender and receiver devices, how physical delete plus tombstone
reservation differs from local burn and TTL expiry, and what `Verified Release` does and does not
guarantee when the indicator is actually present. Also replaced the trust-page shell self-link with
`Back to Create`, carried explicit in-app return markers into trust-page links, and made the
trust-page `Back` action return only to known in-app entries instead of guessing from browser
history.

## DONE-008: Receiver lock-flow wording clarification

**Completed**: 2026-03-09

Clarified the receiver-side share flow so the page now explicitly says the sender created the
channel first, the receiver is setting their own passphrase on the shared-link page, and the lock
actions/next steps are receiver-specific. Added `SharePage` tests to prevent the sender/receiver
responsibility wording from drifting back into an ambiguous flow.
