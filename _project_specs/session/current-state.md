# Current Session State

*Last updated: 2026-03-11*

## Active Task

Propagate the persisted channel `securityProfile` through Manage read paths so sender actions use the real channel policy.

## Current Status

- **Phase**: Manage follow-up fix implemented on `fix/secure-share-padding`
- **Progress**: `publicStatus`, `compoundBegin`, and WebSocket `state_changed` now carry the stored `securityProfile`, and the sender Manage flow persists that profile in local state instead of inferring it from `adminMode`. Legacy WebAuthn `standard` channels now keep their original 4 KB delivery padding and sender policy when a Manage link is reopened.
- **Known Constraint**: `packages/shared/src/crypto/aes.ts` still defaults generic AES-GCM callers to 4 KB by design; profile-specific callers must continue to pass `padBlock` explicitly, and Manage actions stay disabled until the real `securityProfile` is loaded.

## Latest Update (2026-03-11)

- `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/ws.ts`, `packages/backend/src/do/SecretVault.ts`, `packages/backend/src/do/SecretVaultWebSocket.ts` — Extended the Manage/public read contracts so `PublicStatusResponse`, `CompoundBeginResponse`, and WebSocket `state_changed` snapshots all expose the persisted channel `securityProfile` instead of forcing the frontend to reconstruct it from `adminMode`.
- `packages/frontend/src/stores/deliver-store.ts`, `packages/frontend/src/sync/channel-sync.ts`, `packages/frontend/src/pages/ManagePage.tsx` — Added `securityProfile` to sender Manage state, threaded it through initial public fetch, polling/WebSocket sync, and compound begin, and removed the old Manage-side WebAuthn profile inference so sender deliver/delete actions now use the exact backend-stored policy.
- `packages/frontend/src/__tests__/manage-page.test.tsx`, `packages/frontend/src/__tests__/crypto-orchestrator.test.ts`, `packages/frontend/src/sync/__tests__/channel-sync.test.ts`, `packages/backend/src/do/__tests__/SecretVault.test.ts`, `packages/backend/src/do/__tests__/SecretVaultWebSocket.test.ts`, `packages/shared/src/__tests__/schemas.test.ts`, `packages/shared/src/__tests__/ws.test.ts` — Added regression coverage for `securityProfile` propagation across public status, compound begin, realtime updates, and the legacy `standard` Manage flow that must stay on 4 KB padding.
- Validation: `pnpm --filter @zerolink/frontend exec vitest run src/__tests__/manage-page.test.tsx src/__tests__/crypto-orchestrator.test.ts src/__tests__/api-client.test.ts src/__tests__/deliver-store.test.ts src/__tests__/decrypt-store.test.ts src/__tests__/share-page.test.tsx src/sync/__tests__/channel-sync.test.ts`, `pnpm --filter @zerolink/backend exec vitest run src/do/__tests__/SecretVault.test.ts src/do/__tests__/SecretVaultWebSocket.test.ts src/__tests__/index.test.ts`, `pnpm --filter @zerolink/shared exec vitest run src/__tests__/schemas.test.ts src/__tests__/ws.test.ts`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/backend typecheck`, `pnpm --filter @zerolink/shared typecheck`
- `packages/frontend/src/crypto/orchestrator.ts`, `packages/frontend/src/__tests__/crypto-orchestrator.test.ts` — Added a profile-to-padding resolver on the sender delivery path so Secure Share and its legacy strict/hardware-only equivalents now commit cipher bundles with `padBlock = 8192`, while Quick Share and legacy standard stay at `4096`.
- `_project_specs/session/current-state.md`, `_project_specs/session/decisions.md`, `_project_specs/todos/completed.md` — Recorded the padding policy fix, the decision to keep the shared AES helper default at 4 KB, and the regression validation footprint for future sessions.
- Validation: `pnpm --filter @zerolink/frontend exec vitest run src/__tests__/crypto-orchestrator.test.ts`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/frontend build`, `git diff --check`
- `packages/frontend/src/pages/ManagePage.tsx`, `packages/frontend/src/__tests__/manage-page.test.tsx` — Hid the password-managed channel password prompt during the idle `waiting` state and only reveal it when a sender action actually needs credentials (`locked` delivery or delete confirmation), so the Manage page no longer implies that a password is required before receiver lock.
- `_project_specs/session/current-state.md`, `_project_specs/session/decisions.md`, `_project_specs/todos/completed.md` — Recorded the ManagePage password-prompt visibility rule and validation results for future sessions.
- Validation: `pnpm --filter @zerolink/frontend exec vitest run src/__tests__/manage-page.test.tsx`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/frontend build`
- `.github/workflows/deploy.yml`, `.github/workflows/pr-validate.yml` — Disabled `setup-node@v5` automatic package-manager caching with `package-manager-cache: false`, set `COREPACK_HOME` to `/tmp/corepack`, created a user-space `pnpm` shim under `/tmp/corepack-bin` with `corepack enable --install-directory`, and added that directory to `GITHUB_PATH` so both direct steps and nested package scripts can resolve pnpm.
- Validation: `git diff --check`
- `.github/workflows/deploy.yml`, `.github/workflows/pr-validate.yml` — Replaced Node 20-based `pnpm/action-setup` with a Corepack-based pnpm flow and upgraded `actions/checkout` / `actions/setup-node` to pinned `v5` SHAs so GitHub Actions jobs no longer rely on deprecated Node 20 action runtimes.
- `_project_specs/session/current-state.md`, `_project_specs/session/decisions.md`, `_project_specs/todos/completed.md` — Recorded the CI runtime migration, validation results, and the release-signing constraint for future sessions.
- Validation: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `VITE_RELEASE_VERIFICATION_REQUIRED=true pnpm --filter @zerolink/frontend build`, `pnpm build`, `pnpm manifest:generate`, `git diff --check`
- Validation note: `pnpm manifest:verify` currently stops at missing `packages/frontend/dist/manifest.sig`; generating that file requires `pnpm manifest:sign` with the deployment signing secret.
- `packages/frontend/src/pages/ManagePage.tsx`, `packages/frontend/src/__tests__/manage-page.test.tsx` — Hid the sender share-link card for terminal/unavailable Manage states so deleted, expired, and dead-link channels no longer present a misleading copy/share action.
- `_project_specs/session/current-state.md`, `_project_specs/todos/completed.md` — Recorded the terminal-state share-link cleanup for future sessions.
- Validation: `pnpm --filter @zerolink/frontend test -- manage-page`, `pnpm --filter @zerolink/frontend typecheck`, `git diff --check`
- `packages/frontend/src/pages/ManagePage.tsx`, `packages/frontend/src/__tests__/manage-page.test.tsx` — Hid the sender-side delivery composer while a channel is still `waiting`, kept password-managed delete credentials available, and limited delivery-focused UI/tests to `locked` and `delivered` states so the Manage page no longer invites payload entry before receiver lock.
- `packages/frontend/src/pages/ManagePage.tsx`, `packages/frontend/src/__tests__/manage-page.test.tsx` — Fixed realtime terminal handling so the current sender tab keeps its local deleted confirmation, remote delete/expire events render the unavailable state, and stale `/api/public/:uuid` warnings are cleared when a good realtime state arrives.
- `packages/backend/src/do/SecretVault.ts`, `packages/backend/src/do/SecretVaultWebSocket.ts`, `packages/backend/src/do/__tests__/SecretVault.test.ts`, `packages/backend/src/do/__tests__/SecretVaultWebSocket.test.ts`, `packages/backend/src/__tests__/index.test.ts` — Rejected `/ws` upgrades for missing or terminal channels and added a subscribe-time close fallback so dead links do not hold idle Durable Object WebSocket connections open.
- Validation: `pnpm --filter @zerolink/frontend test -- --run src/__tests__/manage-page.test.tsx src/sync/__tests__/channel-sync.test.ts`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/frontend build`, `git diff --check`
- Validation: `pnpm --filter @zerolink/frontend exec vitest run src/__tests__/manage-page.test.tsx`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/backend exec vitest run src/do/__tests__/SecretVault.test.ts src/do/__tests__/SecretVaultWebSocket.test.ts src/__tests__/index.test.ts`, `pnpm --filter @zerolink/backend typecheck`, `git diff --check`
- `packages/backend/src/do/SecretVault.ts`, `packages/backend/src/do/SecretVaultWebSocket.ts`, `packages/backend/src/index.ts`, `packages/shared/src/ws.ts`, `packages/shared/src/constants.ts` — Added Durable Object WebSocket subscribe/broadcast plumbing and shared wire contracts for channel state updates plus terminal close events.
- `packages/frontend/src/sync/channel-sync.ts`, `packages/frontend/src/sync/use-channel-sync.ts`, `packages/frontend/src/features/share/share-logic.ts`, `packages/frontend/src/pages/ManagePage.tsx` — Added WebSocket-first channel sync with `/api/public/:uuid` polling fallback so Share and Manage views react to state changes without reloads; polling now treats `404 NOT_FOUND` as a terminal channel closure.
- `packages/frontend/src/release/tiered-verification.ts`, `packages/frontend/src/__tests__/tiered-verification.test.ts` — Hardened cached Verified Release reuse so cached trust is returned only after re-validating the signed manifest and detached signature; `manifest-hash.txt` is now a freshness hint rather than a trust anchor.
- `packages/frontend/e2e/realtime-sync.spec.ts`, `packages/frontend/e2e/support/mock-api.ts` — Added cross-page Playwright coverage for Manage/Share polling fallback and shared API mock state between browser contexts.
- `_project_specs/session/current-state.md`, `_project_specs/session/decisions.md`, `_project_specs/session/code-landmarks.md`, `_project_specs/todos/completed.md` — Recorded the new sync/runtime-integrity behavior and validation results for future sessions.
- Validation: `pnpm --filter @zerolink/shared typecheck`, `pnpm --filter @zerolink/shared test`, `pnpm --filter @zerolink/backend typecheck`, `pnpm --filter @zerolink/backend test`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/frontend test`, `pnpm --filter @zerolink/frontend build`, `pnpm --filter @zerolink/frontend test:e2e -- e2e/realtime-sync.spec.ts --project=chromium`

## Earlier Update (2026-03-11)

- `.github/workflows/pr-validate.yml` — Added `pull_request.edited` to the PR validation trigger set so retargeting an existing PR to `main` still starts the required `PR Quality`, `PR Build`, and `PR E2E` checks instead of waiting for a new commit.

- `.github/workflows/pr-validate.yml`, `.github/workflows/pr-checklist.yml` — Added PR-only validation jobs (`PR Quality`, `PR Build`, `PR E2E`) on `pull_request` and `merge_group`, and taught the checklist-only workflow to report cleanly for merge groups so required checks stay compatible with merge queue.
- `.github/workflows/deploy.yml` — Kept signed-manifest and deploy steps on `push main`, and excluded `pr-validate.yml`-only changes from triggering the post-merge deploy pipeline.
- `_project_specs/session/decisions.md`, `_project_specs/session/code-landmarks.md`, `_project_specs/todos/completed.md` — Recorded the new “tests/build before merge” policy and the new CI entrypoint for future sessions.
- Validation: `pnpm typecheck`, `pnpm test`, `VITE_RELEASE_VERIFICATION_REQUIRED=true pnpm --filter @zerolink/frontend build`, `pnpm --filter @zerolink/frontend test:e2e`

- `packages/backend/src/crypto/webauthn.ts`, `packages/frontend/src/crypto/webauthn.ts` — Switched passkey registration overlays from resident/discoverable credentials to `residentKey: 'discouraged'`, while keeping profile-specific user verification requirements.
- `packages/backend/src/do/SecretVault.ts`, `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts` — Extended `compound_begin` so WebAuthn-managed channels can return `allowCredentials` derived from the stored `credentialId`, removing the sender manage/update flow's dependence on browser-side credential discovery.
- `packages/frontend/src/crypto/orchestrator.ts`, `packages/frontend/src/mocks/handlers.ts`, `packages/frontend/e2e/support/mock-api.ts` — Threaded `allowCredentials` through deliver/delete assertion requests and updated local mocks to reflect the new contract.
- `packages/frontend/src/pages/CreatePage.tsx` — Defaulted the Create page to Quick Share and added the Secure Share passkey lifecycle hint shown when the Secure mode is selected.
- `packages/frontend/src/pages/ManagePage.tsx`, `packages/frontend/src/__tests__/manage-page.test.tsx` — Stopped deriving sender manage/delete WebAuthn policy from create-page state, resolved it from `/api/public/:uuid` `adminMode`, and disabled action buttons until the channel auth mode is known.
- `packages/frontend/e2e/happy-path.spec.ts`, `packages/frontend/e2e/terminal-state.spec.ts` — Updated passkey-backed E2E flows to wait for Create-page Quick-mode initialization, then switch to Secure Share and assert the mode toggle completed before creating the channel.
- Validation: `pnpm --filter @zerolink/shared typecheck`, `pnpm --filter @zerolink/backend typecheck`, `pnpm --filter @zerolink/frontend typecheck`, `pnpm --filter @zerolink/shared exec vitest run src/__tests__/schemas.test.ts`, `pnpm --filter @zerolink/backend exec vitest run src/crypto/__tests__/webauthn.test.ts src/do/__tests__/SecretVault.test.ts src/__tests__/index.test.ts`, `pnpm --filter @zerolink/frontend exec vitest run src/__tests__/webauthn-adapter.test.ts src/__tests__/create-page.test.tsx src/__tests__/crypto-orchestrator.test.ts src/__tests__/api-client.test.ts`, `pnpm --filter @zerolink/frontend exec vitest run src/__tests__/manage-page.test.tsx`, `pnpm --filter @zerolink/frontend test:e2e -- e2e/happy-path.spec.ts e2e/terminal-state.spec.ts --project=chromium`

## What Was Done

### Phase 18: Restrict the signed manifest to `dist/assets/` runtime outputs
- `scripts/generate-manifest.ts`, `scripts/__tests__/generate-manifest.test.ts` — Switched manifest generation from a root-directory blacklist to an `assets/` whitelist so root documents like `robots.txt` are excluded by construction, while `entryAssetPath` must still resolve to a signed asset bundle.
- `docs/VERIFY.md`, `docs/DEPLOYMENT.md` — Updated the trust-boundary docs to say the signed manifest now covers only `dist/assets/*` runtime build outputs plus the signed bootstrap entry binding.
- Validation: `pnpm exec vitest run scripts/__tests__/generate-manifest.test.ts`, `pnpm manifest:generate`.

### Phase 17: Align CLI manifest verification with browser entry binding
- `scripts/verify-manifest.ts`, `scripts/verify-manifest-metadata.ts`, `scripts/verify-manifest-files.ts` — Made `pnpm manifest:verify` parse the new `entryAssetPath` shape, fail when the manifest metadata is invalid, and compare the signed entry asset against the actual module entry launched by `dist/index.html`.
- `scripts/__tests__/verify-manifest-entry.test.ts`, `scripts/__tests__/verify-manifest.test.ts` — Added regression coverage for missing/unsafe `entryAssetPath` metadata and for mismatches between `manifest.entryAssetPath` and the entry bundle referenced by `index.html`.
- `docs/VERIFY.md` — Updated the CLI verification docs to state that `pnpm manifest:verify` now checks the signed entry binding before file hashes.
- Validation: `pnpm exec vitest run scripts/__tests__/verify-manifest-entry.test.ts scripts/__tests__/verify-manifest.test.ts`, `pnpm manifest:generate`.

### Phase 16: Bind the running bootstrap entry to the signed manifest
- `scripts/generate-manifest.ts`, `scripts/__tests__/generate-manifest.test.ts` — Added `entryAssetPath` extraction from built `index.html`, kept HTML itself out of signed hashes, and enforced that the declared entry bundle is present inside the signed runtime file set.
- `packages/frontend/src/release/manifest.ts`, `packages/frontend/src/release/crypto.ts`, `packages/frontend/src/release/verification.ts` — Split the release verifier into smaller helpers, required `currentEntryUrl` in browser verification, and fail closed when the currently executing bootstrap entry does not match the signed manifest entry.
- `packages/frontend/src/bootstrap.ts`, `packages/frontend/src/bootstrap-entry.ts`, `packages/frontend/src/bootstrap-recovery.ts`, `packages/frontend/src/bootstrap-gate.ts` — Passed `import.meta.url` from the bootstrap entry, added a one-time session-scoped recovery reload for entry mismatches, and kept the blocking gate for repeated or non-recoverable verification failures.
- `packages/frontend/src/__tests__/bootstrap.test.ts`, `packages/frontend/src/__tests__/release-verification.test.ts`, `packages/frontend/src/__tests__/release-verification-entry.test.ts` — Added regression coverage for entry mismatch detection, manifest invalidation when `entryAssetPath` is unsafe, and one-time recovery behavior.
- Validation: `pnpm exec vitest run scripts/__tests__/generate-manifest.test.ts`, `pnpm --filter @zerolink/frontend test -- --run src/__tests__/release-verification.test.ts src/__tests__/release-verification-entry.test.ts src/__tests__/bootstrap.test.ts`.

### Phase 15: Exclude mutable SPA entry HTML from the signed manifest
- `scripts/generate-manifest.ts`, `scripts/__tests__/generate-manifest.test.ts` — Excluded `index.html` from the signed manifest so the release verifier only hashes stable runtime assets, and added regression coverage that locks out SPA entry HTML alongside Pages control files.
- `packages/frontend/src/__tests__/release-verification.test.ts` — Updated the browser-side verification fixture to mirror the real manifest shape by signing immutable assets only, not the mutable SPA entry HTML.
- `docs/VERIFY.md`, `docs/DEPLOYMENT.md` — Updated the verification and deployment docs to describe the new trust boundary: stable runtime assets remain signed, while `index.html` stays outside the manifest because edge platforms can inject request-specific HTML.
- Validation: `pnpm exec vitest run scripts/__tests__/generate-manifest.test.ts`, `pnpm --filter @zerolink/frontend test -- --run src/__tests__/release-verification.test.ts`.

### Phase 14: Release guard cache hotfix
- `packages/frontend/public/_headers`, `packages/frontend/src/__tests__/pages-headers.test.ts` — Restored the SPA entry cache policy from `no-cache` to `no-store` so Cloudflare Pages cannot replay stale HTML across signed deployments, and updated the regression test to enforce the `no-store` invariant while keeping hashed assets immutable.
- Validation: `pnpm --filter @zerolink/frontend test -- --run src/__tests__/pages-headers.test.ts`, `pnpm --filter @zerolink/frontend test -- --run src/__tests__/release-verification.test.ts`, `pnpm --filter @zerolink/frontend build`, `pnpm manifest:generate`.
- Constraint: `pnpm manifest:verify` stops locally at missing `packages/frontend/dist/manifest.sig` because the official signing step depends on the unavailable `MANIFEST_SIGNING_KEY`.

### Phase 13: Receiver lock-flow wording clarification
- `packages/frontend/src/pages/SharePage.tsx`, `packages/frontend/src/components/share/share-steps.tsx` — Reframed the receiver page as an explicit receiver-only flow, renamed the step labels and headings, clarified that the sender created the channel first, and updated the lock/next-step copy so sender and receiver responsibilities are unambiguous.
- Follow-up: `packages/frontend/src/pages/SharePage.tsx`, `packages/frontend/src/components/share/share-page-header.tsx`, `packages/frontend/src/components/share/share-steps.tsx` — Made the page header state-aware so delivered and reopened locked links no longer show waiting-only instructions, and made locked-state next steps generic enough for reload and device-switch scenarios.
- `packages/frontend/src/__tests__/share-page.test.tsx` — Added waiting, locked, and delivered assertions that guard the receiver-specific wording and state-specific follow-up copy.

### Phase 12: Trust Model page clarification and exit navigation
- `packages/frontend/src/pages/TrustPage.tsx`, `packages/frontend/src/__tests__/trust-page.test.tsx` — Reworked the trust copy into six focused cards covering staged server-visible metadata, sender and receiver local storage, physical delete plus tombstone behavior, local burn, and conditional Verified Release semantics, and added footer actions for `Back` and `Create Secure Channel`
- `packages/frontend/src/routes.tsx`, `packages/frontend/src/pages/CreatePage.tsx`, `packages/frontend/src/trust-route-state.ts`, `packages/frontend/src/__tests__/routes-shell.test.tsx` — Added explicit in-app return markers to trust-link navigation, kept the shell CTA on `/trust` as `Back to Create`, and updated route-level coverage so trust-page `Back` returns only to known in-app entries and otherwise falls back to `/`

### Phase 11: Verified Release bootstrap hardening
- `packages/frontend/index.html`, `packages/frontend/src/bootstrap-entry.ts`, `packages/frontend/src/bootstrap.ts`, `packages/frontend/src/main.tsx` — Replaced the direct React entry with a dedicated bootstrap entry that verifies the signed release before dynamically loading the app, and renders fail-closed blocking screens when verification is not trusted.
- `packages/frontend/src/release/public-key.ts`, `packages/frontend/src/release/runtime.ts`, `packages/frontend/src/release/verification.ts` — Added the embedded Ed25519 signing key, the verified-release runtime snapshot, and browser-side manifest/file-hash verification over same-origin runtime assets.
- `packages/frontend/src/components/manifest-info.tsx`, `packages/frontend/src/__tests__/manifest-info.test.tsx`, `packages/frontend/src/__tests__/routes-shell.test.tsx` — Reframed the manifest card as `Verified Release`, made it render only from a verified bootstrap snapshot, and updated the shell expectations for non-verified test/dev paths.
- `packages/frontend/public/_headers`, `packages/frontend/index.html` — Removed Google Fonts from the verified runtime path and added Pages cache directives for control files vs immutable hashed assets.
- `scripts/generate-manifest.ts`, `scripts/__tests__/generate-manifest.test.ts`, `docs/VERIFY.md` — Narrowed the signed manifest to publicly fetchable runtime assets (excluding Pages control files), and updated verification docs to describe the bootstrap verifier and `Verified Release` trust surface.
- `packages/frontend/tools/remove-dev-public-assets.ts`, `packages/frontend/vite.config.ts`, `packages/frontend/tools/remove-dev-public-assets.test.ts` — Added a build-only cleanup step that removes `mockServiceWorker.js` from production `dist` while keeping the MSW worker available from `public/` during local development.
- `packages/frontend/src/__tests__/bootstrap.test.ts`, `packages/frontend/src/__tests__/release-public-key.test.ts`, `packages/frontend/src/__tests__/release-verification.test.ts` — Added coverage for embedded-key parity, browser-side signature/hash verification, and bootstrap gating behavior.
- Review fix: `packages/frontend/src/bootstrap.ts`, `.github/workflows/deploy.yml`, `packages/frontend/public/_headers`, `docs/VERIFY.md`, `docs/DEPLOYMENT.md` — Switched bootstrap verification from “all PROD builds” to an explicit signed-release build flag, injected that flag only in the official Pages deploy workflow, and corrected Pages cache rules so SPA entry requests are `no-store` while hashed assets stay immutable.

### Phase 10: Delete vs local burn vs expiry clarification
- `packages/frontend/src/stores/decrypt-store.ts` — Renamed the receiver-only burn flag to `localPlaintextBurned` so it cannot be confused with channel state
- `packages/frontend/src/components/share/share-steps.tsx` — Updated delivered, deleted, expired, and local-burn copy so the receiver page clearly separates local plaintext removal from channel terminal states
- `packages/frontend/src/pages/ManagePage.tsx` — Replaced user-facing `Destroy` language with `Delete`, and clarified deleted vs expired sender terminal copy
- `packages/frontend/src/__tests__/share-page.test.tsx` — Added assertions that local burn is device-only and that deleted/expired pages use distinct actor and lifetime wording
- `packages/frontend/src/__tests__/manage-page.test.tsx` — Added assertions for `Delete Channel`, `Confirm Delete`, `Deleting...`, and updated deleted/expired copy
- `packages/frontend/e2e/happy-path.spec.ts` — Kept the local burn followed by re-decrypt flow and made the device-only semantics explicit
- `.ai/project-context.md` / `.ai/architecture.md` — Removed decrypt-as-burn wording and narrowed backend guarantees to terminal-state enforcement
- `_project_specs/session/decisions.md` / `_project_specs/todos/*.md` — Replaced read-implies-channel-burn terminology with explicit delete/local-burn/expiry semantics

### Phase 9: Physical delete semantics
- `packages/backend/src/do/SecretVault.ts` — Added full-storage purge helpers, lazy expiry enforcement on reads, dual-purpose alarm scheduling for TTL expiry plus nonce cleanup, and real delete/expire behavior that removes the channel record plus related challenges/nonces instead of persisting `deleted`/`expired`
- `packages/backend/src/do/SecretVaultNonces.ts` — Exposed the next nonce-cleanup deadline so the Durable Object alarm can co-schedule nonce cleanup with channel expiry
- `packages/backend/src/do/__tests__/SecretVault.test.ts` — Added coverage for physical purge, lazy expiry purge on read, and 404 behavior after delete/expiry
- `packages/backend/src/__tests__/index.test.ts` — Added route-level coverage that `NOT_FOUND` propagates from public status and decrypt-fetch endpoints
- `packages/shared/src/schemas.ts` / `packages/shared/src/__tests__/schemas.test.ts` — Narrowed `PublicStatusResponseSchema` to `waiting | locked | delivered` so `deleted`/`expired` remain local-only UI states
- `packages/frontend/src/pages/SharePage.tsx`, `packages/frontend/src/pages/ManagePage.tsx`, `packages/frontend/src/features/share/share-logic.ts` — Treated `404 NOT_FOUND` as channel-unavailable, mapped stale-session errors explicitly, and kept sender-side `deleted` as current-session-only confirmation UX
- `packages/frontend/src/components/channel/channel-unavailable-state.tsx` and page tests — Added dedicated unavailable-state rendering and updated frontend tests for delete/expiry revisits
- `packages/frontend/e2e/support/mock-api.ts` — Updated the stateful API mock so delete physically removes channels and follow-up reads return 404

### Phase 8: Quick Share sender manage fix
- `packages/frontend/src/pages/ManagePage.tsx` — Show the channel password input for both `adminMode: 'password'` and legacy `adminMode: 'softkey'`; remove compatibility-mode wording from manage-page copy
- `packages/frontend/src/__tests__/manage-page.test.tsx` — Added coverage for `adminMode: 'password'`, retained legacy `softkey` coverage, and asserted that WebAuthn-managed channels do not show the password input
- `docs/PRD.md` — Corrected internal protocol field references from `admin_mode` to `adminMode`
- `docs/INDEX.md` — Tightened the v3.0 summary to match the flows that are actually unified in the product

### Phase 7: Documentation alignment
- `README.md` — Replaced 3-mode messaging with Quick Share / Secure Share and updated PRD version reference to v3.0
- `docs/PRD.md` — Replaced stale `GhostLink` brand mention with `ZeroLink`; updated current-state wording around API, WebAuthn policy, and fallback behavior
- `docs/INDEX.md` — Updated current version to v3.0 and replaced outdated FAQ entries about 3 modes / compatibility mode
- `docs/SECURITY.md` — Reframed security model around Quick Share / Secure Share and moved legacy behavior to explicit compatibility context
- `docs/ARCHITECTURE.md` — Replaced Standard / Strict / Hardware-Only overview with current Quick Share / Secure Share architecture

## Previous Work

### Phase 1: Shared Package
- `packages/shared/src/constants.ts` — Added `QUICK` and `SECURE` to `SECURITY_PROFILE`; legacy values retained
- `packages/shared/src/types.ts` — Extended `AdminMode` to include `'password'`; added `CreateFinishPasswordRequest`; updated `SoftkeyCompoundCommitRequest.adminMode` to `'password' | 'softkey'`
- `packages/shared/src/schemas.ts` — Added `quick/secure` to `SecurityProfileSchema`; `AdminModeSchema` includes `'password'`; added `CreateFinishPasswordSchema`; `SoftkeyCompoundCommitRequestSchema` uses `z.enum(['password', 'softkey'])`
- `packages/shared/src/__tests__/schemas.test.ts` — 191 tests pass

### Phase 2: Backend
- `packages/backend/src/do/SecretVaultTypes.ts` — `SoftkeyCompoundCommitParams.adminMode: 'password' | 'softkey'`
- `packages/backend/src/do/SecretVault.ts` — `commitCreate` handles `'password'` same as `'softkey'`; removed hardware_only attestation enforcement; UV required for `secure/strict/hardware_only`; compound path uses `isPasswordMode = adminMode === 'password' || adminMode === 'softkey'`
- `packages/backend/src/crypto/webauthn.ts` — `generateCreationOptions` accepts `securityProfile: string`; strict UV/RK for `secure/strict/hardware_only`; always `attestation: 'none'`
- `packages/backend/src/do/__tests__/SecretVault.test.ts` — Updated 3 tests for removed attestation enforcement; 111 tests pass

### Phase 3: Frontend Crypto
- `packages/frontend/src/crypto/webauthn.ts` — `SECURE/STRICT/HARDWARE_ONLY` all get `UV=required, RK=required, attestation=none`; `QUICK` and `STANDARD` allow fallback
- `packages/frontend/src/crypto/orchestrator.ts` — `createFinish` uses `adminMode: 'password'`; deliver/delete treat `'password' || 'softkey'` as password mode

### Phase 4: Frontend UI
- `packages/frontend/src/components/create/security-profile-card.tsx` — Added `quick` and `secure` configs; legacy configs kept with "(Legacy)" suffix
- `packages/frontend/src/pages/CreatePage.tsx` — Complete rewrite: 2-mode selector (Quick/Secure), `QuickSharePasswordPanel`, no more CompatibilityPanel/DowngradeDialog

### Phase 5: Tests
- `packages/frontend/src/__tests__/create-page.test.tsx` — Full rewrite for new 2-mode UI (19 tests)
- `packages/frontend/src/__tests__/security-profile-card.test.tsx` — Updated titles to include "(Legacy)"
- `packages/frontend/src/__tests__/webauthn-adapter.test.ts` — Updated hardware_only policy expectations

### Phase 6: Documentation
- `docs/PRD.md` → Updated to v3.0; Section 4 replaced with Quick/Secure; Section 9 updated; Appendix G & I updated
- `_project_specs/session/decisions.md` → Added decision entry for security mode restructuring

## Files Modified

| File | Change |
|------|--------|
| `packages/shared/src/constants.ts` | Added QUICK/SECURE profiles |
| `packages/shared/src/types.ts` | Extended AdminMode, added CreateFinishPasswordRequest |
| `packages/shared/src/schemas.ts` | Updated schemas for new profiles and adminMode |
| `packages/shared/src/__tests__/schemas.test.ts` | Added tests for new schemas |
| `packages/backend/src/do/SecretVaultTypes.ts` | Updated adminMode type |
| `packages/backend/src/do/SecretVault.ts` | Removed attestation enforcement, handled 'password' |
| `packages/backend/src/crypto/webauthn.ts` | Updated UV/RK logic, removed hardware attestation |
| `packages/backend/src/do/__tests__/SecretVault.test.ts` | Fixed 3 tests |
| `packages/frontend/src/crypto/webauthn.ts` | Updated policy for new profiles |
| `packages/frontend/src/crypto/orchestrator.ts` | Updated adminMode usage |
| `packages/frontend/src/components/create/security-profile-card.tsx` | Added quick/secure configs |
| `packages/frontend/src/pages/CreatePage.tsx` | Full rewrite for 2-mode design |
| `packages/frontend/src/__tests__/create-page.test.tsx` | Full rewrite for new UI |
| `packages/frontend/src/__tests__/security-profile-card.test.tsx` | Updated legacy title expectations |
| `packages/frontend/src/__tests__/webauthn-adapter.test.ts` | Updated hardware_only expectations |
| `docs/PRD.md` | Updated to v3.0 |
| `_project_specs/session/decisions.md` | Added decision entry |

## Next Steps

All prior next steps are complete:
- [x] `dist/assets/` whitelist shipped in PR #124 and validated in CI
- [x] Staging redeployed; custom domain no longer fails on Cloudflare-mutated root documents
- [x] No remaining mutable files inside the signed asset boundary

## Earlier Update (2026-03-10)

- Confirmed the custom staging domain was still failing because Cloudflare mutates `robots.txt` while leaving the signed `/assets/*` runtime files unchanged.
- Narrowed the planned trust boundary again so the signed manifest will whitelist `dist/assets/*` runtime outputs instead of signing mutable root documents.
- Aligned `pnpm manifest:verify` with the browser trust model so release validation now fails if `entryAssetPath` is missing, unsafe, or disagrees with the entry bundle referenced by `dist/index.html`.
- Added `entryAssetPath` to the signed manifest so the browser can prove the currently executing bootstrap entry bundle belongs to the same signed release as the hashed runtime assets.
- Kept `index.html` outside the signed hash list to tolerate Cloudflare-injected HTML mutations, but added a one-time session reload when the running entry bundle does not match the signed manifest entry.
- Split the browser verifier/bootstrap helpers to keep the implementation readable while preserving fail-closed behavior after a single unsuccessful recovery attempt.
- Re-ran the focused manifest-generation and bootstrap/release-verification unit tests locally after the entry-binding follow-up.

## Latest Update (2026-03-10)

- Reproduced the post-merge staging failure in a real browser and confirmed the signed `manifest.json` still listed `index.html`, but Cloudflare was serving request-mutated HTML for both `/` and `/index.html`.
- Verified that the staging HTML bytes differ from the manifest because the edge layer injects request-specific challenge markup into the bootstrap shell, which makes `index.html` an unstable signing target even after restoring `Cache-Control: no-store`.
- Updated manifest generation and tests so signed releases now cover stable runtime assets only, excluding `index.html` alongside Pages control files.
- Aligned the verification/deployment docs and `_project_specs` notes with the narrower trust boundary, and re-ran the focused manifest-generation and browser verification unit tests locally.

## Latest Update (2026-03-09)

- Clarified the receiver-side step flow so the UI now says the sender created the channel first and the receiver is setting their own local passphrase and lock.
- Fixed the receiver share-page follow-up copy so locked and delivered revisits no longer show waiting-only instructions or imply the current device just completed the lock.
- Expanded the Trust Model page into six cards that now describe staged server metadata, sender-side local admin storage, receiver-side IndexedDB state, physical purge plus tombstone delete behavior, and conditional Verified Release semantics.
- Replaced browser-history guessing on `/trust` with explicit in-app return markers so the page `Back` action only returns to known ZeroLink entries and otherwise falls back to Create.
- Kept the release-build hygiene follow-up that removes the MSW worker from production `dist` while preserving verified-release bootstrap behavior and cache rules.
- Implemented a `Create + Shell` entry strategy so the explanation is discoverable both at first use and later revisits.
- Kept the user-facing copy in English to stay consistent with the current frontend UI.
- Trimmed `mockServiceWorker.js` from production `dist` so the MSW worker stays development-only and no longer appears in the signed release artifact set.
- Tightened Verified Release after review so fail-closed bootstrap verification now only runs for explicitly flagged signed-release builds, preventing unsigned `build` / `preview` environments from self-blocking.
- Corrected Cloudflare Pages cache headers so SPA entry HTML is always `no-store`, while hashed asset URLs keep immutable caching without conflicting `Cache-Control` values.

## Latest Update (2026-03-08)

- Added a private Durable Object tombstone for deleted/expired channels so UUIDs remain non-reusable after physical purge.
- Restored `PublicStatusResponse` wire compatibility for legacy `deleted` / `expired` backend payloads while keeping current frontend UX normalized to unavailable.
- Tightened the Playwright stateful API mock so deleted channels return `404 NOT_FOUND` on later public/lock/manage begin requests instead of silently recreating a waiting channel.
- Added backend, frontend, shared, and E2E coverage for tombstone reservation, legacy terminal-state normalization, and post-destroy 404 behavior.
- Added a bootstrap-first Verified Release architecture so the browser verifies the signed manifest and runtime asset hashes before loading the React app, and exposed the verified build details only after a successful boot snapshot is present.

## Latest Update (2026-03-09)
