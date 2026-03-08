# Active Todos

Current work in progress and remaining tasks.

---

## TODO-101: Implement physical deletion for ChannelRecord

**Status**: pending
**Priority**: P0 (Security-critical)

**Description**: Confirm that sender delete and TTL expiry remain explicit channel terminal paths in backend storage semantics, without treating receiver-local plaintext removal as a channel-state transition.

**Files to modify**:
- `packages/backend/src/do/SecretVault.ts` — Keep delete and expiry handling aligned with terminal channel semantics.
- `packages/backend/src/do/SecretVaultStateMachine.ts` — Keep terminal transition rules explicit for delete and expiry.

**Validation criteria**:
- [ ] Delete and expiry remain the only backend-managed terminal channel outcomes.
- [ ] Receiver-local plaintext removal is documented and tested as frontend-only behavior.
- [ ] Backend tests continue to distinguish deleted vs expired terminal handling.

---

## TODO-102: Increase E2E coverage for expiration flow

**Status**: pending
**Priority**: P1

**Description**: Verify that the frontend correctly handles an expired channel (e.g., showing an appropriate error message when trying to lock/deliver).

**Files to create/modify**:
- `packages/frontend/e2e/expiration.spec.ts` — New E2E test case.

**Validation criteria**:
- [ ] Playwright tests pass for simulated expired scenarios.

---

## TODO-103: Automated Signed Manifest in CI

**Status**: in_progress (pending merge)
**Priority**: P2

**Description**: Ensure every build on `main` automatically generates and signs the `manifest.json`.

**Files to modify**:
- `.github/workflows/deploy.yml` — Add signing steps.
