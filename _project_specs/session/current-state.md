# Current Session State

*Last updated: 2026-03-10*

## Active Task
Hotfix the deployed Verified Release cache regression so signed `index.html` cannot drift from the published manifest after a Pages deploy.

## Current Status
- **Phase**: Release guard cache hotfix complete, ready to push
- **Progress**: Restored the Cloudflare Pages SPA entry cache policy to `no-store`, added a regression test that locks this requirement in, and verified the frontend build plus release-verification tests locally.
- **Blocking Issues**: Official `manifest:sign` / `manifest:verify` validation still requires the deployment-only `MANIFEST_SIGNING_KEY`, which is not available in this local environment.

## What Was Done

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
1. [ ] Push the hotfix branch and open a PR for the cache-header rollback
2. [ ] Re-run deploy checks with the real `MANIFEST_SIGNING_KEY` in GitHub Actions
3. [ ] Redeploy Pages so the SPA entry HTML returns to `Cache-Control: no-store`

## Latest Update (2026-03-10)

- Root-caused the production `Release Verification Failed` screen to the SPA entry cache policy change from `no-store` to `no-cache`, which allowed stale `index.html` responses to drift from the freshly published signed manifest after deploy.
- Restored `packages/frontend/public/_headers` so all SPA entry requests are `Cache-Control: no-store` again, while keeping hashed `/assets/*` responses immutable.
- Added a regression test that fails if the SPA entry cache policy ever drifts away from `no-store`, and re-ran the release-verification unit coverage plus a production frontend build.
- Regenerated `packages/frontend/dist/manifest.json` and `manifest-hash.txt` locally, but could not complete `manifest:sign` / `manifest:verify` without the deployment-only `MANIFEST_SIGNING_KEY`.

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
