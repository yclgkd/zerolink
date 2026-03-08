# Active Todos

Current work in progress and remaining tasks.

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
