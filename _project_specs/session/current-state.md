# Current Session State

*Last updated: 2026-03-08*

## Active Task
Physical delete semantics plus frontend clarification of sender delete, receiver-local plaintext burn, and channel expiry.

## Current Status
- **Phase**: Conflict-resolved delete/burn/expiry clarification complete, ready for PR
- **Progress**: Backend physically purges deleted and expired channels and returns `404 NOT_FOUND` on revisit; frontend keeps sender-side delete confirmation local to the current session, keeps receiver-side local plaintext burn strictly device-only, and no longer describes decrypt as implicit channel burn in internal guidance.
- **Blocking Issues**: None

## What Was Done

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
1. [ ] Run final verification: biome check + typecheck + all tests
2. [ ] Create PR with all changes
3. [ ] Review and merge

## Latest Update (2026-03-08)

- Added a private Durable Object tombstone for deleted/expired channels so UUIDs remain non-reusable after physical purge.
- Restored `PublicStatusResponse` wire compatibility for legacy `deleted` / `expired` backend payloads while keeping current frontend UX normalized to unavailable.
- Tightened the Playwright stateful API mock so deleted channels return `404 NOT_FOUND` on later public/lock/manage begin requests instead of silently recreating a waiting channel.
- Added backend, frontend, shared, and E2E coverage for tombstone reservation, legacy terminal-state normalization, and post-destroy 404 behavior.
