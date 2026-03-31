<!--
LOG DECISIONS WHEN:
- Choosing between architectural approaches
- Selecting libraries or tools
- Making security-related choices
- Deviating from standard patterns

This is append-only. Never delete entries.
-->

# Decision Log

Entries are kept newest-first by heading date. When adding a historical backfill, insert it by date instead of appending it to the bottom.
When later implementation or doc cleanup supersedes a historical claim, annotate the original entry with a dated follow-up instead of silently assuming readers know it is outdated.

## [2026-03-30] Freeze the self-hosted backend contract before starting the Go port

**Decision**: Add an explicit self-hosted backend contract document plus versioned cross-runtime fixtures that lock the current protocol-facing behavior before any Go implementation begins.
**Context**: The self-hosted backend track replaces a Cloudflare Worker + Durable Object implementation whose correctness depends on exact protocol outputs, not just route names. The largest migration risk is silent drift in canonical JSON, `intentHash`, AAD bytes, lock/compound challenge derivation, WebSocket message shapes, and frontend-visible error semantics.
**Options Considered**: Start implementing the Go service and rely on the existing TypeScript code as an informal reference; freeze only the HTTP route list and leave crypto helpers implicit; document the contract and back it with reusable fixtures that both TypeScript and Go can consume.
**Choice**: Introduce `docs/SELF_HOSTED_CONTRACT.md`, `docs/SELF_HOSTED_CONTRACT.zh.md`, and `protocol-fixtures/selfhost-contract-v1.json`, then verify those fixtures from both `packages/shared` and `packages/frontend` tests.
**Reasoning**: The Go port will otherwise re-implement protocol behavior across package boundaries with no single machine-checkable baseline. Freezing both the route/error contract and the exact-match byte surfaces creates a stable handoff for M1/M2 while keeping frontend behavior unchanged.
**Trade-offs**: Fixture maintenance now becomes part of any protocol change, and the current contract intentionally leaves backend-internal policy details such as exact rate-limit windows and commit-cookie replacement strategy unresolved until later milestones.
**Follow-up (2026-03-30, milestone handoff)**: M1 and M2 must treat `protocol-fixtures/selfhost-contract-v1.json` as the first cross-runtime compatibility asset. If a Go helper cannot reproduce a locked fixture exactly, the implementation is wrong unless the contract doc and fixtures are updated together in a separate contract-change PR.
**Follow-up (2026-03-31, review fixes)**: The frozen error matrix now explicitly includes the shipped `decrypt_fetch` read-path error `CHANNEL_NOT_DELIVERED`. Chinese mirrors for contract-freeze docs must also carry accurate `synced-with` markers so bilingual maintenance stays diff-based instead of heuristic.
**Follow-up (2026-03-31, contract precision)**: The contract matrix now states that commit-cookie caller binding can be established on `lock_begin` and `compound_begin`, then cleared or rotated on commit routes. The shared `SelfHostContractFixture` type is also exposed through an explicit package subpath so cross-package tests stop relying on repo-local path aliasing.

## [2026-03-30] Second-round frontend polish keeps safety flows intact while removing neon residue

**Decision**: Finish the calm security-tool retune by replacing the last neon-styled shared surfaces with muted semantic colors, adding a compact `SafetyCode` density for sender/receiver terminal states, and promoting small explanatory copy to stable reading sizes where it affects comprehension.
**Context**: The first PR199 pass fixed the route hierarchy and the biggest UX errors, but review still found residual cyber-dark cues in shared shell/card/badge/notice surfaces and overly tall verification blocks on mobile `locked` / `delivered` states.
**Options Considered**: Leave the remaining styling as-is and ship; redesign the pages again around a new mobile-specific layout; keep the current architecture and tighten the shared visual language plus the verification component density.
**Choice**: Reuse the existing route/component structure, retune shared visual primitives in place, and let `SafetyCode` expose a compact density that can be applied selectively in `manage` and `share` terminal-state flows without changing the verification order.
**Reasoning**: This removes the remaining style drift and improves mobile execution speed without weakening the security model. Users still see verification before sensitive actions; they just see a denser, calmer version of the same information.
**Trade-offs**: Shared components now carry slightly more styling nuance, and some compact controls trade visual spaciousness for faster access to the main action on smaller screens.
**Follow-up (2026-03-30, create layout alignment)**: On desktop create flow, align the right-hand trust/how-it-works column with the first actionable card row instead of the page-level section heading. This keeps the auxiliary column visually subordinate to the sender’s primary task and removes the impression that the two columns are snapped to different grids.
**Follow-up (2026-03-30, create final polish)**: Cap the create-page intro line length, give the desktop reference rail a clearer sidebar identity, and replace the repeated footer description with a shorter action-oriented hint so the CTA area reads like the end of a form instead of another explanatory block.
**Follow-up (2026-03-30, create flow sidebar semantics)**: Expand the create-page reference rail from four abbreviated sender-side steps to six explicit end-to-end steps: create, share, lock, verify, deliver, decrypt. The rail keeps the compact sidebar format, but its title now matches the actual full journey instead of skipping the receiver lock and decrypt stages.
**Follow-up (2026-03-30, zh flow copy refinement)**: Shorten the Chinese create-page flow labels to more direct user-facing language: use `密码` instead of `密码短语` in the sidebar copy, describe step 5 as delivering `密文` rather than `加密密钥`, and simplify the verify/decrypt wording so the six-step rail scans faster without changing the underlying security semantics.
**Follow-up (2026-03-30, create CTA hint)**: Replace the static create-page footer sentence with a state-aware CTA hint. The footer now tells the sender what is missing in Quick Share (`enter a valid channel password`) or, once the form is ready, summarizes the exact channel about to be created (`mode + TTL`) instead of repeating a generic intro sentence.
**Follow-up (2026-03-30, global polish pass)**: Finish the all-pages polish by normalizing create/share header alignment, enlarging shell/manifest/share/manage secondary control hit areas, aligning Share UUID styling with Manage, and making Trust/Manage footer actions stack to full-width buttons on mobile. These are visual/interaction refinements only; channel semantics stay unchanged.

## [2026-03-30] Recenter the core frontend on calm, security-tool UX

**Decision**: Rework the four core frontend routes (`create`, `share`, `manage`, `trust`) toward a calmer, more operational security-tool presentation, and add same-session share-link recovery for sender waiting state only.
**Context**: The previous frontend passed baseline accessibility checks, but the product still leaned on neon cyber-dark styling, dense card grids, and secondary information appearing before the user’s main task. The sharpest UX gaps were on create-first-run cognitive load, share delivered-state task order, and sender recall when the one-time receiver link was lost while the channel was still waiting.
**Options Considered**: Keep the existing visual language and only tweak copy; redesign the entire app shell and flows around a new design system; keep the existing component structure but retune layout hierarchy, typography, and token intensity around a professional security-tool baseline.
**Choice**: Keep the existing route/component architecture, but change the information order, typography, and surface styling across the four core pages. Supportive trust/how-it-works content now sits behind the primary task on create; delivered-share prioritizes decrypt before Safety Code; trust content becomes a scan-friendly ordered list; and manage can re-copy the one-time receiver link only when that link still exists in browser `sessionStorage` for the same session and the channel remains in `waiting`.
**Reasoning**: This resolves the highest-friction UX issues without reopening protocol or backend scope. Using session-scoped recovery instead of durable storage preserves the zero-knowledge posture better than a long-lived cross-tab cache while still covering the common “same tab / same browser session” sender recovery path.
**Trade-offs**: Same-session recovery does not help when the sender opens the manage link in a different browser session or after the tab session ends. Some older component tests had to be updated because the visual token values and manage-link navigation expectations changed intentionally.
**Follow-up (2026-03-30, docs cleanup)**: Remove the root `.impeccable.md` helper file. The durable design baseline for this UI direction lives in the decision log and project guidance, not in a repo-root tool-specific document.
**Follow-up (2026-03-30, local artifacts)**: Ignore `output/playwright/` as a local UI-audit screenshot scratch path. These images are transient review artifacts, not source assets or committed test fixtures.
**Follow-up (2026-03-30, recovery TTL alignment)**: The sender-side share-link recovery cache now stores the selected channel TTL with each entry and expires against that per-entry TTL instead of a fixed one-hour cap, so same-session recovery stays aligned with the actual waiting window of 1 hour, 24 hours, or 7 days.
**Follow-up (2026-03-30, browser chrome polish)**: Align the inline SVG favicon in `packages/frontend/index.html` with the calmer primary token so the browser tab icon no longer retains the old neon-purple accent after the UI palette shift.
**Follow-up (2026-03-30, e2e copy sync)**: The happy-path Playwright assertion now checks the same-session recovery wording on the create success warning (`shown once`, `Manage can re-copy while waiting`, `create a new channel if lost outside that window`) instead of the older pre-recovery sentence claiming the link is unrecoverable after leaving the page.

## [2026-03-30] Final UI polish favors bounded reading width

**Decision**: Apply a final cross-page polish pass that normalizes page-header line lengths, keeps Share/Manage state panels within bounded reading widths, enlarges shell warning dismiss targets, and tightens the Trust page into a clearer long-form reference layout.
**Rationale**: After the broader UI refresh, the remaining roughness was mostly micro-level inconsistency rather than structural problems. The app feels more intentional when descriptive copy stays on a stable measure, utility chrome meets touch expectations, and state-heavy flows do not stretch across the full card width.
**Status**: Implemented in PR #199 follow-up polish commits.
**Follow-up**: Passphrase fields now use a slightly looser label-to-input gap, and the label is block-level so shared vertical spacing utilities actually affect the rendered form stack. The create-page TTL preset cards also expose a visible `peer-focus-visible` ring so keyboard users can see when the selected radio has focus.

## [2026-03-30] Use hybrid passphrase strength scoring

**Decision**: Score frontend passphrase strength with a hybrid heuristic that rewards both long multi-word passphrases and long mixed-character passwords, while applying explicit penalties for repeated characters, repeated words, and a small set of common weak patterns.
**Context**: The first passphrase-strength update over-indexed on word-count and length, which caused strong 16-character mixed passwords to remain only medium strength in the UI.
**Options Considered**: Keep the passphrase-first heuristic; switch to hard complexity requirements; keep submission policy simple and make the strength meter recognize both password styles.
**Choice**: Keep the submission policy unchanged (`12-128`, ordinary spaces only) and upgrade only the strength meter to a hybrid scoring model.
**Reasoning**: This preserves the product decision to avoid hard composition rules while aligning the UI with user expectations for both passphrases and traditional complex passwords.
**Trade-offs**: The heuristic remains simpler than a dedicated estimator like zxcvbn, so it will not catch every weak password pattern; the small built-in weak-pattern list must be maintained deliberately.

## [2026-03-29] Raise Quick Share passphrase policy to 12+ chars with phrase-friendly whitespace rules

**Decision**: Replace the shared 8-character passphrase minimum with a single frontend policy for Quick Share create, receiver lock, sender manage, and receiver decrypt: minimum 12 characters, maximum 128, allow ordinary spaces between words, trim leading/trailing ordinary spaces, and reject tabs, line breaks, NBSP/full-width/special whitespace.
**Context**: The product currently positions Quick Share as a legitimate security mode, but the old `min=8` rule still encouraged password-style shortcuts and the strength meter rewarded symbol/digit composition over memorable multi-word passphrases. Product direction now prefers phrase-style secrets that users can realistically enter correctly across devices without adding brittle character-class requirements.
**Options Considered**: Keep the 8-character minimum; raise the minimum and also require digit/letter/symbol classes; tie the minimum length to channel TTL; adopt a longer minimum plus phrase-style guidance without composition rules.
**Choice**: Use one static policy across all passphrase entry points: `12 <= length <= 128`, allow only ordinary spaces as separators, and surface "Use 4+ random words or 12+ characters" in the create and receiver-lock setup UI. Do not add legacy-compatibility branches because the product has not launched and there is no real-user data to preserve.
**Reasoning**: This raises the floor meaningfully above trivial 8-character passwords, keeps the rule easy to explain, supports memorable word-based passphrases, and avoids the predictable weak patterns that composition requirements often create.
**Trade-offs**: Existing local test fixtures and any prelaunch developer-created links that relied on the old 8-character policy must be recreated. Error handling now needs to distinguish missing, too-short, too-long, and invalid-whitespace inputs instead of collapsing everything into a single minimum-length message.

## [2026-03-29] Expose channel TTL as create-time presets

**Decision**: Let senders choose the channel TTL at create time using three presets: 1 hour, 24 hours, or 7 days
**Context**: The protocol and record model already carried TTL and explicit expiry support, but the create flow hard-coded every new channel to 1 hour and the UI/documentation treated that as a fixed product rule
**Options Considered**: Keep 1 hour fixed; add free-form custom expiry; add a small preset list
**Choice**: Add a create-time preset selector, keep 1 hour as the default, and preserve backward compatibility by defaulting omitted API TTL input to 1 hour
**Reasoning**: This unlocks common async and cross-timezone handoff cases without adding calendar UI complexity or weakening the short-lived-secret product posture
**Trade-offs**: Trust and success-state copy can no longer describe expiry as a single global duration, and longer-lived channels slightly extend the window in which undeleted ciphertext remains retrievable
**Follow-up (2026-03-29, PR197 review)**: Split `CreatePage` into focused create-page modules so the route component no longer carries the full flow implementation, switched the TTL preset selector to `radiogroup`/`radio` semantics for better a11y, made `getChannelTtlLabel()` use an exhaustive TTL check, and replaced shared-schema TTL millisecond literals in tests with `CHANNEL_TTL_MS` constants.

## [2026-03-24] Align secure WebAuthn semantics and default validation coverage with the two-profile product

**Decision**: Treat `secure` as "passkey required + UV required + attestation context checked" rather than "attestation provenance must be cryptographically verified", preserve explicit `expireAt` overrides on delivered records, and move root script checks plus verification Playwright coverage into the default validation paths.
**Context**: The current two-profile product already documents `secure` as `attestation: "none"`, but backend `commitCreate()` still rejected `verified: false` attestation results, which made the live create flow internally contradictory. Separately, `UpdateIntent.expireAt` was signed and transmitted but discarded on commit, and the default `pnpm test` / `pnpm typecheck` / PR / deploy paths still missed root script coverage and browser-level verification gating.
**Options Considered**: Reintroduce stricter attestation modes for `secure`; keep the contradiction and rely on hand-waved test fixtures; preserve `expireAt` only in detached proof metadata; continue to keep verification/root-script coverage on opt-in commands only.
**Choice**: Keep `attestation: "none"` as the product contract, accept unverified `fmt:"none"` registrations so long as RP/origin/challenge/UV checks pass, write `intent.expireAt` back into `record.expiresAt` when present, extend root validation to cover `scripts/` and root Vitest config, and run verification Playwright coverage in default local, PR, and deploy paths.
**Reasoning**: This matches the actual shipped two-profile design, removes a self-inflicted registration failure mode, restores end-to-end semantics for signed update intents, and closes the most important validation gaps without reintroducing the legacy multi-profile complexity that was already removed.
**Trade-offs**: `secure` no longer implies hardware provenance attestation; it is now explicitly "user-verified passkey" security. CI becomes slower because verification Playwright now runs in PR and deploy workflows, but the extra runtime is justified because the release gate is security-sensitive.
**Follow-up (2026-03-24, CI budget)**: Verification Playwright remains in the default local command and PR validation workflow, but it is intentionally removed from `.github/workflows/deploy.yml`. The deploy pipeline keeps manifest generate/sign/verify plus staging smoke so release coverage stays meaningful without spending recurring post-merge/tag minutes on an extra browser suite.
**Follow-up (2026-03-24, PR195 review)**: The `fmt:"none"` exception is intentionally narrow. `secure` may accept unverified `fmt:"none"` registrations after RP/origin/challenge/UV checks, but unverifiable `packed` attestations must still be rejected. Also, `.github/workflows/deploy.yml` keeps the staging-only `playwright install` step because the post-deploy smoke test still needs a browser bundle even after verification E2E was removed from deploy.

## [2026-03-23] Remove stale create-flow UI residue without touching protocol compatibility

**Decision**: Delete the unused `security-profile-card` UI, remove create-store compatibility-confirm state, default create-store to Quick Share, and drop the unused `PassphraseInput.strictMode` warning path.
**Context**: The Quick Share / Secure Share product split was already live, but the frontend still carried dead create-flow artifacts from the old Standard / Strict / Hardware-Only era. Those leftovers were no longer referenced by production UI and were creating misleading test coverage around removed UX concepts.
**Options Considered**: Leave the residue in place; remove only the dead component file; clean the full frontend residue set while preserving shared/backend compatibility code.
**Choice**: Clean the dead frontend-only residue and test drift, but keep shared schemas, constants, and backend policy mappings for legacy profile compatibility.
**Reasoning**: This keeps the change small and safe: it reduces dead code and stale state in the active UI without breaking old channel reads or protocol compatibility guarantees.
**Trade-offs**: Direct compatibility coverage now stays concentrated in orchestrator/shared/backend tests rather than in unused create-page UI components.
**Follow-up (2026-03-24)**: PR193 removes the remaining legacy `standard` / `strict` / `hardware_only` compatibility layer across shared schemas, backend policy handling, frontend mappings, and docs. The repository now treats `quick` and `secure` as the only supported security profiles because the product has not launched and backward compatibility is no longer required.
**Follow-up (2026-03-24, README sync)**: Root README and README.zh now use the same two-mode product copy so the top-level project description no longer implies any retained legacy profile path.

## [2026-03-23] Keep `pnpm setup` as the manual deploy secret bootstrap helper

**Decision**: Retain the root `pnpm setup` helper instead of deleting it, and keep its prompts/output aligned with the documented manual Cloudflare deployment flow.
**Context**: After removing the broken deploy-button path, the repository still needs a concrete way to bootstrap `COMMIT_TOKEN_SECRET`, `RP_ID`, and `RP_ORIGIN` for Worker environments. The existing `scripts/setup-cloudflare.ts` remains the only automated path for that work, but some prompt text had drifted behind the updated docs.
**Choice**: Keep `pnpm setup`, continue to use it in the manual deploy guide, and refresh its environment labels and next-step output so production and staging instructions match the current documented commands.
**Reasoning**: The script still removes repetitive secret-management work and reduces deployer mistakes. Deleting it would push users back to fully manual secret setup without replacing the functionality.
**Trade-offs**: The repository keeps a small deploy-helper script that must stay in sync with docs whenever the manual deployment flow changes.

## [2026-03-23] Cloudflare docs now document manual deploy only for the main repo

**Decision**: Remove the public one-click Cloudflare deploy path from the main repository docs and document only the manual Cloudflare Workers deployment flow here.
**Context**: The repository is a pnpm monorepo with the Worker config under `packages/backend/`, frontend assets under `packages/frontend/`, and maintainer-specific example routes committed in `wrangler.toml`. The previous one-click wording implied a generic deploy-button flow that the main repo does not safely support.
**Choice**: Remove one-click deploy references from `README*` and deployment indexes, rewrite `docs/DEPLOYMENT*.md` around manual deployment only, require deployers to choose their final origin before setting WebAuthn secrets, and replace maintainer-specific verification / troubleshooting examples with environment-appropriate commands and placeholders.
**Reasoning**: A broken or maintainer-specific deploy button is worse than no button. The main repository should document the path that contributors and self-hosters can actually execute today without guessing around routes, origins, or worker names.
**Trade-offs**: The repository no longer advertises a zero-click trial path. If a true deploy-button experience is desired later, it should ship as a separate isolated template rather than by stretching the main monorepo config.

## [2026-03-21] Bilingual documentation: English primary, Chinese .zh.md suffix

**Decision**: Adopt suffix-based bilingual documentation with English as the authoritative version and Chinese as a tracked translation.
**Context**: All existing docs were written in Chinese. The project needs English docs for wider audience and international collaboration, while preserving the existing Chinese content.
**Options Considered**: Separate `docs/en/` and `docs/zh/` directories; suffix-based (`*.md` = English, `*.zh.md` = Chinese); single-language English only.
**Choice**: Suffix-based naming — `FILE.md` is English (primary), `FILE.zh.md` is Chinese. Each file has a language navigation header. Chinese files include `<!-- synced-with: <commit-hash> -->` to track sync status against the English version.
**Reasoning**: Suffix-based keeps related files adjacent in the filesystem, avoids deep directory nesting, and makes `git diff <hash>..HEAD -- docs/X.md` easy for checking what changed since last sync. English as primary aligns with the project's international goals while preserving existing Chinese content.
**Trade-offs**: Chinese versions may lag behind English; maintainers need to update sync hashes when translating. Cross-references within each language must point to the correct suffix variant.

## [2026-03-20] Optimize CI to reduce billable minutes: tiered pipeline

**Decision**: Consolidate PR validation from 6 parallel jobs into 1 serial job, remove all test jobs from the deploy workflow, and move E2E suites to a dedicated nightly/manual workflow.
**Context**: GitHub Actions free tier (2000 min/month) was fully consumed. Each PR triggered 6 jobs (~30 min), and each merge to main triggered another 6 jobs (~30 min) with identical tests, totaling ~60 billable minutes per PR lifecycle.
**Options Considered**: Keep current setup and pay for more minutes; remove only E2E from PR but keep parallel jobs; full tiered optimization with job consolidation.
**Choice**: Full tiered optimization — PR runs typecheck + unit + build in a single job (~7 min); deploy workflow only builds and deploys (~5 min); E2E runs nightly via schedule and on-demand via workflow_dispatch.
**Reasoning**: Each parallel job carried ~2 min of redundant setup overhead (checkout + install). Consolidating eliminates 5 setup cycles. Tests on main are post-mortem (cannot prevent bad merges) so they are pure waste. E2E coverage is preserved via nightly runs and pre-release manual triggers.
**Trade-offs**: E2E regressions detected within 24 hours instead of per-PR. Branch protection required checks must be updated from 6 job names to the single `PR Quality` check.

## [2026-03-20] Adopt Release Please with root version.txt and explicit releasable commit guidance

**Decision**: Add a dedicated Release Please workflow using the root-level `simple` strategy (`version.txt` + `CHANGELOG.md`) and require a PAT or GitHub App token in `RELEASE_PLEASE_TOKEN`. Keep production deploys tag-driven and document that releasable security changes must use `fix(security): ...` or `feat(security): ...` instead of bare `security:`.
**Context**: ZeroLink already deploys production from `v*` tags, but release creation was still manual. The repository also intentionally allows a custom `security:` Conventional Commit type, while Release Please's default releasable-unit logic centers on `feat`, `fix`, and `deps`.
**Options Considered**: Continue manual tagging and changelog management; use a heavier manifest-based Release Please setup; adopt the single-app `simple` flow with `version.txt`, root `CHANGELOG.md`, and explicit commit wording guidance for releasable security fixes.
**Choice**: Add `.github/workflows/release-please.yml`, bootstrap `version.txt` at `0.2.0`, start `CHANGELOG.md` from the first automated release after `v0.2.0`, ignore `version.txt` in deploy workflow path filters to avoid duplicate staging deploys, and document the new commit guidance in both developer docs and `.ai/workflows.md`.
**Reasoning**: The `simple` strategy keeps release metadata minimal for a single-app repository, preserves the existing `v*` deploy contract, and avoids reusing `package.json` as a release source. Requiring a non-default token ensures Release Please-generated PRs and tags still trigger downstream CI and deployment workflows.
**Trade-offs**: Historical changelog entries before automation are not backfilled into `CHANGELOG.md`. Bare `security:` commits remain valid but no longer imply a release, so contributors must use scoped `fix(security)` / `feat(security)` when release automation matters.
**Follow-up (2026-03-20)**: The upstream `googleapis/release-please-action@v4` still declares `runs: node20`, which now emits GitHub's Node 20 deprecation warning. ZeroLink keeps the commit-pinned official action anyway to avoid replacing it with a runtime npm install under a write-scoped release token, and only adds an explicit preflight failure message when `RELEASE_PLEASE_TOKEN` is missing.

## [2026-03-20] CI-injected release version is the source of truth for signed frontend manifests

**Decision**: Treat git release tags as the authoritative production version and inject a normalized `ZEROLINK_VERSION` into the deploy workflow for all signed builds. `scripts/generate-manifest.ts` now prefers that environment variable and falls back to `packages/frontend/package.json` only for local or otherwise non-injected runs.
**Context**: Production deploys were already triggered by `v*` tags, but the signed frontend manifest still read `packages/frontend/package.json`, which allowed the `Verified Release` UI and release metadata to drift from the actual deployed tag. The repository root package already used `0.0.0` as a workspace-only placeholder, so package metadata was not a reliable release source.
**Options Considered**: Keep `package.json` as the release truth and manually bump it before tagging; mutate `package.json` inside CI before each deploy; inject a workflow-scoped release version and let manifest generation consume it without rewriting repo files.
**Choice**: Inject `ZEROLINK_VERSION` in `.github/workflows/deploy.yml`, deriving `vX.Y.Z -> X.Y.Z` for production tags and `0.0.0-dev+<short_sha>` for staging pushes to `main`.
**Reasoning**: This aligns signed release metadata with the actual deploy trigger, keeps staging builds traceable, avoids repository churn from CI-edited `package.json`, and preserves local developer workflows through an explicit fallback path.
**Trade-offs**: Local/manual signed builds must set `ZEROLINK_VERSION` explicitly if they need release metadata that differs from `packages/frontend/package.json`. The workspace package versions remain in the repository and can still be mistaken for release versions if readers ignore the CI contract.
**Follow-up (2026-03-20)**: Manual signed-release docs must show `ZEROLINK_VERSION` overrides together with `VITE_RELEASE_VERIFICATION_REQUIRED=true`; overriding only the manifest version is not sufficient to produce a verified release shell.

## [2026-03-19] Split mocked realtime fallback E2E from real WebSocket smoke coverage

**Decision**: Keep mocked Playwright coverage focused on HTTP route mocks plus one explicit polling-fallback scenario, and add a separate realtime smoke suite that starts local `wrangler dev` to exercise actual `/api/ws/:uuid` updates.
**Context**: After the Workers Assets migration added a Vite `/api/ws -> localhost:8787` proxy, the regular E2E suite began logging repeated `[vite] ws proxy error` noise whenever mocked tests opened SharePage or ManagePage. Those tests intentionally had no WebSocket backend and only needed fallback or state assertions, while the repo still lacked any end-to-end proof that browser WebSocket subscriptions worked against the real Worker.
**Options Considered**: Leave the mocked suite noisy and accept Vite proxy errors as expected output; replace all fallback tests with real backend coverage; split responsibilities so mock tests disable `window.WebSocket` and a small realtime smoke suite verifies the actual transport.
**Choice**: Disable `window.WebSocket` in mocked E2E helpers before navigation, keep one polling-fallback test plus deterministic cross-device state coverage there, and add a dedicated Playwright config + CI job for two local-Wrangler realtime smoke tests (lock propagation and deliver propagation).
**Reasoning**: This preserves fast, deterministic mock coverage for error states and fallback semantics while restoring clear test logs. A separate smoke suite gives direct confidence in the WebSocket path without forcing every mocked scenario to provision a backend.
**Trade-offs**: Local default `pnpm test:e2e` now runs two suites instead of one, and CI has one additional E2E job. The realtime smoke suite needs a committed non-secret Wrangler env source so it can run without dashboard secrets.
**Follow-up (2026-03-19)**: The realtime Playwright config must not reuse an already-running developer backend. It now forces a fresh `wrangler dev --env-file .env.e2e` launch on a dedicated local port and points the frontend preview proxy at that port, so local runs cannot silently bind to a developer's unrelated backend state or environment.

## [2026-03-19] Keep unit-test crypto fidelity by injecting fast KDF params instead of mocking KDF

**Decision**: Speed up frontend/shared crypto unit tests by adding optional internal Argon2id parameter overrides to the shared KDF helpers and threading those overrides through frontend orchestrator dependencies, while keeping runtime defaults on the production-strength constants.
**Context**: After CI dependency/browser caching landed, the remaining unit-test bottleneck was real crypto work. `packages/shared/src/crypto/__tests__/kdf.test.ts` still spent ~53 s locally and `packages/frontend/src/__tests__/crypto-orchestrator-decrypt-anchored.test.ts` spent ~61 s, largely because many branch tests re-ran full-strength Argon2id wrapping before asserting error handling.
**Options Considered**: Mock the KDF entirely in tests; move full-strength crypto coverage into a separate slow suite; keep the real algorithm path but inject cheaper test-only parameters and preserve a few default-parameter smoke cases.
**Choice**: Add optional `kdfParams` plumbing for internal callers only, default it to the existing production values, and have test helpers opt into a fixed fast Argon2id config. Keep a small number of full-strength smoke tests inside the normal unit suite so PR validation still exercises the real defaults.
**Reasoning**: This keeps the unit tests on the true crypto implementation path, avoids broad module mocks, and preserves confidence that the runtime default configuration still works. The fast-parameter path removes repeated Argon2 cost from branch/error tests without changing product behavior.
**Trade-offs**: The shared/frontend crypto helpers now carry a small amount of internal-only injection surface. Tests that need production-strength coverage must explicitly opt out of the fast helper defaults.
**Follow-up (2026-03-19)**: Frontend smoke tests now explicitly assert the wrapped-key Argon2 metadata when `useFastKdf: false` so the helper default can stay fast without silently weakening the remaining production-parameter coverage.

## [2026-03-19] Reuse immutable decrypt fixtures instead of repeating full create-lock-deliver setup per case

**Decision**: Refactor the heaviest decrypt tests to build immutable base artifacts once, then seed fresh storage/orchestrator instances per case from cloned envelopes and payloads.
**Context**: Anchored and general decrypt tests repeatedly executed the full `create -> lock -> deliver` path even when the case under test only changed replay metadata, delivery proofs, or fetch payload shape. That duplicated expensive crypto and IndexedDB setup across every case.
**Options Considered**: Keep each test fully end-to-end and accept the runtime; share one live fixture object across cases; prepare immutable base artifacts once and clone only the mutable pieces into fresh per-test instances.
**Choice**: Add fixture builders that compute the heavy crypto path once and return immutable artifacts (`cipherBundle`, `deliveryAuth`, `ReceiverKeyEnvelope`, fingerprints). Each test then seeds a new storage instance from cloned envelope data and mutates only its local payload/storage copies.
**Reasoning**: This preserves test isolation while removing duplicate heavy work. Reusing live state would risk case coupling through shared IndexedDB contents or Zustand state, while immutable artifact cloning keeps the tests deterministic and cheap.
**Trade-offs**: The test helper module is larger and more structured than before. Future tests should prefer the seeded-fixture pattern rather than reintroducing ad hoc full-flow setup in every `it(...)`.

## [2026-03-19] Split verification E2E from the main Playwright suite and cache CI dependencies

**Decision**: Enable lockfile-based pnpm caching in GitHub Actions, cache Playwright browser downloads in E2E jobs, and move `manifest-verification.spec.ts` onto its own Playwright config and CI job.
**Context**: The PR and deploy workflows reinstalled dependencies in every job with package-manager caching disabled, the E2E jobs redownloaded Chromium each run, and the main Playwright config always paid for both the regular build and the verification build even though only one spec exercised the verification gate.
**Choice**: Switch every workflow job to `actions/setup-node` cache mode for pnpm with `pnpm-lock.yaml` as the dependency key, add `actions/cache` around a fixed Playwright browser directory, introduce `build:e2e` and `build:verification:e2e` scripts that skip `tsc`, keep the existing typed build scripts for formal build validation, and create a dedicated `playwright.verification.config.ts` plus standalone CI jobs for verification-only E2E coverage.
**Reasoning**: Caching dependencies and browser binaries is the highest-confidence CI speed win with minimal risk. Splitting the verification spec preserves the real compile-time release-verification behavior while removing the second build/server startup from the default E2E path. Keeping Playwright `workers` and `fullyParallel` unchanged avoids introducing new flake modes in the same change.
**Trade-offs**: CI now has one additional job to surface verification failures independently, and browser caches can be invalidated by lockfile changes even when Playwright itself is unchanged. The workflows still perform per-job installs instead of artifact reuse; this change optimizes setup cost without changing job isolation.
**Follow-up (2026-03-19)**: `actions/setup-node` cache mode resolves the selected package manager binary before later shell steps run, so pnpm must be installed before `setup-node` when using `cache: "pnpm"`. The workflows now bootstrap pnpm via `pnpm/action-setup` and drop the later Corepack-only step to keep cache initialization deterministic.
**Follow-up (2026-03-19)**: Playwright's CI guidance does not recommend caching browser binaries on Linux because cache restore time is comparable to a fresh download and the required OS dependencies are not cacheable. The workflows now drop the shared browser cache entirely and keep `playwright install --with-deps chromium`, which removes cache save contention between the two E2E jobs and aligns the pipeline with Playwright's documented GitHub Actions path.

## [2026-03-17] Migrate to Workers Assets unified deployment

**Decision**: Replace dual-deployment (Cloudflare Pages for frontend + standalone Cloudflare Worker for backend) with Workers Assets, serving the React SPA as static assets directly from the Worker via a single `wrangler deploy`.
**Context**: The previous architecture required two separate deployment steps and a hidden Worker Routes configuration in the Cloudflare Dashboard to proxy `/api/*` from the Pages domain to the Worker. New deployers had no way to discover this implicit dependency from the repository alone, making the "one-click deploy" story incomplete.
**Choice**: Add `[assets] directory = "../frontend/dist"` with `run_worker_first = true` and `not_found_handling = "single-page-application"` to `wrangler.toml`. The Worker handles `/api/*` itself; all other requests are delegated to `env.ASSETS.fetch(request)`. Security headers previously managed by Cloudflare Pages' `_headers` file are now applied in a new `security-headers.ts` Worker module wrapping every ASSETS response. The CI/CD deploy job is consolidated from two sequential jobs into one. Custom domain routes (`zerolink.dev*`, `staging.zerolink.dev*`) are declared in `wrangler.toml`.
**Reasoning**: `run_worker_first = true` is required to allow the Worker to inject security headers (CSP, HSTS, X-Frame-Options, etc.) onto every asset response—without it the Worker never sees asset requests and `_headers` behavior cannot be replicated. Per Cloudflare's official pricing documentation, requests served from the Workers Assets bucket are free and unlimited regardless of plan, so there is no billing regression vs. Pages.
**Trade-offs**: `run_worker_first = true` means every request, including static asset fetches, passes through the Worker JS before being handed off to the asset binding. This adds a small amount of per-request CPU but remains within the 10 ms free-tier CPU budget for the trivial header-injection code path. The Cloudflare Pages project can be retired after verifying the Worker-served deployment on the custom domains.

## [2026-03-16] Release guard fallback verifier must ship inside the trusted bootstrap

**Decision**: Keep the `@noble/ed25519` fallback verifier in the trusted bootstrap bundle instead of loading it via a pre-verification dynamic import.
**Context**: The first Ed25519 fallback implementation lazy-loaded noble from `release/crypto.ts`. In production builds, Vite emitted a separate JS chunk for that code, and unsupported browsers had to fetch and execute it before the signed manifest had been verified.
**Choice**: Move the noble call behind a thin local adapter that is statically imported by `release/crypto.ts`, and add a build-level regression test that inspects the verification build output to ensure the bootstrap entry keeps only the existing app/main and mock-worker dynamic imports.
**Reasoning**: The release guard exists specifically to verify code before the app mounts. Allowing an additional verifier chunk to execute beforehand enlarged the trusted computing base on exactly the compatibility path the fallback was meant to protect.
**Trade-offs**: The bootstrap bundle grows modestly on all verification-enabled builds because noble is now always present, but that cost is acceptable compared with weakening the pre-verification trust boundary.

## [2026-03-16] Native Ed25519 runtime failures pin the current session to JS fallback

**Decision**: Treat native Ed25519 runtime exceptions as implementation unavailability, immediately retry with the JS fallback, and keep the current page session on fallback afterward.
**Context**: The first fallback implementation probed native Ed25519 once, but if a later `importKey()` or `verify()` call threw after a successful probe it normalized the exception to `false`, which `verifyRelease()` exposed as `signature_invalid`.
**Choice**: Cache verifier mode as `'native' | 'fallback'` instead of a boolean capability flag, downgrade the mode to `'fallback'` on any native runtime exception, retry the current verification through noble, and only surface `signature_invalid` when a verifier explicitly returns `false`.
**Reasoning**: This preserves the original security semantics: invalid signatures remain distinct from unavailable verification implementations, and flaky browser-native Ed25519 support does not permanently block startup if the JS verifier still works.
**Trade-offs**: A browser that throws once on the native path will keep using noble for the rest of the page session, even if later native calls might have succeeded.

## [2026-03-16] Ed25519 pure-JS fallback via @noble/ed25519

**Decision**: Add `@noble/ed25519` as a lazily-loaded fallback verifier when native WebCrypto Ed25519 is unavailable.
**Context**: `verifyManifestSignature` in `release/crypto.ts` previously depended solely on `crypto.subtle.importKey('spki', …, { name: 'Ed25519' })`. Firefox < 130 and Safari < 17 do not support this algorithm, causing startup verification to return `crypto_unavailable` and blocking the app entirely on those browsers.
**Choice**: Probe native Ed25519 support once via `importKey` using the actual SPKI bytes from the first call, memoize the result, and fall back to `@noble/ed25519 verifyAsync` when the probe fails. The raw 32-byte public key is extracted from SPKI using `spkiToRawEd25519` (validates the fixed 12-byte OID header). Malformed-input errors (wrong sig/key length) are normalized to `return false` via pre-validation. Import errors for the noble module propagate so that callers still surface `crypto_unavailable`.
**Reasoning**: Probe-then-choose is more explicit than per-call try/catch and avoids misclassifying transient errors as compatibility failures. Lazy-loading noble avoids bundle size cost on browsers that support native Ed25519 (Chrome 113+, Firefox 130+, Safari 17+). Both the `signature-only` (tiered) and `full` verification paths share the same `verifyManifestSignature` entry point, so both benefit without additional changes.
**Trade-offs**: Noble v3 uses `crypto.subtle.digest('SHA-512')` by default; in a genuine non-secure HTTP context where `crypto.subtle` is undefined, both the native and noble paths fail → `crypto_unavailable`. This is acceptable because release verification is only enforced in production (HTTPS). The probe is memoized across calls in the same page load; a browser that transiently fails the probe will use noble for the remainder of the session.
**Follow-up (2026-03-16)**: The lazy-loaded part of this decision was superseded later the same day. The fallback still uses `@noble/ed25519`, but it now ships inside the trusted bootstrap bundle so unsupported browsers do not execute an extra pre-verification chunk.

## [2026-03-15] Enforce cipher bundle metadata binding on both commit and decrypt

**Decision**: Make `cipherBundle` metadata binding a protocol invariant enforced by both the backend commit path and the frontend decrypt path.
**Context**: The sender already constructed AES-GCM AAD as `uuid||version||receiverPubFpr`, but the backend still accepted any schema-valid `cipherBundle` and the frontend decrypt path trusted the returned `aad` bytes instead of rebuilding the expected binding locally. `ciphertextHash` was also only checked by the receiver, despite the shared contract documenting it as server-verifiable integrity metadata.
**Choice**: Add shared helpers for the canonical AAD bytes/string, validate `SHA-256(ciphertext) === ciphertextHash` plus exact AAD binding inside `compound_commit` for `update` intents, return a new `cipherVersion` field from `get_decrypt_payload`, and require the frontend decrypt flow to reject payloads whose `receiverPubFpr` or AAD does not match the locally expected `{ uuid, cipherVersion, receiverPubFpr }`.
**Reasoning**: This closes the gap where metadata binding depended on a well-behaved sender implementation, turns the documented protocol rule into an enforced contract, and gives the receiver an independent local check before attempting AES-GCM decryption.
**Trade-offs**: Strict frontend AAD validation intentionally breaks compatibility with older delivered payloads written before the March 13 AAD-strengthening change; because channel TTL is at most seven days, that incompatibility is bounded to the existing retention window and no migration path is added.
**Follow-up (2026-03-15)**: The decrypt-side `cipherVersion` check alone was not an independent trust root because `cipherVersion` still came from the backend. The anchored A+B follow-up below supersedes that part of the reasoning for new channels by pinning a sender-auth fingerprint from the share link and persisting local monotonic replay state. Legacy channels without that pin remain A-only.

## [2026-03-15] Anchor anti-rollback checks to sender proof plus local monotonic state

**Decision**: Extend PR161 from plain metadata binding to anchored anti-rollback for new channels, using a pinned sender-auth fingerprint plus locally persisted accepted-delivery state.
**Context**: After adding `cipherVersion`, the receiver still rebuilt expected AAD from backend-supplied version data. That caught malformed payloads but did not stop an untrusted backend from replaying an older self-consistent `{ cipherBundle, receiverPubFpr, cipherVersion }` tuple.
**Choice**: Add `af=sha256(spki(sender admin verify key))` to new share-link fragments, persist that fingerprint in the receiver envelope after lock, derive update delivery proof challenges as `sha256("GL-delivery-proof" || uuid || intentHash)`, store only `{ meta, detached proof }` on delivered records, reconstruct signer material at `get_decrypt_payload` time, verify the delivery proof locally on anchored channels, and persist `lastAcceptedDelivery { version, ciphertextHash }` locally to reject rollback or same-version hash swaps.
**Reasoning**: This gives the receiver two trust anchors the backend cannot fabricate on demand: a sender key fingerprint pinned from the original out-of-band share link and a local monotonic record of what this device has already accepted. Minimal proof storage keeps the backend contract small and avoids duplicating signer keys or full intents inside Durable Object state.
**Trade-offs**: Legacy channels or pre-change delivered records without `af`/`deliveryAuth` remain A-only: they still get backend-enforced AAD/hash validation plus local replay-state checks, but not sender-anchored proof verification. This improves device-local rollback resistance, not global freshness; preventing a malicious backend from hiding newer valid updates still requires a future C-class witness/log design.
**Follow-up (2026-03-15)**: Anchored decrypt now fails closed on partial anchor state. If either side of the anchored contract is missing locally or remotely (`senderAuthFpr` without `deliveryAuth`, or `deliveryAuth` without `senderAuthFpr`), the client rejects decrypt with `INTEGRITY_MISMATCH` instead of silently downgrading to legacy A-only.

## [2026-03-15] E2E harness mirrors anchored delivery semantics

**Decision**: Persist the Playwright WebAuthn emulator per tab via `sessionStorage` and normalize mocked delivered payloads to include anchored `deliveryAuth`.
**Context**: PR161 added sender-auth pinning, deterministic delivery proofs, and stricter decrypt-side integrity checks. The existing E2E harness still regenerated fake WebAuthn credentials on every navigation and returned legacy decrypt payloads, which broke secure create/deliver/decrypt flows without exercising the new protocol guarantees.
**Options Considered**: Switch all secure E2E coverage to Quick Share, rely on Chromium's virtual authenticator directly, or upgrade the in-page emulator and stateful API mock to follow the anchored protocol.
**Choice**: Keep secure E2E coverage and upgrade the harness.
**Reasoning**: Reusing the same fake sender credential across same-tab navigations lets create-time `af` pinning and manage-time delivery proofs stay consistent, while returning normalized `deliveryAuth`, `ciphertextHash`, and AAD from the stateful mock keeps decrypt-side validation aligned with production semantics.
**Trade-offs**: The E2E helper now owns a small deterministic WebAuthn emulator and more protocol-aware mock logic, which is slightly more complex to maintain than the previous placeholder payloads.

## [2026-03-15] Lint cleanup keeps index-signature strictness intact

**Decision**: Resolve biome literal-key findings with local destructuring instead of dot-access on index-signature objects.
**Context**: Repo lint flagged bracket access like `value['uuid']`, but the backend also enforces `noPropertyAccessFromIndexSignature`, so blindly applying biome's literal-key suggestions would break TypeScript typecheck.
**Options Considered**: Accept lint noise, disable the rule, or refactor the affected code to destructure once and reuse typed locals.
**Choice**: Destructure the checked values into locals.
**Reasoning**: This clears the lint findings, preserves strict index-signature typing, and keeps parsing/test logic behavior unchanged.
**Trade-offs**: A few helpers and tests now use small local bindings purely to satisfy both static-analysis rules.

## [2026-03-14] Durable Object abuse controls use in-memory per-channel limits plus single active lock challenge

**Decision**: Implement issue #155 with best-effort in-memory rate limiting inside `SecretVault` and reuse a single active lock challenge record per channel instead of storing one lock challenge row per `lock_begin` request.
**Context**: The backend had no explicit application-layer throttling on `lock_begin`, `lock_commit`, `compound_begin`, or `compound_commit`. `lock_begin` also wrote a new `lock_challenge:{id}` record on every call, which increased Durable Object storage churn under repeated retries or abuse.
**Choice**: Add per-channel, per-endpoint in-memory windows in the DO (`lock_begin` 3/60s, `lock_commit` 5/60s, `compound_begin` 3/60s, `compound_commit` 10/60s), return `429 RATE_LIMITED` with `Retry-After`, and store only one active lock challenge under a fixed key that is reused until consumed or expired. Preserve `get_public_state` and `get_decrypt_payload` behavior without DO-side throttling.
**Reasoning**: Once a request reaches the DO, free-tier request quota is already spent, so the backend-side goal is to reduce storage churn and make abuse more expensive rather than to replace edge rate limiting. A fixed-key lock challenge model aligns `lock_begin` with the existing idempotent `compound_begin` pattern and prevents repeated writes from extending challenge lifetime.
**Trade-offs**: In-memory counters reset when a DO instance is evicted or restarted, so this is defense-in-depth rather than a durable quota system. Edge/global rules remain the primary control for `create_begin` or cross-channel floods.
**Follow-up (2026-03-14)**: Narrow quota charging to the expensive paths only. `lock_begin` and `compound_begin` now charge only when issuing a new challenge, while `lock_commit` and `compound_commit` charge only after cheap record/challenge/integrity checks pass. This avoids spending shared per-channel quota on idempotent reads or obviously invalid requests. Keep a temporary legacy read fallback for pre-deploy `lock_challenge:{id}` rows so in-flight receiver lock attempts continue to work during rollout.
**Follow-up (2026-03-15)**: Replace shared per-channel commit buckets with caller-bound commit buckets for new challenges. The Worker now derives an internal `caller_key` as `HMAC(COMMIT_TOKEN_SECRET, normalized server-visible signals)` using `CF-Connecting-IP` plus a coarse UA family, and forwards only that derived key plus the specific commit token cookie value to the DO. New lock and compound challenges carry `issuedAt` plus `commitTokenMode: 'caller-cookie-v1'`; the DO binds deterministic HMAC-signed commit tokens to `{ kind, uuid, challengeId, callerKey, iat, exp }`, enforces `exp <= challenge.expiresAt`, hashes the validated token for commit-rate-limit subject keys, and emits only internal set/clear cookie signals for the Worker to translate into fixed-name path-scoped `HttpOnly` cookies.
**Follow-up (2026-03-15)**: Direct backend unit coverage now exercises the commit-token helpers themselves, not only the `SecretVault` integration paths. `createCommitToken`, `verifyCommitToken`, and `hashCommitToken` have explicit round-trip, tamper-rejection, malformed-token, and deterministic-hash tests so future token-format or signature regressions fail close to the helper boundary.

## [2026-03-14] Share links clear `#k` after session-scoped handoff

**Decision**: Remove the receiver share-link `#k` fragment from the address bar after it is copied into `sessionStorage`, and keep it there only until the channel no longer needs an initial lock.
**Context**: Phase 2 of issue #154 aims to reduce the window where the lock secret sits in browser-visible URL state. The receiver flow still needs the same secret to survive refreshes and same-tab navigation before the first lock succeeds.
**Choice**: Resolve the lock secret from the URL hash first, then from `sessionStorage` keyed by channel UUID. Only call `history.replaceState` after `sessionStorage` persistence succeeds. Clear the cached secret on lock success and whenever public channel state stops being `waiting`.
**Reasoning**: This shortens the address-bar and history exposure window without regressing the receiver's ability to refresh, visit the Trust page, or otherwise continue the first-lock flow in the same browser session.
**Follow-up (2026-03-14)**: Initialize the receiver lock secret synchronously from the current hash or session cache so the lock step does not depend on a post-render effect to know whether `#k` is available. Keep the Trust route helper typed to `pathname + search` only, with an explicit note that fragments must not be preserved in router state.

## [2026-03-14] Phase 3 runtime key hardening uses non-extractable imports and best-effort byte wiping

**Decision**: Treat Phase 3 as runtime defense-in-depth only. Keep wrapped receiver keys persisted for repeat local decrypt, but shrink the lifetime and exportability of transient key material during deliver and decrypt.
**Context**: PR #156 already reverted the earlier L-2 behavior that deleted the wrapped receiver key after every successful decrypt. The remaining gap was runtime exposure: deliver used an extractable AES content key, unwrap helpers re-imported private keys as extractable, and decrypt returned raw plaintext bytes even though the UI only consumed strings.
**Choice**: Import unwrapped RSA/ECDSA private keys as non-extractable, generate sender content key bytes directly and import them into a non-extractable AES key, wipe temporary PKCS8/content-key/plaintext byte arrays in `finally` blocks, and remove `plaintextBytes` from `decryptDelivered()` output.
**Reasoning**: This tightens the in-memory attack surface without breaking re-decrypt semantics or changing user-visible flows. The wipe behavior is explicitly best-effort: it reduces exposure windows but does not claim guaranteed zeroization across browser internals.
**Follow-up (2026-03-14)**: Pass sensitive `Uint8Array` inputs directly to WebCrypto `importKey`/`encrypt`/`decrypt` in the runtime hardening paths. Avoiding helper-level `Uint8Array -> ArrayBuffer` clones prevents extra JS copies of sender content keys, Argon2 key material, and unwrapped PKCS8 blobs from surviving until GC after the original buffers are wiped.

## [2026-03-14] Trusted Types enforcement uses a zero-policy frontend hardening path

**Decision**: Enable frontend CSP Trusted Types enforcement with `require-trusted-types-for 'script'` and remove the remaining explicit HTML injection sink instead of introducing a custom policy.
**Context**: Issue #154 targets DOM XSS defense-in-depth. The frontend bootstrap fallback in `packages/frontend/src/bootstrap-entry.ts` still rendered its blocking release guard with `innerHTML`, which would violate Trusted Types once enforcement was enabled.
**Choice**: Keep Phase 1 scoped to CSP hardening plus a DOM API rewrite of the startup failure gate. Do not add a Trusted Types policy and do not mix fragment cleanup or receiver-key lifecycle changes into this PR.
**Reasoning**: The known violating sink was isolated to the startup failure path, so a zero-policy rewrite keeps the change small, avoids broadening the DOM trust surface, and allows strict TT enforcement without changing product behavior.

## [2026-03-13] Backend validation hardening (crypto audit findings)

**Decision**: Implement 10 security fixes from crypto audit across backend and frontend.
**Context**: Comprehensive cryptographic protocol and implementation audit identified 12 findings (2 High, 5 Medium, 5 Low). Two architectural issues (H-2 XSS Trusted Types, M-5 rate limiting) filed as issues #154 and #155.
**Changes**:
- **H-1**: Enforce securityProfile → adminMode binding in `commitCreate()` — secure/strict/hardware_only profiles now require webauthn.
- **M-1**: Validate `SHA256(SPKI(receiverPubJwk)) === receiverPubFpr` in `commitLockChallenge()`.
- **M-2**: Cross-validate `intent.receiverPubFpr` against stored `record.receiver.pubFpr` in `commitCompound()`.
- **M-3**: Reject `beginCompoundChallenge()` when an active unconsumed challenge exists.
- **M-4**: Reject unverified attestation (`verified: false`) for secure/strict/hardware_only profiles.
- **L-1**: Use constant-time comparison for ciphertext hash in `performDecryptionPipeline()`.
- **L-2**: Clean up wrapped receiver private key from IndexedDB after successful decryption.
- **L-3**: Validate RP_ID and RP_ORIGIN format at SecretVault construction time.
- **L-4**: Validate content key length is exactly 32 bytes (AES-256) before import.
- **L-5**: Enforce minimum 8-character passphrase length.
**Reasoning**: Defense-in-depth — prevent protocol downgrade attacks, ensure cryptographic binding invariants are server-enforced, reduce local key material exposure.
**Follow-up (2026-03-14)**: Reverted the frontend portion of L-2 that deleted the wrapped receiver private key immediately after every successful decrypt. Receiver key cleanup now happens only when the Share page confirms a terminal channel state (`NOT_FOUND`, `deleted`, `expired`, or realtime close), preserving local-burn re-decrypt semantics while still performing best-effort IndexedDB cleanup once the channel is no longer usable.
**Follow-up (2026-03-14)**: Tightened L-5 so Quick Share / password-managed softkey flows now enforce the same 8-character minimum on create, deliver, and delete, with Create/Manage UI gating using the same frontend helper as the orchestrator. Adjusted M-3 from a hard rejection to an idempotent `compound_begin`: when an active challenge already exists, the DO returns the existing challenge instead of overwriting it or blocking sender retries until TTL expiry.

## [2026-03-13] Strengthen AAD binding to match documented spec

**Decision**: Change AES-GCM AAD from `uuid` alone to `uuid||version||receiver_pub_fpr`.
**Context**: SECURITY.md and PRD.md documented AAD as binding uuid, version, and receiver public key fingerprint, but the implementation only bound uuid. This was a gap between documented and actual binding strength.
**Choice**: Align code to documentation — bind all three fields.
**Reasoning**: Binding version prevents ciphertext replay across channel versions; binding receiver_pub_fpr prevents ciphertext substitution across receivers. The change is backward-compatible because AAD is stored alongside the cipherBundle and read back as-is during decryption.

## [2026-03-13] Remove RS256 from WebAuthn, ES256 only

**Decision**: Remove RS256 (COSE alg -257) support from WebAuthn registration and assertion verification.
**Context**: `pubKeyCredParams` and `verifyAssertion` supported both ES256 and RS256, but `attestation.ts` has always only accepted ES256. The RS256 verification branch was unreachable dead code from day one — no RS256 credential could ever be stored.
**Options Considered**: (1) Keep RS256 for hypothetical future device compatibility; (2) Remove RS256 entirely; (3) Complete RS256 support by adding it to attestation.
**Choice**: Remove RS256 entirely.
**Reasoning**: ES256 is mandatory per WebAuthn L2 spec (all FIDO2 authenticators must support it). RS256 added ~40 lines of dead code and created a false impression of broader algorithm support. Removing it narrows the attack surface and eliminates the inconsistency. If RS256 is ever needed, it can be re-added with full attestation support.

## [2026-03-13] Release verification crypto helpers stay on the static import path

**Decision**: Remove the dynamic `import('./crypto')` from frontend tiered release verification and use a static import for `verifyManifestSignature`.
**Context**: `pnpm build` was emitting a Vite warning because `packages/frontend/src/release/crypto.ts` was already pulled into the static dependency graph by both `tiered-verification.ts` and `verification.ts`, so the dynamic import could not create a separate async chunk.
**Options Considered**: Keep the mixed static and dynamic imports and tolerate the warning; force a broader module split to create a real lazy boundary; align the code with the actual bundle graph and use static imports only.
**Choice**: Use static imports only.
**Reasoning**: The current `crypto.ts` helper is small and already required on the eager path, so the dynamic import had no runtime bundle benefit and only expressed a lazy boundary that did not exist in practice. Static imports make the dependency model explicit and remove the noisy build warning.
**Trade-offs**: This keeps the release-verification crypto helpers in the initial bundle. If future performance work wants true lazy loading here, that should come from splitting a new module that is reachable only through an async path.

## [2026-03-13] Sender manage flow preserves known Safety Code fingerprint during begin retries

**Decision**: Keep the sender-side `receiverPubFpr` in the deliver store when `compound_begin` enters loading or error states, and only replace it when a fresh `compound_begin`, public-status fetch, or realtime update returns authoritative data.
**Context**: `ManagePage` derives the sender Safety Code directly from `deliver-store.receiverPubFpr`. The previous `startCompoundBegin()` and `failCompoundBegin()` implementations cleared that field immediately, so the first `Deliver` click briefly swapped a valid Safety Code for the generic yellow warning even though the backend still had the receiver fingerprint.
**Options Considered**: Keep clearing the fingerprint and patch the UI to special-case pending state; preserve the last known fingerprint in the shared deliver store begin lifecycle; move Safety Code display to a separate memoized cache outside the store.
**Choice**: Preserve `receiverPubFpr` across `compound_begin` loading and error transitions, while still clearing request-scoped fields such as `challenge`, `currentVersion`, and `receiverPubJwk`.
**Reasoning**: The fingerprint is durable channel state, not request-scoped begin metadata. Keeping it in the store prevents misleading UI flicker on sender manage actions without weakening the authoritative update path.
**Trade-offs**: Delete flows now share the same preserved-fingerprint behavior because they also use `compound_begin`, but any fresh response that truly omits `receiverPubFpr` still overwrites the store and surfaces the warning as before.
**Follow-up (2026-03-13)**: `compound_begin` error handling now preserves `receiverPubFpr` only for loading and non-authoritative/retryable begin failures. Terminal begin errors such as `NOT_FOUND` and `LOCK_FORBIDDEN` clear the cached fingerprint so sender Safety Code UI does not outlive the backend's channel validity.
**Follow-up (2026-03-13)**: Regression coverage now asserts both terminal begin error codes, `NOT_FOUND` and `LOCK_FORBIDDEN`, clear the sender-side Safety Code state in the deliver store and ManagePage tests.

## [2026-03-13] WebAuthn normalization keeps bracket notation without stale Biome suppressions

**Decision**: Remove unused `biome-ignore lint/complexity/useLiteralKeys` comments from `packages/frontend/src/crypto/webauthn.ts` while keeping bracket notation for `Record<string, unknown>` access.
**Context**: `pnpm lint` was clean on the underlying code path but started failing on `suppressions/unused` because the existing ignores no longer matched any active Biome diagnostic. The file still relies on `Record<string, unknown>` narrowing under `noPropertyAccessFromIndexSignature`, so bracket notation remains the clearest and safest access pattern there.
**Options Considered**: Keep the dead suppressions; switch the accessors to dot notation to satisfy the old comment rationale; remove only the stale comments and preserve the existing runtime/type behavior.
**Choice**: Remove the dead suppressions only.
**Reasoning**: This restores lint cleanliness with the smallest possible diff and avoids touching WebAuthn request normalization logic in a security-sensitive path.
**Trade-offs**: The file keeps explicit bracket access, so future formatter or lint changes should be evaluated against the TypeScript index-signature constraint before reintroducing suppressions.
**Follow-up (2026-03-13)**: In tests that inspect structured log payloads, prefer a tiny explicit object shape over `Record<string, unknown>` when the assertion needs named fields such as `stack_fingerprint`. That avoids a `useLiteralKeys` vs. `noPropertyAccessFromIndexSignature` conflict without needing suppressions.
**Follow-up (2026-03-13)**: Frontend test teardown for receiver-key IndexedDB cleanup now aggregates per-UUID delete failures and throws once cleanup completes. Test-isolation failures are treated as blocking rather than logged or silently ignored, so dirty IndexedDB state surfaces immediately and deterministically.

## [2026-03-13] Share links are shown only on channel creation

**Decision**: Show the receiver share link only in the create success state and remove it from `ManagePage`.
**Context**: `ManagePage` rebuilt `/s/:uuid` without the required `#k=` fragment, producing unusable receiver links. Persisting the fragment locally would extend the lifetime of lock material on the sender device.
**Options Considered**: Restore the fragment from same-tab storage, persist the fragment across sessions, only show the share link at creation time.
**Choice**: Only show the complete share link once, immediately after channel creation.
**Reasoning**: The create flow already has the full `shareUrlWithFragment`, so it can display the correct receiver URL without storing the fragment anywhere else. Removing the share link from `ManagePage` avoids distributing broken links and keeps lock material out of longer-lived local storage.
**Trade-offs**: Senders must save the share link before leaving the create success screen. If they lose it afterward, they need to create a new channel.
**Follow-up (2026-03-30)**: This is no longer absolute. `ManagePage` now supports best-effort same-session recovery of the original receiver link while the channel is still `waiting`, using browser `sessionStorage` plus waiting-state gating. The original trade-off still applies after that waiting window, after session end, or when the recovery cache is unavailable.

## [2026-03-12] Receiver Safety Code and realtime copy align with public channel state

**Decision**: Treat `receiverPubFpr` from `/api/public/:uuid` and websocket state updates as the source of truth for receiver-side Safety Code rendering when local lock state is unavailable, and update frontend copy to describe automatic realtime refresh instead of manual reopen/refresh steps.
**Context**: The frontend already auto-syncs channel state with websocket plus polling fallback, and the backend already returns `receiverPubFpr` in public status. Receiver-facing copy still told users to reopen the original lock device for Safety Code visibility, while sender copy implied delivery could be confirmed after receiver decrypt even though decrypt remains local-only.
**Options Considered**: Only rewrite the stale copy; keep receiver Safety Code limited to local lock state; surface Safety Code from the public fingerprint on both sender and receiver flows and update the copy to match the shipped behavior.
**Choice**: Reuse the public `receiverPubFpr` for `SharePage` Safety Code display in `locked` and `delivered` states, keep decrypt gated on local key material, and revise sender/receiver messaging to say the page updates automatically and that receiver decrypt does not send a confirmation back to the sender view.
**Reasoning**: This removes false instructions without changing the security boundary. The Safety Code is derived from the receiver public fingerprint, so surfacing it from public channel state improves continuity across reloads and devices while leaving private keys and plaintext local-only.
**Trade-offs**: Receiver pages now show a generic fallback when the fingerprint is unexpectedly missing from public state, and delivered-state receiver views render Safety Code alongside the decrypt form for continuity.
**Follow-up (2026-03-12)**: Security review found that receiver pages must not render Safety Code from public `receiverPubFpr` alone. A link interceptor could lock the channel first with an attacker key, then trick the real receiver into reading out an attacker-derived Safety Code. Receiver-side Safety Code rendering is therefore restricted to devices that can prove local possession of a matching `ReceiverKeyEnvelope`; the public fingerprint is used only to compare current channel state against that local proof. Sender-side Safety Code rendering and realtime copy updates stay unchanged.
**Follow-up (2026-03-12)**: The same local-proof requirement also gates delivered-state decrypt UI. Receiver pages only expose decrypt controls when the current device has a matching local `ReceiverKeyEnvelope`; wrong-device, mismatched-key, and storage-error states render explicit blocking warnings instead of a passphrase form.

## [2026-03-12] Staging Durable Object deletions require a staging-only entrypoint

**Decision**: Deploy staging from `packages/backend/src/index.staging.ts` so the staging bundle exports only `SecretVaultStaging`, while production continues exporting `SecretVault` from `packages/backend/src/index.ts`.
**Context**: Cloudflare kept serving and billing the legacy `zerolink-api-staging_SecretVault` namespace after the staging binding moved to `SecretVaultStaging`. The old namespace had to be deleted manually because the shared worker entry still referenced `SecretVault`, which prevented `deleted_classes = ["SecretVault"]` from fully retiring the staging class.
**Options Considered**: Keep one shared entrypoint and rely on env-specific bindings alone; continue manual cleanup whenever staging rotates namespaces; split the worker entry so staging no longer references the legacy class at all.
**Choice**: Extract the shared fetch/router logic into `packages/backend/src/worker.ts`, keep production and staging entrypoints separate, and point `env.staging.main` at the staging-only entrypoint.
**Reasoning**: Cloudflare's delete migrations require the class being deleted to be absent from the deployed worker code. A staging-only entrypoint satisfies that requirement without changing the production durable object class.
**Trade-offs**: Backend bootstrap wiring is slightly more explicit, and future entrypoint changes must stay aligned through the shared `worker.ts`.

**Follow-up (2026-03-12)**: Production also moved to a fresh `SecretVaultProduction` class name before deleting the legacy `zerolink-api_SecretVault` namespace. The live worker keeps exporting the legacy `SecretVault` class during the cutover so Cloudflare will accept the migration, then the old namespace is removed manually after the new binding is active.
**Follow-up (2026-03-12)**: Once production and staging were both clean, the active bindings were aligned again on a shared class name, `SecretVaultV2`, so the Cloudflare namespace list differs only by worker name instead of mixing `...Production` and `...Staging` suffixes.
**Follow-up (2026-03-12)**: After the `SecretVaultV2` namespaces were live in both environments and the old namespaces were deleted, the worker entrypoints dropped the temporary `SecretVault`, `SecretVaultProduction`, and `SecretVaultStaging` export aliases so only the active Durable Object class remains exposed.

## [2026-03-12] Disable passphrase autofill across frontend flows

**Decision**: Use `autocomplete="off"` on shared passphrase inputs without vendor-specific ignore hints
**Context**: The same passphrase field is reused for channel creation, receiver lock setup, sender delivery, receiver decryption, and password-managed delete confirmation. `autocomplete="new-password"` triggered confusing password-manager prompts in non-signup flows.
**Options Considered**: Keep `new-password` everywhere, split autocomplete by flow, disable autofill across all passphrase prompts, disable autofill plus password-manager ignore hints
**Choice**: Disable autofill across all passphrase prompts
**Reasoning**: ZeroLink passphrases are task-scoped secrets rather than account credentials, so avoiding stale autofill and misleading "set new password" prompts is more important than password-manager generation in these fields. Leaving out vendor-specific ignore hints preserves the user's ability to invoke a password manager intentionally.
**Trade-offs**: Browsers are less likely to offer generated passwords for Quick Share or receiver lock setup, and some password managers may still choose to assist when the user explicitly invokes them.

## [2026-03-11] Durable Object fetch-level failures must use the same production redaction path

**Decision**: Route unexpected errors from the Durable Object `fetch()` entrypoint, including `/ws` subscribe upgrades, through the same `mapError()` redaction path used by the JSON handlers.
**Context**: Production observability was hardened for the main SecretVault HTTP handlers, but a review caught that uncaught websocket upgrade failures could still bypass redaction once Workers Logs were enabled.
**Options Considered**: Rely on per-handler `catch` blocks only; disable observability again; add a top-level `fetch()` guard that supplies handler context and reuses the same structured logger.
**Choice**: Keep observability enabled and wrap the full DO `fetch()` dispatch in a top-level `try/catch`, using `ws_subscribe` as the websocket handler name for structured logs.
**Reasoning**: This closes the last request path that could emit raw production exception text while preserving existing `404` behavior for missing or expired websocket channels.
**Trade-offs**: The `fetch()` dispatcher now carries handler-name bookkeeping so future routes keep accurate observability context.

## [2026-03-11] Worker observability stays environment-explicit and production logs are redacted

**Decision**: Add a committed `APP_ENV` Worker variable, enable full Workers Logs only in staging, and keep production observability limited to custom logs with structured redaction.
**Context**: ZeroLink needs enough runtime visibility to debug Durable Object failures, but the backend handles high-sensitivity flows where raw exception messages or stacks could accidentally preserve user-derived values in provider logs.
**Options Considered**: Leave observability disabled everywhere; enable full invocation logs and detailed exceptions in every environment; split behavior by environment and log only a whitelisted production payload.
**Choice**: Stage with invocation logs enabled and detailed exception text, production with `invocation_logs = false`, no tracing, and structured error records that keep only handler, environment, error name, and a stable stack fingerprint.
**Reasoning**: This preserves fast debugging in staging while making the production logging surface intentionally small and reproducible in code review. An explicit `APP_ENV` binding is more reliable than inferring environment from hostnames or dashboard-only state.
**Trade-offs**: Production incidents now require correlating stack fingerprints with staging or local reproductions instead of reading raw stack text directly from Cloudflare logs.
**Follow-up (2026-03-11)**: `stack_fingerprint` is derived from a normalized handler + error-name + frame signature, not the raw `error.stack`, so deploy-specific bundle offsets do not invalidate cross-environment correlation.

## [2026-03-11] Workflow and security docs must describe the shipped path precisely

**Decision**: Keep runnable workflow examples complete, describe `/api/public/:uuid` as a minimal public snapshot rather than a non-disclosing endpoint, and scope Signed Manifest guarantees to signed-release builds that actually enable runtime verification.
**Context**: The doc-drift cleanup updated several pages to match current `main`, but review caught that one CI example was no longer copy-pastable and two security bullets overstated privacy/integrity guarantees relative to the shipped implementation.
**Options Considered**: Leave the docs aspirational; trim details until they are vague enough not to be wrong; restate the concrete runtime and deployment conditions exactly.
**Choice**: Make the examples and guarantees explicit about prerequisites, public metadata disclosure, and the fact that fail-closed Verified Release protection is opt-in at build/deploy time.
**Reasoning**: These docs are used as operational references. A concise but exact description is more valuable than a stronger claim that only applies to part of the deployment matrix.
**Trade-offs**: The security section now states the web trust boundary more plainly, which is less marketing-friendly but more useful for engineering and review.

## [2026-03-11] `_project_specs/session/` keeps only durable context files

**Decision**: Remove `_project_specs/session/current-state.md` and keep `_project_specs/session/` limited to `decisions.md` and `code-landmarks.md`.
**Context**: The archive layer was already removed, but `current-state.md` still duplicated volatile branch/PR history in a way that was harder to scan than `git log`, the open PR, or the current diff. The remaining value in `_project_specs/` is durable rationale and navigation, not a repo-local activity feed.
**Options Considered**: Keep `current-state.md` as a handoff file; replace it with a smaller status template; remove it and rely on git/PR/worktree state for transient progress.
**Choice**: Keep only `decisions.md` and `code-landmarks.md`.
**Reasoning**: Humans and agents can already reconstruct "what is happening now" from branch status, recent commits, PR discussion, and the current diff. The repo-local files are most useful when they explain why the code looks this way and where to look next.
**Trade-offs**: There is no longer a single markdown handoff file for in-progress work, so good commit hygiene and clear PR context matter more.

## [2026-03-11] `_project_specs/session/` keeps only live session files

**Decision**: Remove `_project_specs/session/archive/` and keep `_project_specs/session/` limited to `current-state.md`, `decisions.md`, and `code-landmarks.md`.
**Context**: After deleting `_project_specs/todos/`, the archive layer still duplicated `git log` / PR history while forcing repo guidance to carry stale path references. Human readers consistently need current state, rationale, and navigation more than a separate completed-work log.
**Options Considered**: Keep `session/archive/` for completed history; keep archive files only for end-of-session snapshots; remove the archive layer entirely and rely on live session files plus GitHub/git history.
**Choice**: Keep only the three live session files under `_project_specs/session/`.
**Reasoning**: The high-value context is current status, durable decisions, and fast code navigation. Removing the archive layer lowers maintenance cost, reduces stale-path drift across agent docs, and keeps the handoff surface predictable.
**Trade-offs**: Historical completion detail now lives in git/PR history, and `current-state.md` must stay concise so it does not become a de facto archive.
**Follow-up (2026-03-11)**: Superseded later the same day. `current-state.md` was also removed, leaving only the durable context files `decisions.md` and `code-landmarks.md`.

## [2026-03-11] `_project_specs` keeps live state in `session/` and archives history under `session/archive/`

**Decision**: Remove `_project_specs/todos/`, keep live project context in `_project_specs/session/`, and store completed-history records in `_project_specs/session/archive/` with newest-first ordering.
**Context**: The `todos/active.md` and `todos/backlog.md` stubs were empty, while the completed-history file was the only useful artifact left in that folder. Keeping an extra task layer made humans and agents scan dead-end files before reaching the real session state.
**Options Considered**: Keep `todos/` as-is; keep the folder but repurpose it; move completed history into `session/archive/` and delete the empty todo layer.
**Choice**: Collapse to `session/` plus `session/archive/`.
**Reasoning**: Human readers mostly need current state, decisions, code landmarks, and a concise completed-history archive. Putting those under one `session/` tree reduces navigation cost, and newest-first archive ordering matches how recent work is usually read.
**Trade-offs**: Repo-local workflow docs and skill files must move with the structure change, otherwise agents regress to stale path assumptions.
**Follow-up (2026-03-11)**: Superseded later the same day. The archive layer turned out to be low-value duplication, and the subsequent cleanup also removed `current-state.md`, so `_project_specs/session/` now keeps only `decisions.md` and `code-landmarks.md`.
## [2026-03-11] Durable Object alarm scheduling must fail closed on corrupt timing state, and staging may reset its namespace independently

**Decision**: Reconcile nonce cleanup inside the alarm scheduler, delete alarms when the next candidate is not a finite future timestamp, treat malformed `expiresAt` values as expired terminal state, and move staging onto a fresh `SecretVaultStaging` SQLite class while leaving production on `SecretVault`.
**Context**: Cloudflare GraphQL analytics showed that repeated daily free-tier exhaustion was coming from a single staging Durable Object object spinning on `alarm` invocations, not from user traffic. The loop pattern matched alarm candidates derived from corrupt or stale timing state after the physical-delete / nonce-cleanup refactor.
**Options Considered**: Keep the existing `now + 1000`-style retry semantics for expired nonce cleanup; try to surgically clean the broken staging object while reusing the same namespace; fail closed on invalid timing data and abandon the bad staging namespace with a new class migration.
**Choice**: Make alarm scheduling conservative: clean malformed/expired nonce index state before selecting the next alarm, only call `setAlarm()` for validated future timestamps, purge malformed record expiries as `expired`, and reset staging by switching its binding to a new `SecretVaultStaging` class created through an env-specific migration.
**Reasoning**: The durable-object free-tier outage was caused by a scheduler feedback loop, so the safe default is to stop scheduling when timing data cannot be trusted. Resetting staging is cheaper and safer than trying to preserve bad data there, while production keeps the same class and storage namespace.
**Trade-offs**: Staging Durable Object data is intentionally discarded on the next deploy, and alarm cleanup now does more synchronous storage work inside each scheduling pass to guarantee that expired or malformed nonce indexes do not survive by bouncing the alarm.
## [2026-03-11] Delivery padding is selected by security profile in the frontend orchestrator

**Decision**: Keep the shared AES-GCM helper default at 4 KB and make the frontend delivery orchestrator pass an explicit `padBlock` derived from `securityProfile`.
**Context**: Secure Share docs and UI promised 8 KB ciphertext padding, but the sender delivery path called `encryptAesGcm()` without `padBlock`, so every profile silently fell back to the helper's 4 KB default.
**Options Considered**: Lower docs/UI to 4 KB everywhere; make the shared AES helper profile-aware or change its default; resolve the profile-specific padding policy in `packages/frontend/src/crypto/orchestrator.ts` and pass it explicitly.
**Choice**: Resolve padding in the delivery orchestrator: `quick`/`standard` map to 4 KB and `secure`/`strict`/`hardware_only` map to 8 KB.
**Reasoning**: Padding size is product-policy behavior keyed off the channel security profile, not a generic AES primitive concern. Fixing it at the orchestration layer restores the documented behavior without surprising other AES helper callers.
**Trade-offs**: Future profile additions must update the orchestrator mapping and its regression tests to keep runtime behavior aligned with docs and UI copy.
## [2026-03-11] Use Corepack plus Node 24-based official actions in GitHub workflows

**Decision**: Replace `pnpm/action-setup` with `corepack enable` in CI and pin `actions/checkout` / `actions/setup-node` to `v5` SHAs.
**Context**: GitHub Actions started warning that the existing pinned `actions/checkout`, `actions/setup-node`, and `pnpm/action-setup` entries were still running on deprecated Node 20 runtimes in both deploy and PR validation workflows.
**Options Considered**: Ignore the warnings until Node 20 is removed; keep `pnpm/action-setup` and only bump the official actions; switch pnpm bootstrapping to Corepack and upgrade the official actions to Node 24-based releases.
**Choice**: Upgrade the official actions to `v5` SHAs and bootstrap pnpm through Corepack using the repo's root `packageManager` field.
**Reasoning**: This removes the deprecated action runtime dependency without changing the project's Node 22 execution target, keeps pnpm version selection in one place, and avoids waiting on a separate `pnpm/action-setup` runtime migration.
**Trade-offs**: CI now relies on Corepack being present in the Node runtime provided by `actions/setup-node`, and local reproduction of the full release path still needs the signing secret for `pnpm manifest:sign`. Follow-up on PR #135 also showed that `setup-node@v5` auto-detects package-manager caching from `packageManager` unless `package-manager-cache: false` is set, so the workflow now disables that behavior explicitly and calls `corepack pnpm` directly instead of relying on a shimmed `pnpm` binary.
## [2026-03-11] Channel sync uses Durable Object WebSockets with public-status polling fallback

**Decision**: Sender Manage and receiver Share views should subscribe to channel state changes over Durable Object WebSockets and fall back to `/api/public/:uuid` polling when WebSockets are unavailable.
**Context**: Share and Manage pages previously required refreshes or user actions to discover that the other party had locked or delivered the channel. Playwright mocks and some browsers also do not exercise the Cloudflare Durable Object WebSocket path directly.
**Options Considered**: Keep manual refresh only; poll continuously from every page; use WebSockets only with no degraded path; use WebSockets first with HTTP polling fallback.
**Choice**: Add a channel-scoped WebSocket endpoint on the Durable Object, broadcast lock/deliver/delete/expire events from the state machine, and let the frontend fall back to periodic `/api/public/:uuid` polling when the socket cannot stay connected.
**Reasoning**: WebSockets give low-latency state updates in production, while polling fallback preserves correctness in test environments and browsers where the socket path is unavailable or interrupted.
**Trade-offs**: Polling fallback cannot distinguish deleted vs expired once the channel has already been physically purged and only `404 NOT_FOUND` remains, so the degraded path treats that response as a generic terminal closure.
## [2026-03-11] Cached Verified Release trust must revalidate signed manifest bytes

**Decision**: Cached `Verified Release` snapshots may skip asset re-hashing only after `manifest.json` and `manifest.sig` are revalidated; `manifest-hash.txt` must remain a freshness hint, not a trust anchor.
**Context**: The tiered verification follow-up introduced a local cache keyed by `manifest-hash.txt`. That fast path could have reused a cached trusted snapshot without re-checking the signed manifest bytes, which weakens the signed-release guarantee because `manifest-hash.txt` is an unsigned helper file.
**Options Considered**: Trust `manifest-hash.txt` directly for fresh caches; remove cached verification entirely; reuse cached snapshots only after signature revalidation of the manifest bytes.
**Choice**: Keep the cache, but always revalidate `manifest.json` plus `manifest.sig` before returning a cached trusted snapshot. Use `manifest-hash.txt` only as an optimization hint to decide whether a fresh cache should go straight to full verification.
**Reasoning**: This preserves most of the performance win from skipping repeated asset hashing while keeping the trust boundary aligned with the signed manifest and embedded public key.
**Trade-offs**: Fresh-cache startups still fetch and verify the manifest/signature pair, so the optimization is smaller than a pure hash-file cache hit.
## [2026-03-11] ManagePage should only ask for a channel password when an action needs it

**Decision**: Hide the password-managed channel password input on the sender Manage page while the channel is still idly `waiting`, and only reveal it when the sender is in a state that can act on it (`locked` delivery or delete confirmation).
**Context**: The Manage page previously rendered the password field immediately for password-managed channels even before the receiver had locked the channel. That suggested the sender needed to do something before lock, which conflicted with the status copy and confused the flow.
**Options Considered**: Keep the password field always visible for password-managed channels; hide it until backend errors require it; show it only alongside delivery or delete-confirm actions that actually consume the password.
**Choice**: Render the password input only when the delivery composer is available or when the sender opens delete confirmation.
**Reasoning**: This keeps the idle waiting state aligned with the real protocol, removes a misleading prompt, and still preserves the ability to delete a password-managed channel before lock.
**Trade-offs**: Password-managed delete now reveals the credential field one interaction later, after the sender opens the confirm step.
## [2026-03-11] Manage flows must use the stored securityProfile, not infer from adminMode

**Decision**: Treat `ChannelRecord.securityProfile` as the only source of truth for sender Manage policy and propagate it through every read path the Manage UI depends on.
**Context**: The sender padding fix moved `deliverSecret()` to profile-based padding selection, but reopened Manage links still only knew `adminMode`. That collapsed legacy WebAuthn channels back to a generic "secure" assumption and made `standard` channels use the wrong 8 KB padding and WebAuthn policy after a Manage refresh.
**Options Considered**: Keep inferring from `adminMode`; store a frontend-only reconstruction of the original create-page selection; expose the persisted `securityProfile` in public status, compound begin, and realtime state updates.
**Choice**: Extend the shared contracts so `PublicStatusResponse`, `CompoundBeginResponse`, and WebSocket `state_changed` all include `securityProfile`, persist that value in the sender Manage store, and consume it directly in Manage actions.
**Reasoning**: `adminMode` answers "password vs WebAuthn" but not which WebAuthn compatibility profile was originally chosen. Surfacing the backend-stored profile restores correct legacy behavior, keeps padding selection aligned with product policy, and avoids duplicating security-policy inference in the frontend.
**Trade-offs**: Public/manage read contracts and mocks/tests now carry one more field, and Manage actions remain gated on `securityProfile` loading before sender-side controls can run safely.
## [2026-03-11] Stateful E2E mocks must mirror required shared wire contracts

**Decision**: Treat Playwright's stateful API mock as another protocol client/server boundary that must emit every required shared response field, including `securityProfile`.
**Context**: PR #137 correctly made `securityProfile` mandatory on public/manage read responses, but the Playwright stateful mock still returned the older payload shape. That left local unit tests green while Chromium E2E timed out on disabled Manage actions after merge.
**Options Considered**: Keep the mock loosely shaped and patch individual tests; make the stateful mock persist `securityProfile` from `create_begin` and emit it from every affected route.
**Choice**: Extend the stateful mock runtime state with `securityProfile`, persist it during create, and include it in `public` and `compound_begin` responses.
**Reasoning**: The mock exists to emulate the real protocol boundary. Once a shared schema field becomes required for runtime behavior, omitting it from the stateful mock stops E2E from validating the real app state machine.
**Trade-offs**: Protocol contract changes now require touching E2E infrastructure more often, but that is cheaper than letting green unit tests hide a broken `main` branch.
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
## [2026-03-10] Pull requests must pass CI before merge

**Decision**: Add a dedicated `pr-validate.yml` workflow with independent `PR Quality`, `PR Build`, and `PR E2E` jobs on `pull_request` and `merge_group`, while keeping signing and deployment in `deploy.yml` after merge.
**Context**: The repository previously ran checklist validation on pull requests, but typecheck, unit tests, Playwright E2E, and frontend build only ran from `deploy.yml` after a `push` to `main`. That allowed squash merges to land broken code before CI failed.
**Options Considered**: Keep post-merge-only validation; move every deploy step into PR CI; add a PR-only validation workflow for secret-free quality gates and leave deploy/signing post-merge.
**Choice**: Create a PR validation workflow that installs dependencies, runs root typecheck/tests, builds the frontend with release verification enabled, and runs Playwright Chromium E2E before merge. Keep `manifest:sign`, manifest verification with signing artifacts, and Cloudflare deploy steps in the post-merge deploy workflow. Also let the existing checklist workflow report a success result on `merge_group` so required checks remain merge-queue compatible.
**Reasoning**: This makes failing tests and builds block squash merge, gives branch protection stable required check names, and avoids exposing trusted deployment secrets to untrusted PR contexts.
**Trade-offs**: Dependency installation now happens in three PR jobs, so PR CI will use more minutes than the old checklist-only flow. Branch protection still requires a one-time repository settings update after the workflow merges. The workflow must also listen to `pull_request.edited` so retargeting an existing PR to `main` still produces the required checks without needing another push.
## [2026-03-09] Verified Release bootstrap is explicit opt-in for signed deployments

**Decision**: The frontend must only fail closed on bootstrap when the build is explicitly marked as an official signed release, and Cloudflare Pages must serve SPA entry requests with `Cache-Control: no-store` while keeping hashed assets immutable.
**Context**: The first bootstrap verifier pass ran for every `PROD` build, which broke unsigned `pnpm build` / `vite preview` / manual static deployments because they do not ship `manifest.json` and `manifest.sig`. The first Pages `_headers` pass also only marked `/index.html` as `no-store`, leaving `/` and SPA route entries cacheable.
**Options Considered**: Keep verification on for all `PROD` builds; silently bypass verification when release artifacts are missing; require an explicit build-time flag for official signed releases and fix Pages cache rules around SPA entry HTML versus hashed assets.
**Choice**: Gate bootstrap verification behind `VITE_RELEASE_VERIFICATION_REQUIRED=true`, inject that flag only in the official Pages deploy workflow, keep unsigned environments runnable but unverified, and set Pages headers so `/*` is `no-store` while `/assets/*` first clears inherited cache headers and then sets immutable caching.
**Reasoning**: This preserves the fail-closed guarantee where it is trustworthy and intentional, restores local preview/manual deploy usability, and prevents stale HTML/bootstrap shells from surviving across deployments while still allowing aggressive caching for hashed assets.
**Trade-offs**: Manual deploys only get the `Verified Release` UX if they explicitly replicate the signed-release build flow, and the trust model remains tied to deployment discipline rather than a universal browser-side guarantee.
## [2026-03-08] Separate sender delete, receiver local burn, and channel expiry semantics

**Decision**: Treat sender delete, receiver-local plaintext burn, and TTL expiry as three distinct product concepts
**Context**: UI copy and internal guidance had drifted into read-implies-channel-burn wording even though the frontend already supported local plaintext removal without ending a delivered channel
**Options Considered**: Collapse burn into channel terminal state; keep current behavior but retain ambiguous wording; explicitly separate all three concepts
**Choice**: Explicitly separate all three concepts
**Reasoning**: This matches the existing frontend behavior, preserves re-decrypt after local plaintext removal, and makes deleted vs expired terminal states understandable on both sender and receiver pages
**Trade-offs**: Existing internal guidance and todos need terminology cleanup to avoid reintroducing the old wording
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
- Secure Share = merged Standard+Strict (UV=required; original planning said `RK=required`, but the landed registration policy was later corrected to `residentKey: 'discouraged'`)
- Hardware-Only attestation enforcement (x5c) was technically broken and complex to fix
- Legacy profiles (standard/strict/hardware_only) kept for backward-compatible reads
**Implementation**:
- New `SECURITY_PROFILE.QUICK` and `SECURITY_PROFILE.SECURE` constants
- `adminMode: 'password'` replaces `'softkey'` as canonical name for Quick Share
- Backend treats `'password' || 'softkey'` identically for compound commits
- Hardware-only enforcement removed from backend (attestation: 'none' always)
- All 5 profile values remain valid in schemas for backward compatibility
**Trade-offs**: Legacy channels with hardware_only profile lose the cross-platform authenticator restriction and attestation enforcement (was already broken in practice)
**Follow-up (2026-03-11)**: The two-profile product decision still stands, but the shipped Secure Share registration policy uses non-discoverable credentials (`residentKey: 'discouraged'`). The earlier `RK=required` wording above reflected pre-landing intent and is superseded by the implementation that shipped on `main`.
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
## [2026-03-03] Follow-up fixes must stay on the existing open PR branch

**Decision**: When the current branch already maps to an open PR and the task is addressing that PR's review, comments, or follow-up regressions, continue on that branch instead of creating a new branch and PR.
**Context**: A review-driven fix was mistakenly moved to a child branch with a second PR, even though the work belonged on PR85.
**Options Considered**: Always create a fresh branch for every change; use stacked PRs for all follow-up fixes; continue on the existing PR branch unless a stacked PR is explicitly requested.
**Choice**: Keep review-driven fixes on the existing open PR branch by default, and only split them into a new PR when the user explicitly asks for stacked PRs.
**Reasoning**: This keeps the review conversation, diff, and fixes in one place and avoids redundant PR churn.
**Trade-offs**: Agents must do a quick branch/PR check before applying the generic "new branch for every change" rule.
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
1. Every `feat` or `fix` commit must bundle updates to the durable session files when needed. The original rule referenced `active.md/completed.md`; after the 2026-03-11 simplifications, the practical paths are `decisions.md` and `code-landmarks.md` when rationale or navigation context changes.
2. PR templates and AI instructions (`CLAUDE.md`) will enforce this.
**Status**: Implemented in `CLAUDE.md`. Enforced from PR #83 onwards.
## [2026-03-02] Cloudflare Durable Objects Pricing Update

**Decision**: Support Cloudflare Durable Objects Free Tier with SQLite backend.
**Rationale**: Cloudflare introduced a free tier for Durable Objects (100k requests/day) specifically for the SQLite storage backend. This significantly lowers the barrier to entry for self-hosting ZeroLink.
**Status**: Implemented in docs and README. PR #82 merged.
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
**Context**: Need race-free channel lifecycle enforcement for sender deletion and TTL expiry without conflating receiver-local plaintext removal
**Options Considered**: Vercel serverless + Redis, AWS Lambda + DynamoDB, Cloudflare Workers + DO
**Choice**: Cloudflare Workers + Durable Objects
**Reasoning**: DO provides strong consistency within a single location; a good fit for ordered state transitions and terminal-state enforcement; global edge deployment; no separate database
**Trade-offs**: Cloudflare vendor lock-in; DO has location constraints
## [2026-02-24] URL fragment for key material

**Decision**: Store lock_secret/decryption key in URL fragment (#)
**Context**: Need to share key with recipient without server ever seeing it
**Options Considered**: Query params (server-visible), fragment (#, browser-only), out-of-band channel
**Choice**: URL fragment
**Reasoning**: Browsers never send fragments to servers (HTTP spec); recipient copies entire URL; zero-knowledge guarantee
**Trade-offs**: Entire link must be shared intact; no server-side logging of key material (intentional)
