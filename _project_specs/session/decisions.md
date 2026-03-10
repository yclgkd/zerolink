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
**Context**: Need race-free channel lifecycle enforcement for sender deletion and TTL expiry without conflating receiver-local plaintext removal
**Options Considered**: Vercel serverless + Redis, AWS Lambda + DynamoDB, Cloudflare Workers + DO
**Choice**: Cloudflare Workers + Durable Objects
**Reasoning**: DO provides strong consistency within a single location; a good fit for ordered state transitions and terminal-state enforcement; global edge deployment; no separate database
**Trade-offs**: Cloudflare vendor lock-in; DO has location constraints

## [2026-03-08] Separate sender delete, receiver local burn, and channel expiry semantics

**Decision**: Treat sender delete, receiver-local plaintext burn, and TTL expiry as three distinct product concepts
**Context**: UI copy and internal guidance had drifted into read-implies-channel-burn wording even though the frontend already supported local plaintext removal without ending a delivered channel
**Options Considered**: Collapse burn into channel terminal state; keep current behavior but retain ambiguous wording; explicitly separate all three concepts
**Choice**: Explicitly separate all three concepts
**Reasoning**: This matches the existing frontend behavior, preserves re-decrypt after local plaintext removal, and makes deleted vs expired terminal states understandable on both sender and receiver pages
**Trade-offs**: Existing internal guidance and todos need terminology cleanup to avoid reintroducing the old wording

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

## [2026-03-08] Sender manage flow treats password and softkey as one password-managed path

**Decision**: The sender manage page must treat `adminMode: 'password'` and legacy `adminMode: 'softkey'` as the same password-managed flow, and public-facing protocol docs must refer to the real wire field name `adminMode`.
**Context**: Quick Share channels are created with `adminMode: 'password'`, but the sender manage UI only rendered the password input for legacy `softkey`, causing delivery and destroy actions to fail. The docs also mixed `admin_mode` with the actual API field `adminMode`.
**Options Considered**: Keep `password` separate from `softkey` in the manage UI; rename internal frontend symbols now; treat both modes identically in the UI and fix only public-facing wording/docs.
**Choice**: Treat `password` and `softkey` identically in the sender manage flow, keep internal symbol names unchanged for now, and standardize external docs on `adminMode`.
**Reasoning**: This fixes the live Quick Share regression with the smallest safe diff, preserves backward compatibility for legacy channels, and removes documentation drift without widening the refactor.
**Trade-offs**: Internal names such as `softkeyPassphrase` remain slightly legacy-biased, but they no longer leak into user-facing copy or protocol documentation.

## [2026-03-08] Deleted and expired channels must be physically purged

**Decision**: Sender destroy and TTL expiry remove the channel Durable Object state from storage, and public/decrypt reads must treat deleted or expired channels as missing resources (`404 NOT_FOUND`) instead of returning persisted terminal states.
**Context**: The backend previously persisted `deleted` and `expired` `ChannelRecord` states. That leaked internal lifecycle states through public reads, weakened the "destroy" semantics, and allowed stale state to remain in Durable Object storage after sender destroy or TTL expiry.
**Options Considered**: Keep logical terminal states and adjust frontend wording only; purge only the main record and leave auxiliary keys behind; physically purge the full channel state and collapse follow-up access to `NOT_FOUND`.
**Choice**: Physically purge the channel record plus related challenges/nonces, enforce lazy expiry purge on read, and reserve `deleted` as a frontend local-session confirmation state only.
**Reasoning**: This matches the intended destruction semantics, avoids exposing terminal-state internals over public APIs, ensures missed alarms still converge to 404 on the next read, and keeps sender UX intact without pretending the server still stores a deleted record.
**Trade-offs**: Public consumers can no longer distinguish "destroyed" from "expired" after the fact, and the frontend must manage an explicit unavailable state plus a local-only deleted confirmation branch.

## [2026-03-08] Physical delete keeps a private tombstone and wire-compat normalization

**Decision**: Physical delete and expiry must leave a private Durable Object tombstone that reserves the UUID, while frontend public-status consumers continue accepting legacy `deleted` / `expired` wire states and normalize them into the same unavailable UX as `404 NOT_FOUND`.
**Context**: The first physical-delete pass removed every storage key, which let known UUIDs be recreated, and it narrowed the public-status schema enough to mis-handle mixed-version backend responses during rollout or local testing.
**Options Considered**: Delete every key and allow UUID reuse; expose tombstones publicly as new API states; keep a private tombstone for UUID reservation and treat all terminal public inputs as unavailable.
**Choice**: Preserve only a minimal private tombstone (`uuid`, terminal reason, finalizedAt), keep public/decrypt reads on `404 NOT_FOUND`, and restore schema compatibility for legacy terminal public-status payloads without reviving old terminal UI copy.
**Reasoning**: This preserves terminal-state integrity, avoids leaking deleted-channel internals back into the public API, keeps deploy-time compatibility, and makes E2E mocks match real-worker behavior after destroy.
**Trade-offs**: Durable Objects now retain one tiny metadata record per terminal UUID, and frontend logic must distinguish local deleted confirmation from server-reported terminal compatibility payloads.

## [2026-03-08] Frontend release trust moves to a bootstrap verifier

**Decision**: Promote the frontend trust surface from a post-load manifest card to a bootstrap-first `Verified Release` flow that verifies the signed manifest and runtime asset hashes before the React app loads.
**Context**: The original `Build Manifest` card exposed a hash after the app was already running, which was developer-centric and weak against CDN/static-asset tampering. The stronger product requirement was to fail closed before sensitive UI loads and only claim `Verified Release` after a real browser-side verification pass.
**Options Considered**: Keep the existing post-load hash card; verify only the manifest signature and trust metadata; move verification into a dedicated bootstrap gate and verify the signed manifest plus same-origin runtime assets before loading the app.
**Choice**: Use a dedicated bootstrap entry, embed the Ed25519 public key in frontend code, verify `manifest.json` + `manifest.sig`, hash-check the signed runtime assets, and block app startup on failure or unavailability.
**Reasoning**: This gives the browser an actual release-verification checkpoint before the React UI is usable, makes the `Verified Release` label truthful within the Web threat model, and materially improves detection of CDN/edge/static-asset tampering. The signed manifest was also narrowed to fetchable runtime assets only, excluding Pages control files such as `_headers` and `_redirects`.
**Trade-offs**: A pure Web bootstrap verifier still cannot fully protect against an origin that can rewrite both `index.html` and the bootstrap bundle; stronger guarantees would require an external trust anchor. The verified boot path also adds startup latency and removes third-party hosted fonts from the runtime path.

## [2026-03-09] Verified Release bootstrap is explicit opt-in for signed deployments

**Decision**: The frontend must only fail closed on bootstrap when the build is explicitly marked as an official signed release, and Cloudflare Pages must serve SPA entry requests with `Cache-Control: no-store` while keeping hashed assets immutable.
**Context**: The first bootstrap verifier pass ran for every `PROD` build, which broke unsigned `pnpm build` / `vite preview` / manual static deployments because they do not ship `manifest.json` and `manifest.sig`. The first Pages `_headers` pass also only marked `/index.html` as `no-store`, leaving `/` and SPA route entries cacheable.
**Options Considered**: Keep verification on for all `PROD` builds; silently bypass verification when release artifacts are missing; require an explicit build-time flag for official signed releases and fix Pages cache rules around SPA entry HTML versus hashed assets.
**Choice**: Gate bootstrap verification behind `VITE_RELEASE_VERIFICATION_REQUIRED=true`, inject that flag only in the official Pages deploy workflow, keep unsigned environments runnable but unverified, and set Pages headers so `/*` is `no-store` while `/assets/*` first clears inherited cache headers and then sets immutable caching.
**Reasoning**: This preserves the fail-closed guarantee where it is trustworthy and intentional, restores local preview/manual deploy usability, and prevents stale HTML/bootstrap shells from surviving across deployments while still allowing aggressive caching for hashed assets.
**Trade-offs**: Manual deploys only get the `Verified Release` UX if they explicitly replicate the signed-release build flow, and the trust model remains tied to deployment discipline rather than a universal browser-side guarantee.

## [2026-03-10] Signed-release SPA entry HTML must remain no-store

**Decision**: Cloudflare Pages must serve the signed SPA entry HTML with `Cache-Control: no-store`; `no-cache` is not acceptable for the ZeroLink verified-release path.
**Context**: A Lighthouse follow-up changed the global Pages header from `no-store` to `no-cache`. After deploy, the browser-side release verifier started failing on `index.html` hash mismatches because stale HTML could be replayed briefly while `manifest.json` and hashed assets had already advanced to the new signed release.
**Options Considered**: Keep `no-cache` and weaken `index.html` verification; keep `no-cache` and tolerate transient release-guard failures; restore `no-store` for SPA entry HTML and preserve immutable caching only for hashed assets.
**Choice**: Restore `/*` to `Cache-Control: no-store`, keep `/assets/*` immutable, and lock the invariant in a regression test.
**Reasoning**: The verified-release flow assumes the bootstrap HTML and the signed manifest advance atomically from the browser's point of view. `no-store` is the simplest reliable way to prevent stale HTML replay across deploys without weakening the trust model.
**Trade-offs**: SPA entry HTML loses cache re-use and BFCache-related optimizations that depend on cacheable document responses, but release-integrity guarantees take precedence on signed builds.

## [2026-03-10] Signed manifest excludes mutable SPA entry HTML

**Decision**: Exclude `index.html` from the signed release manifest and keep browser-side verification focused on stable runtime assets.
**Context**: After the `no-store` rollback was deployed, staging still failed release verification. Browser inspection showed that Cloudflare was injecting request-specific challenge markup into the HTML response, so the bytes fetched from `/` and `/index.html` did not match the published `manifest.json` hash for `index.html` even though the hashed JS/CSS assets were healthy.
**Options Considered**: Keep signing `index.html` and continue tuning cache/platform behavior; try to normalize or ignore injected HTML before hashing; stop signing mutable HTML entry docs and verify only stable runtime assets.
**Choice**: Remove `index.html` from `manifest:generate`, update the generator tests and release-verification fixtures accordingly, and document that HTML entry docs stay outside the signed manifest boundary.
**Reasoning**: In a pure web deployment, the SPA bootstrap HTML is not a reliable byte-stable trust anchor once the edge layer can mutate responses. Signing the immutable runtime bundles still provides meaningful tamper detection for CDN/static-asset drift without blocking healthy deploys on platform-injected HTML noise.
**Trade-offs**: The manifest no longer detects bootstrap-HTML tampering directly, so trust in the entry document still depends on HTTPS/origin/deployment discipline. That limitation already existed in the web threat model; this change makes the signed boundary match reality.

## [2026-03-10] Signed release must bind the running bootstrap entry bundle

**Decision**: Keep `index.html` outside the signed hash set, but require the currently executing bootstrap entry bundle to match a signed `entryAssetPath` recorded in `manifest.json`, with one controlled reload attempt on mismatch.
**Context**: Excluding mutable HTML fixed the staging false positive, but it also removed the only binding between the signed release metadata and the bootstrap JavaScript that was already running in the browser. A stale HTML shell or stale cached entry bundle could otherwise report `Verified Release` while executing code from a different deploy.
**Options Considered**: Re-sign `index.html`; accept the weaker trust boundary and rely only on asset hashes; sign a stable entry-bundle path instead of the mutable HTML shell, then allow one recovery reload before failing closed.
**Choice**: Add `entryAssetPath` to the signed manifest, pass `import.meta.url` into browser verification, block when the running entry bundle does not match the signed manifest entry, and perform at most one session-scoped reload before rendering the blocking gate.
**Reasoning**: The entry bundle is byte-stable and already part of the hashed runtime asset set, so it is a better trust anchor than mutable edge HTML. Binding the executing bundle back to the signed manifest restores cross-release integrity without reintroducing the Cloudflare HTML mutation false positive.
**Trade-offs**: This still does not make a compromised origin trustworthy, and a first mismatch may trigger one extra page reload before the blocking screen appears. That cost is acceptable to recover stale entry shells without masking persistent integrity failures.

## [2026-03-10] CLI release verification must enforce the same entry binding

**Decision**: `pnpm manifest:verify` must reject manifests whose `entryAssetPath` metadata is missing, unsafe, or disagrees with the module entry actually referenced by `dist/index.html`.
**Context**: After browser verification started enforcing `entryAssetPath`, the CLI verifier still validated only the signature and file hashes. That allowed local and CI release checks to report success for artifacts that the browser would still fail closed at boot.
**Options Considered**: Leave the CLI looser than the browser; only validate that `entryAssetPath` exists in `manifest.files`; validate both manifest metadata and the actual `index.html` entry binding before file hashes.
**Choice**: Parse the signed manifest with `entryAssetPath` validation, then compare it to the module entry extracted from `dist/index.html` as part of `pnpm manifest:verify`.
**Reasoning**: Release validation should have a single definition of “bootable signed release.” Matching the CLI verifier to the browser verifier removes false-green deploy checks and catches broken artifacts before deployment.
**Trade-offs**: The CLI verifier is now slightly stricter and depends on `dist/index.html` being present and parseable, but that is already a required deployment artifact for Pages.

## [2026-03-10] Secure Share WebAuthn must use stored credential IDs for sender assertions

**Decision**: Secure Share sender manage/update flows must request WebAuthn assertions with `allowCredentials` derived from the channel's stored `credentialId`, and new registrations should prefer non-discoverable credentials.
**Context**: Secure Share originally created resident/discoverable credentials and sender deliver/delete flows called `navigator.credentials.get()` with only a challenge. Switching registration to non-discoverable credentials without changing the assertion path would break sender management for newly created secure channels.
**Options Considered**: Keep resident credentials; switch registration only and accept manage-flow breakage; switch registration and extend `compound_begin` to return `allowCredentials` for WebAuthn-managed channels.
**Choice**: Return `allowCredentials` from `compound_begin` when a channel is WebAuthn-managed, thread that list through frontend assertion requests, and set registration `residentKey` to `'discouraged'`.
**Reasoning**: This keeps the change minimal, preserves compatibility for existing channels with stored credential IDs, and removes the sender manage flow's reliance on browser-side credential discovery.
**Trade-offs**: The shared API contract and local mocks/tests must carry the extra optional field, and the Create page now defaults to Quick Share to avoid surprising users with a passkey-first flow.

## [2026-03-10] Manage auth policy must resolve from channel adminMode, not create-page state

**Decision**: Sender manage/deliver/delete actions must derive their auth policy from the channel's resolved `adminMode` returned by `/api/public/:uuid`, not from `create-store` `selectedProfile` or `createdProfile`.
**Context**: After Create started defaulting to Quick Share, `ManagePage` could still reuse the last create-page profile from the same SPA session. That allowed an unrelated visit to `/create` to downgrade a Secure Share management flow from `secure` to `quick`, producing weaker WebAuthn requests and possible assertion rejection on the backend.
**Options Considered**: Keep reusing create-page state; reset the create store more aggressively on navigation; derive the manage policy from the fetched channel `adminMode` and block actions until it is known.
**Choice**: Map `adminMode: 'webauthn'` to `SECURITY_PROFILE.SECURE`, map password/softkey modes to `SECURITY_PROFILE.QUICK`, and disable manage actions until `adminMode` is resolved.
**Reasoning**: The channel's persisted admin mode is the only trustworthy source for sender auth behavior on manage links. Using it removes cross-page state leakage without expanding the patch into a broader create-store refactor.
**Trade-offs**: Manage buttons stay disabled during the initial public-status fetch or after public-status failures, but that fail-closed behavior is preferable to sending the wrong auth policy.

## [2026-03-10] Signed manifest should whitelist `dist/assets/` runtime outputs

**Decision**: Generate the signed manifest from `dist/assets/` only, instead of signing arbitrary root-level files and excluding them via a blacklist.
**Context**: After `index.html` was removed from the manifest, the custom staging domain still failed release verification because Cloudflare was mutating `robots.txt` by injecting managed content directives. The actual runtime bundles under `/assets/` remained byte-identical across `pages.dev` and the custom domain, so root-document mutation had become the remaining false-positive source.
**Options Considered**: Keep adding root-document exclusions one by one; disable Cloudflare-managed mutations everywhere; whitelist only `dist/assets/` runtime outputs and keep the separate `entryAssetPath` binding to the bootstrap bundle.
**Choice**: Change `manifest:generate` so it walks `dist/assets/` only, leaves root documents such as `index.html`, `robots.txt`, icons, and sitemap-style files outside the signed hash set, and still requires `entryAssetPath` to point to one of the signed asset files.
**Reasoning**: The runtime assets under `/assets/` are the stable, hashed build outputs that actually execute in the browser and are least likely to be rewritten by the edge. Signing only that subtree gives the release guard a cleaner and more durable trust boundary while preserving protection against bundle drift or tampering.
**Trade-offs**: Root-level executable files would now be unsigned by default, so any future service worker or other high-privilege script shipped outside `/assets/` must either move under `/assets/` or be added explicitly to the signing policy.
