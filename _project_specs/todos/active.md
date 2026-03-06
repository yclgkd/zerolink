# Active Todos

Current work in progress and remaining tasks.

---

## TODO-101: Implement physical deletion for ChannelRecord

**Status**: pending
**Priority**: P0 (Security-critical)

**Description**: The current `SecretVault.commitDelete()` only performs a logical delete by updating the state. To ensure true "burn-after-read" or sender-initiated destruction, we need to physically remove the `ChannelRecord` from storage.

**Files to modify**:
- `packages/backend/src/do/SecretVault.ts` — Update `commitDelete` and `expire` logic.
- `packages/backend/src/do/SecretVaultStateMachine.ts` — Potentially adjust return types.

**Validation criteria**:
- [ ] `ctx.storage.get(CHANNEL_RECORD_KEY)` returns `undefined` after deletion.
- [ ] Subsequent API calls return 404/Not Found instead of "Locked for terminal state".
- [ ] Unit tests in `SecretVault.test.ts` verify the physical removal.

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
