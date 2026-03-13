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

## [2026-03-13] Sender manage flow preserves known Safety Code fingerprint during begin retries

**Decision**: Keep the sender-side `receiverPubFpr` in the deliver store when `compound_begin` enters loading or error states, and only replace it when a fresh `compound_begin`, public-status fetch, or realtime update returns authoritative data.
**Context**: `ManagePage` derives the sender Safety Code directly from `deliver-store.receiverPubFpr`. The previous `startCompoundBegin()` and `failCompoundBegin()` implementations cleared that field immediately, so the first `Deliver` click briefly swapped a valid Safety Code for the generic yellow warning even though the backend still had the receiver fingerprint.
**Options Considered**: Keep clearing the fingerprint and patch the UI to special-case pending state; preserve the last known fingerprint in the shared deliver store begin lifecycle; move Safety Code display to a separate memoized cache outside the store.
**Choice**: Preserve `receiverPubFpr` across `compound_begin` loading and error transitions, while still clearing request-scoped fields such as `challenge`, `currentVersion`, and `receiverPubJwk`.
**Reasoning**: The fingerprint is durable channel state, not request-scoped begin metadata. Keeping it in the store prevents misleading UI flicker on sender manage actions without weakening the authoritative update path.
**Trade-offs**: Delete flows now share the same preserved-fingerprint behavior because they also use `compound_begin`, but any fresh response that truly omits `receiverPubFpr` still overwrites the store and surfaces the warning as before.
**Follow-up (2026-03-13)**: `compound_begin` error handling now preserves `receiverPubFpr` only for loading and non-authoritative/retryable begin failures. Terminal begin errors such as `NOT_FOUND` and `LOCK_FORBIDDEN` clear the cached fingerprint so sender Safety Code UI does not outlive the backend's channel validity.

## [2026-03-13] WebAuthn normalization keeps bracket notation without stale Biome suppressions

**Decision**: Remove unused `biome-ignore lint/complexity/useLiteralKeys` comments from `packages/frontend/src/crypto/webauthn.ts` while keeping bracket notation for `Record<string, unknown>` access.
**Context**: `pnpm lint` was clean on the underlying code path but started failing on `suppressions/unused` because the existing ignores no longer matched any active Biome diagnostic. The file still relies on `Record<string, unknown>` narrowing under `noPropertyAccessFromIndexSignature`, so bracket notation remains the clearest and safest access pattern there.
**Options Considered**: Keep the dead suppressions; switch the accessors to dot notation to satisfy the old comment rationale; remove only the stale comments and preserve the existing runtime/type behavior.
**Choice**: Remove the dead suppressions only.
**Reasoning**: This restores lint cleanliness with the smallest possible diff and avoids touching WebAuthn request normalization logic in a security-sensitive path.
**Trade-offs**: The file keeps explicit bracket access, so future formatter or lint changes should be evaluated against the TypeScript index-signature constraint before reintroducing suppressions.
**Follow-up (2026-03-13)**: In tests that inspect structured log payloads, prefer a tiny explicit object shape over `Record<string, unknown>` when the assertion needs named fields such as `stack_fingerprint`. That avoids a `useLiteralKeys` vs. `noPropertyAccessFromIndexSignature` conflict without needing suppressions.
**Follow-up (2026-03-13)**: Frontend test teardown for receiver-key IndexedDB cleanup now aggregates per-UUID delete failures and throws once cleanup completes. Test-isolation failures are treated as blocking rather than logged or silently ignored, so dirty IndexedDB state surfaces immediately and deterministically.

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
## [2026-03-12] Disable passphrase autofill across frontend flows

**Decision**: Use `autocomplete="off"` on shared passphrase inputs without vendor-specific ignore hints
**Context**: The same passphrase field is reused for channel creation, receiver lock setup, sender delivery, receiver decryption, and password-managed delete confirmation. `autocomplete="new-password"` triggered confusing password-manager prompts in non-signup flows.
**Options Considered**: Keep `new-password` everywhere, split autocomplete by flow, disable autofill across all passphrase prompts, disable autofill plus password-manager ignore hints
**Choice**: Disable autofill across all passphrase prompts
**Reasoning**: ZeroLink passphrases are task-scoped secrets rather than account credentials, so avoiding stale autofill and misleading "set new password" prompts is more important than password-manager generation in these fields. Leaving out vendor-specific ignore hints preserves the user's ability to invoke a password manager intentionally.
**Trade-offs**: Browsers are less likely to offer generated passwords for Quick Share or receiver lock setup, and some password managers may still choose to assist when the user explicitly invokes them.
## [2026-03-13] Share links are shown only on channel creation

**Decision**: Show the receiver share link only in the create success state and remove it from `ManagePage`.
**Context**: `ManagePage` rebuilt `/s/:uuid` without the required `#k=` fragment, producing unusable receiver links. Persisting the fragment locally would extend the lifetime of lock material on the sender device.
**Options Considered**: Restore the fragment from same-tab storage, persist the fragment across sessions, only show the share link at creation time.
**Choice**: Only show the complete share link once, immediately after channel creation.
**Reasoning**: The create flow already has the full `shareUrlWithFragment`, so it can display the correct receiver URL without storing the fragment anywhere else. Removing the share link from `ManagePage` avoids distributing broken links and keeps lock material out of longer-lived local storage.
**Trade-offs**: Senders must save the share link before leaving the create success screen. If they lose it afterward, they need to create a new channel.
