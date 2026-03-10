# Completed

Done items for reference. Move here from active.md when complete.

---

## DONE-018: Remove broken rate-limiter binding and add worker.fetch top-level catch

**Completed**: 2026-03-10

The `[[rate_limiting]]` binding in `wrangler.toml` required a paid Cloudflare Workers plan
and was never actually provisioned (namespace_id values were placeholders). The backend was also
never successfully deployed via CI until PR #126 fixed the dead `pnpm --filter backend build` step,
so the misconfiguration was hidden. On first real deploy, `env.RATE_LIMITER.limit()` threw an
unhandled exception that propagated to `worker.fetch` with no top-level catch, causing Cloudflare
error 1101 "Worker threw exception" on every API request.

Fixed by:
- Removing `checkRateLimit` function and all rate-limiting code from `index.ts`
- Removing `RATE_LIMITER` from the `Env` interface
- Removing `[[rate_limiting]]` and `[[env.staging.rate_limiting]]` from `wrangler.toml`
- Adding top-level try/catch to `worker.fetch` as defense-in-depth against future unhandled throws
- Deleting the now-obsolete rate-limit unit tests from `index.test.ts`

Rate limiting at the network layer continues to be handled by Cloudflare's built-in DDoS
protection. The free WAF rate-limiting rule slot is already in use for image endpoints.

## DONE-015: Whitelist `dist/assets/` for signed manifest generation

**Completed**: 2026-03-10

Followed up the custom-domain staging failure after confirming Cloudflare was mutating
root-level documents such as `robots.txt` while leaving the hashed runtime bundles unchanged.
Changed `manifest:generate` from a root-level blacklist to an `assets/` whitelist so the signed
manifest now covers only stable runtime build outputs under `dist/assets/`, while `entryAssetPath`
must still point at one of those signed asset files. Updated the generator tests, verification and
deployment docs, and `_project_specs` notes to reflect the narrower and more durable trust
boundary.

## DONE-014: Align CLI manifest verification with signed entry binding

**Completed**: 2026-03-10

Followed up the browser-side `entryAssetPath` trust-boundary change by teaching
`pnpm manifest:verify` to enforce the same manifest shape and entry-bundle binding. The CLI
verifier now rejects manifests with missing or unsafe `entryAssetPath` metadata, checks that
`dist/index.html` launches the exact signed entry asset before hashing files, and includes focused
regression coverage for metadata validation and stale-entry mismatches so local and CI release
checks cannot go green for a build the browser would fail closed.

## DONE-013: Bind the running bootstrap entry bundle to the signed manifest

**Completed**: 2026-03-10

Followed up the mutable-HTML manifest change by restoring an explicit trust anchor between the
browser's running bootstrap code and the signed release metadata. Added `entryAssetPath` to
`manifest.json`, made browser verification require that the currently executing entry bundle matches
that signed path, and introduced a one-time session-scoped reload to recover from stale HTML or
stale entry-bundle caches before showing the blocking verification gate. Also split the release
verification/bootstrap helpers into smaller modules and updated the unit tests, docs, and
`_project_specs` notes to describe the narrower but better-bound trust boundary.

## DONE-012: Exclude mutable SPA entry HTML from the signed manifest

**Completed**: 2026-03-10

Followed up the `no-store` cache-header rollback after staging still showed `Release Verification
Failed`. Browser inspection revealed Cloudflare was mutating the HTML bootstrap shell per request,
so `index.html` was not a stable signing target. Updated `scripts/generate-manifest.ts` to exclude
`index.html`, tightened the manifest-generation regression tests, aligned the browser-side
release-verification fixture with the new manifest shape, and updated the verification/deployment
docs plus `_project_specs` to reflect that only stable runtime assets remain inside the signed
manifest boundary.

## DONE-011: Restore no-store on signed SPA entry HTML

**Completed**: 2026-03-10

Rolled back the Cloudflare Pages SPA entry cache policy from `no-cache` to `no-store` after the
deployed Verified Release gate started failing on `index.html` hash mismatches. Added a regression
test in `packages/frontend/src/__tests__/pages-headers.test.ts` so signed deployments keep
`/*` as `no-store` while `/assets/*` remains immutable. Verified the hotfix with the targeted
Pages-header test, release-verification unit tests, a production frontend build, and local
manifest generation. Full `manifest:verify` remains dependent on the deployment-only
`MANIFEST_SIGNING_KEY`.

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

## DONE-017: Original backlog items 101–107, 110

**Completed**: across 2026-02-24 – 2026-03-10

Tracks closure of the original project backlog that predates the DONE-XXX numbering scheme:
- **TODO-101** (full create flow) — implemented in Phase 4; Quick Share + Secure Share UI/API
- **TODO-102** (secret decryption flow) — implemented in Phase 4; decrypt store + orchestrator
- **TODO-103** (WebAuthn passkey integration) — implemented in Phase 2/3; `@github/webauthn-json`
- **TODO-105** (TTL and expiry) — see DONE-004; Durable Object alarm + lazy expiry
- **TODO-106** (rate limiting) — backend route-level rate limiting; E2E coverage in DONE-009
- **TODO-107** (E2E Playwright tests) — see DONE-009; full happy-path + failure-mode specs
- **TODO-110** (production deployment) — see DONE-010; CI/CD pipeline + `deploy.yml`

---

## DONE-016: Lighthouse accessibility, SEO, and performance fixes

**Completed**: 2026-03-10

Added `robots.txt`, `<meta name="description">`, fixed primary button color contrast
(`#a855f7` → `#9333ea`, WCAG AA), corrected heading order in manifest-info card (h3 → h2),
added security response headers (CSP, HSTS 2y+preload, COOP, X-Frame-Options, Referrer-Policy),
replaced non-composited `transition-all` with `transition-[opacity,transform]` on buttons and
profile cards, and added test assertions for all new security headers.
Closes original TODO-108 (accessibility audit) and TODO-109 (performance optimization).

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
