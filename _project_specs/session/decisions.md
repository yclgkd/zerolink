<!--
LOG DECISIONS WHEN:
- Choosing between architectural approaches
- Selecting libraries or tools
- Making security-related choices
- Deviating from standard patterns

This is append-only. Never delete entries; archive old batches to archive/ when the file exceeds 800 lines.
-->

# Decision Log

Entries are kept newest-first by heading date. When adding a historical backfill, insert it by date instead of appending it to the bottom.
When later implementation or doc cleanup supersedes a historical claim, annotate the original entry with a dated follow-up instead of silently assuming readers know it is outdated.

## [2026-04-08] Pre-release builds no longer decrypt legacy inline file payloads as files

**Decision**: Remove receiver-side compatibility that upgraded inline `cipherBundle` plaintext into downloadable file payloads. Inline decrypt is now text-only; downloadable file decrypt requires `fileRef` multipart transport.
**Context**: ZeroLink has not launched yet, so there is no released-product requirement to preserve old inline file deliveries. Keeping the compatibility path only widened receiver decrypt semantics and left tests/docs implying support for a transport the product no longer writes.
**Options Considered**: Keep the legacy inline-file decrypt path indefinitely; keep it only for undeclared payloads; remove it completely before launch while preserving multipart file support.
**Choice**: Treat all inline decrypt payloads as text, reject any signed delivery metadata that claims `payloadKind: "file"` while still delivering inline, and keep file payload decoding only on the `fileRef` multipart path.
**Reasoning**: This collapses file handling to one transport invariant: new and readable file deliveries both require `fileRef`. The receiver no longer heuristically upgrades inline ciphertext into file downloads, which simplifies the protocol boundary and reduces compatibility-only surface area before launch.
**Trade-offs**: Any local fixtures or seeded channels that still carry historical inline file envelopes now surface as raw text instead of downloadable files, or fail integrity checks if they simultaneously claim `payloadKind: "file"`. That break is acceptable because no released product data depends on the removed path.

## [2026-04-02] Tag releases package the verified frontend build into published self-host web images

**Decision**: Keep the release-prep frontend build + manifest generate/sign/verify sequence in `.github/workflows/deploy.yml`, then publish self-host API and web images in parallel while packaging the already-built `packages/frontend/dist` into `zerolink-web` instead of rebuilding it inside the release Docker step.
**Context**: The tag deploy workflow spent almost all of its time in two serial Docker Buildx steps. The web image duplicated frontend work by running `pnpm install` and `pnpm --filter @zerolink/frontend build` inside `deploy/selfhost/frontend.Dockerfile` even though CI had already produced the exact `dist` used for release manifest verification.
**Options Considered**: Keep serial image builds and duplicate the frontend build in Docker; package prebuilt `dist` in the release web image but make local source builds manual; package prebuilt `dist` in CI while preserving local source-build behavior through a dedicated local Dockerfile.
**Choice**: Split tag releases into a shared release-prep job plus parallel API/web image jobs, upload/download the verified frontend `dist` between jobs, make `deploy/selfhost/frontend.Dockerfile` runtime-only with a minimal release-context artifact, and keep local compose source builds on `deploy/selfhost/frontend.build.Dockerfile` via `deploy/selfhost/docker-compose.build.yml`.
**Reasoning**: This removes duplicate frontend compilation from release CI, shortens wall-clock time by letting API/web image publication overlap, and preserves the current local source-build escape hatch for developers.
**Trade-offs**: Published self-host web images now include the same signed `Verified Release` bootstrap gate as the verified CI build, while local compose source builds continue to use the unsigned default build path unless the signed release flow is reproduced manually. The local web source-build path now also carries a dedicated Dockerfile-specific allowlist context so it no longer depends on the repo-root ignore rules staying strict.

## [2026-04-02] Self-host releases default to GHCR images with source-build fallback

**Decision**: Publish versioned `ghcr.io/yclgkd/zerolink-api` and `ghcr.io/yclgkd/zerolink-web` multi-arch images from the tag-driven release workflow, switch `deploy/selfhost/docker-compose.yml` to those published images by default, and keep `deploy/selfhost/docker-compose.build.yml` as the opt-in source-build override.
**Context**: The self-host stack previously required operators to clone the whole repository and perform the full local Go and Node.js build before Docker Compose could start. That was too heavy for the intended "download a Compose file and run it" operator path.
**Options Considered**: Keep source builds as the only supported path; publish images but leave the build-based Compose file as the default; publish images and make them the default while preserving a local-build escape hatch.
**Choice**: Extend `.github/workflows/deploy.yml` so production tag releases also build and push `linux/amd64` + `linux/arm64` GHCR images with Buildx provenance/SBOM attestations. The default self-host Compose file now pulls `latest` or an explicit `ZEROLINK_IMAGE_TAG`, while developers who need source reproducibility can layer in `docker-compose.build.yml`.
**Reasoning**: GHCR matches the repository's existing GitHub-hosted release flow, works with the built-in `GITHUB_TOKEN`, and removes the local toolchain requirement for ordinary operators. Keeping the source-build overlay preserves a trust-minimized path for users who prefer compiling from checked-out source.
**Trade-offs**: Default self-host operators now trust the release pipeline in addition to the published source tree. Attestations improve traceability, but they do not replace independently rebuilding or auditing the source when a stricter trust model is required.

## [2026-04-02] New file deliveries now store bytes only in object storage

**Decision**: Make every new `payloadKind=file` delivery upload encrypted bytes to object storage first and commit only a `fileRef`; keep inline `cipherBundle` file handling only as a decrypt-time compatibility path for already-delivered legacy records.
**Context**: ZeroLink previously mixed two storage semantics for files: small files were encrypted inline into Durable Object state while larger files used multipart object storage. That split complicated limits, cleanup, and protocol validation.
**Options Considered**: Keep the size-based split; move all new file bytes to object storage while preserving legacy decrypt compatibility; remove legacy inline file compatibility entirely.
**Choice**: Standardize new file writes on object storage across hosted and self-hosted runtimes, reject `payloadKind=file` intents that still carry `cipherBundle`, and leave receiver decrypt logic backward-compatible with historical inline file payloads.
**Reasoning**: Files now have one write path, one cleanup model, and one server-side validation rule, while text delivery remains inline and legacy delivered records continue to decrypt without migration.
**Trade-offs**: Deployments without multipart/object-storage support can no longer deliver files at all, so the frontend must surface that capability gap explicitly instead of silently falling back to inline file storage.
**Follow-up (2026-04-08)**: Because the product had not launched and no released data depended on the old path, the receiver-side compatibility for historical inline file payloads was removed. Inline decrypt is now text-only; file decrypt requires `fileRef`.

## [2026-04-02] Hourly Worker sweep now reclaims stale orphan R2 upload chunks

**Decision**: Add a Worker `scheduled` cleanup pass that scans `files/` objects hourly, keeps any chunk still referenced by the channel's active multipart `fileRef`, and deletes only chunks older than the upload-token TTL that are no longer referenced.
**Context**: ZeroLink already deleted multipart R2 chunks when a channel reached a terminal state, but aborted uploads could still leave orphan chunk objects behind because they were written as ordinary `FILE_BUCKET.put(...)` objects rather than native R2 multipart uploads.
**Options Considered**: Rely only on channel terminal-state cleanup; move the fix entirely to bucket lifecycle rules; add an application-level scheduled sweep that understands active channel state and orphan age.
**Choice**: Ship the scheduled sweep in the Worker and configure hourly cron triggers in both production and staging, while keeping the existing channel terminal-state deletion path in place.
**Reasoning**: The Worker can safely distinguish live multipart payloads from abandoned uploads by consulting the channel Durable Object before deleting anything. That preserves current active file shares while reclaiming dead R2 objects that lifecycle rules cannot identify correctly.
**Trade-offs**: The sweep adds periodic R2 listing plus one Durable Object lookup per channel that has stale chunk objects, so cleanup cost scales with abandoned uploads. On lookup failure the job skips that channel to avoid false-positive deletion, which means some orphan objects can survive until the next successful run.

## [2026-04-02] Default hosted file uploads are capped at 5 MiB

**Decision**: Reduce the default hosted `maxFileBytes` policy to 5 MiB, expose the same limit explicitly in `wrangler.toml`, and reject oversize files in the sender UI before delivery starts.
**Context**: The previous hosted default allowed very large multipart uploads, while the sender UI surfaced the inline threshold instead of the real total file limit. That combination made the limit look smaller than it was and left too much room for abuse.
**Options Considered**: Keep the large backend default and only change copy; lower the backend limit but keep delivery-time-only enforcement; lower the backend limit and add immediate sender-side rejection before encryption/upload work begins.
**Choice**: Enforce 5 MiB on both the Worker policy and sender flow, update the Manage page hint to show the total file limit, and keep multipart available only for files within that 5 MiB ceiling.
**Reasoning**: The hosted product gets a predictable abuse boundary, users see the real limit up front, and oversize files fail fast before any encryption or upload work starts.
**Trade-offs**: Hosted multipart sharing now covers a smaller range of files, so larger payloads require a future product decision instead of "just working" through the previous permissive default.


## [2026-04-02] Deploy workflow must fail fast on Cloudflare route and R2 prerequisites

**Decision**: Add a dedicated `pnpm deploy:preflight` step before the frontend build in `.github/workflows/deploy.yml`, and document the Cloudflare token/bucket requirements in the deployment guides.
**Context**: The multipart file-storage rollout added an R2 binding to both production and staging Workers, but the deploy docs still described `CLOUDFLARE_API_TOKEN` as if Worker-only access were sufficient. A real staging deploy then failed late in `wrangler deploy` because the token could not access the environment bucket and the bucket had not been provisioned yet.
**Options Considered**: Keep relying on `wrangler deploy` to surface auth and bucket failures after the build; document the issue only; add a repo-specific preflight that checks the exact Cloudflare APIs ZeroLink needs before spending time building assets.
**Choice**: Introduce `scripts/check-cloudflare-deploy-prereqs.ts`, run it from CI immediately after dependency install, and make it verify Workers API reachability, route access for `zerolink.dev`, and the target environment's R2 bucket before continuing. Update both deployment guides to describe the required token scope and the new fail-fast stage.
**Reasoning**: The failure mode is infrastructure-specific, deterministic, and cheap to detect. Catching it before the frontend build saves CI time and gives a more actionable error than Wrangler's later deploy-time output.
**Trade-offs**: The preflight duplicates a small amount of repo-specific Cloudflare configuration knowledge (zone name and bucket names), so future route or bucket renames must update both `wrangler.toml` and the preflight mapping.
**Follow-up (2026-04-02, review fix)**: The preflight must not rely on read-only Cloudflare endpoints as proof of deploy readiness. It now verifies the current token, inspects its effective allow/deny policies, requires `Workers Scripts Write`, `Workers Routes Write`, and `Workers R2 Storage Write` on the configured resources, and only uses the bucket GET call for existence checking after permission validation passes.
**Follow-up (2026-04-02, CI regression fix)**: Some real account-owned deploy tokens can deploy Workers and R2 bindings but still cannot inspect themselves through Cloudflare's token APIs. The preflight now keeps strict write-scope validation when token introspection is available, but degrades to explicit best-effort Workers/R2 reachability checks plus bucket existence when introspection is denied, so CI no longer blocks legitimate deploy tokens solely on missing token-management visibility.
**Follow-up (2026-04-02, R2 fallback hardening)**: The fallback path must still reject read-only R2 tokens. It now probes `POST /accounts/{account_id}/r2/buckets` with an intentionally invalid bucket name, treats the expected validation rejection as proof that the write endpoint is reachable, and treats auth failures as missing `Workers R2 Storage Write` instead of letting bucket-read visibility pass the preflight.

## [2026-04-02] Self-host multipart initiation must validate real channel UUIDs and storage readiness

**Decision**: Keep self-host multipart upload initiation aligned with the shipped protocol by validating `channelUuid` against the project NanoID format, rejecting uploads when multipart delivery is disabled or the channel does not exist, and gating the bundled MinIO service on its `/minio/health/ready` endpoint instead of the weaker liveness check.
**Context**: The post-review deploy pass found two runtime mismatches in the self-host path: `file/initiate` treated channel UUIDs as raw base64url payloads even though ZeroLink UUIDs are 21-character NanoIDs, and the Docker Compose MinIO healthcheck had been loosened to `/live`, which can report healthy before the object API is ready for bucket initialization.
**Options Considered**: Keep the existing request validator and rely on frontend UUID generation; accept presigned upload requests for any syntactically valid body; keep MinIO startup gated only on liveness.
**Choice**: Introduce a dedicated NanoID-shaped UUID validator in the MinIO filestore package, make the self-host `/api/file/initiate` route enforce `multipartSupported`, `maxChunks`, and channel existence through `PublicStatus`, and restore the Compose healthcheck to `curl .../minio/health/ready`.
**Reasoning**: These checks close a real protocol-compatibility bug for legitimate channel IDs, restore Worker/self-host parity on multipart gating, and make the packaged deployment wait for an actually usable object store before starting the API.
**Trade-offs**: Self-host multipart initiation now depends on the protocol service as well as the file store, and manual clients probing `/api/file/initiate` will see earlier `400/404` rejections instead of opportunistically receiving presigned URLs.

## [2026-04-02] Multipart review fixes favor best-effort cleanup and signed direct chunk downloads

**Decision**: Keep multipart terminalization best-effort on self-hosted MinIO cleanup, and switch Worker chunk downloads to signed per-chunk URLs so `/api/file/dl` no longer re-queries the Durable Object for every chunk.
**Context**: PR #229 review found two correctness issues and several cleanup/perf gaps: plaintext chunk buffers could survive early returns, MinIO cleanup failures could block terminal tombstoning, and Worker chunk downloads performed a redundant Durable Object lookup per chunk.
**Options Considered**: Fail terminalization when object cleanup fails; keep download authorization coupled to per-request Durable Object reads; rely on raw fetch in the frontend multipart decrypt path.
**Choice**: Wipe accumulated plaintext chunks in a single outer `finally`, log-and-continue on MinIO cleanup failures, and authorize Worker downloads with short-lived HMAC-signed chunk tokens returned by `/api/file/fetch`. Also reject `/api/file/initiate` when the channel UUID does not resolve to an existing record.
**Reasoning**: Terminal state persistence is more important than opportunistic object deletion, and signed chunk URLs preserve the untrusted-storage model while removing unnecessary Durable Object pressure on large downloads. Routing multipart downloads through the shared API client keeps frontend tests and error handling consistent.
**Trade-offs**: Signed download URLs add token parsing logic to the Worker, and self-hosted orphan cleanup still depends on later sweep/lifecycle enforcement rather than immediate deletion guarantees.

## [2026-04-02] Worker multipart file delivery keeps one typed contract while storage varies by runtime

**Decision**: Keep the shared multipart protocol centered on typed `fileRef` metadata and the same frontend orchestrator contract, but implement the Cloudflare Worker path with R2-backed chunk upload/download routes and the self-hosted path with MinIO presigned URLs. Worker compound commits now accept `intent.fileRef`, decrypt fetch returns a `payloadTransport` union, and terminal cleanup removes any associated stored chunks before purging channel state.
**Context**: Large file support needed to stay compatible with the existing inline `cipherBundle` flow while avoiding browser-buffered whole-file encryption. The backend also already had a policy/config split that could be extended without forking the frontend protocol per deployment target.
**Options Considered**: Keep inline-only delivery; add a separate frontend protocol for each storage backend; expose raw object-store semantics to the frontend; preserve a single typed multipart contract while moving backend storage coordination behind deployment-specific routes.
**Choice**: Use one contract with `/api/file/initiate`, raw chunk upload, `/api/file/complete`, `/api/file/fetch/:uuid`, and a `payloadTransport: "inline" | "multipart"` response shape, then swap the storage implementation underneath it per runtime. Cloudflare Workers proxy chunk bytes into R2 because bindings do not give us S3-style presigned upload URLs; self-hosted deployments use MinIO presigned PUT/GET so the Go API does not stream chunk bytes.
**Reasoning**: The frontend keeps one orchestrator path, the DO still enforces delivery semantics, and the storage backend can change without widening the user-facing crypto contract. This also keeps terminal deletion / expiry logic responsible for cleaning up stored chunk objects regardless of the deployment.
**Trade-offs**: Multipart now introduces a second payload transport to maintain, and shared code must preserve strict exactly-one semantics between `cipherBundle` and `fileRef`. The Cloudflare Worker path still depends on R2 object lifecycle cleanup, while the self-hosted path depends on MinIO bucket lifecycle and sweep behavior.
**Follow-up (2026-04-02, docs sync)**: Deployment, architecture, contract, PRD, and security docs now explicitly describe the shipped multipart behavior instead of treating large-file transport and self-hosted object storage as future work. Cloudflare docs now call out the required R2 buckets, and self-hosted docs now document the `inline|minio` storage split and the inline threshold guardrail.

## [2026-04-02] Large file delivery uses typed multipart `fileRef` metadata over storage-specific backends

**Decision**: Keep one shared multipart contract (`/api/file/initiate`, raw chunk upload, `/api/file/complete`, `fileRef`, `/api/file/fetch`) across both deployments, but split the storage implementation by runtime: Cloudflare stores encrypted chunks in R2 through Worker-managed upload/download routes, while self-hosted deployments use MinIO presigned URLs for direct client upload/download.
**Context**: Phase-1 file delivery proved the file envelope and policy contract, but inline AES-GCM could only handle small files because the browser had to buffer and encrypt the whole blob. The follow-up needed to support large files without changing the end-to-end trust boundary or forking frontend protocol logic per backend.
**Options Considered**: Keep inline-only delivery; add a second frontend protocol just for object storage; expose raw object-store semantics directly to the frontend; preserve one typed `fileRef` protocol and hide storage differences behind backend-specific coordination endpoints.
**Choice**: Introduce independently encrypted chunks with per-chunk AAD/index binding, return a signed `fileRef` instead of an inline `cipherBundle` for multipart deliveries, and let the backend decide how chunk URLs are issued. Worker/R2 stays proxy-based because the runtime uses bindings instead of S3-style presigned URLs; self-hosted MinIO uses presigned PUT/GET so Go never streams chunk bytes.
**Reasoning**: This keeps the sender/receiver cryptographic flow identical across deployments, preserves zero-knowledge storage semantics because the server only sees encrypted chunks plus typed metadata, and avoids frontend branching on deployment type. It also lets inline text and small-file compatibility stay intact while large-file support scales independently.
**Trade-offs**: The protocol now has two payload transports (`inline` and `multipart`), so decrypt/delivery code must preserve exactly-one semantics between `cipherBundle` and `fileRef`. Self-hosted config must also keep `multipartThresholdBytes` at or below the inline ciphertext ceiling even when `maxFileBytes` is much larger, because only oversized files should switch onto the multipart path.

## [2026-04-01] Receiver-side file decoding requires declared `payloadKind: "file"`

**Decision**: Keep `payloadKind` optional at the transport/schema level for rolling compatibility, but anchored decrypt only treats a payload as a downloadable file when signed delivery metadata explicitly declares `payloadKind: "file"`. Undeclared payloads stay on the raw-text decode path.
**Context**: Review follow-up on phase-1 file sharing found that opportunistically decoding undeclared file envelopes let a custom sender omit `payloadKind` while still getting receiver-side file handling, which undermined deployment file-policy intent even though the backend can only enforce file ceilings for declared file deliveries.
**Options Considered**: Continue heuristic undeclared file decoding; require `payloadKind` immediately for every update intent and risk skew with older text clients; keep the field optional for transport compatibility but require the signed type bit before enabling receiver-side file download behavior.
**Choice**: Preserve optional `payloadKind` in shared contracts and stored proofs, but make decrypt treat undeclared payloads as raw text whenever delivery auth is present. Legacy raw-text flows remain compatible, while current proof-backed file deliveries must declare `payloadKind: "file"` end-to-end.
**Reasoning**: The server cannot inspect ciphertext to infer whether an undeclared payload is really a file, so the safest enforceable boundary is to require the signed type bit before the receiver upgrades decrypted bytes into file metadata and download UX. This closes the practical bypass without breaking historical text deliveries.
**Trade-offs**: Undeclared file-envelope payloads produced by pre-fix builds now surface as raw text instead of downloadable files; that is an intentional compatibility trade to preserve policy semantics.

## [2026-04-01] File-share integrity binds `payloadKind`, but undeclared decrypts must stay backward-compatible

**Decision**: Keep `payloadKind` as an optional signed delivery metadata field for file-aware update intents and proofs, enforce file limits server-side only when `payloadKind === "file"`, and make decrypt fallback opportunistically decode undeclared file envelopes while still treating undeclared text as raw plaintext.
**Context**: Phase-1 file sharing introduced inline file payloads and deployment file-policy contracts, but review uncovered two conflicting requirements: new file deliveries need a backend-enforced type signal so `/api/file_policy` is not advisory only, while historical delivered payloads and tests still exist without `payloadKind`, including legacy text that may begin with `ZLP1`.
**Options Considered**: Require `payloadKind` everywhere immediately and break older payload verification/decrypt flows; ignore `payloadKind` during verification and keep file policy frontend-only; sign `payloadKind` when present, enforce file policy from that signal, and preserve backward compatibility for undeclared deliveries at decrypt time.
**Choice**: Add optional `payloadKind` to update intent / delivery-proof metadata, have frontend always send it for new deliveries, persist it in Worker/self-hosted proofs, and enforce inline file ciphertext ceilings only for declared file deliveries. On decrypt, `declaredKind: "file"` is strict, `declaredKind: "text"` stays raw text, and `declaredKind: undefined` may still decode a valid file envelope but otherwise falls back to raw text.
**Reasoning**: This keeps new file flows verifiable end-to-end and gives the backend a concrete contract to enforce, without stranding historical records or regressing legacy text compatibility. It also avoids leaking filename/size metadata to the server because the type bit is the only new server-visible signal.
**Trade-offs**: Undeclared deliveries remain partially heuristic at decrypt time, so compatibility mode still carries a small ambiguity surface until multipart/object-storage support can rely on stronger typed metadata everywhere.
**Follow-up (2026-04-01)**: Review follow-up later tightened receiver behavior for proof-backed deliveries. When `deliveryAuth` is present, undeclared payloads no longer opportunistically decode as files and instead stay on the raw-text path; see the newer entry above, "Receiver-side file decoding requires declared `payloadKind: \"file\"`."

## [2026-04-01] Phase-1 file sharing stays inline-only, policy-driven, and download-only

**Decision**: Implement the first file-sharing slice on the existing encrypted `cipherBundle` path instead of introducing blob/object storage now. Files are wrapped in an encrypted payload envelope, deployment limits come from a dedicated `/api/file_policy` contract backed by env vars, receiver UI decrypts to local file state, and the browser only downloads after an explicit user click. No inline preview is allowed in this phase.
**Context**: Product direction expanded ZeroLink from text-only secret delivery to arbitrary file delivery, but the immediate requirement was to preserve the zero-knowledge boundary and make file-size limits configurable while leaving room for a later multipart/blob-storage rollout.
**Options Considered**: Keep text-only delivery; add preview-capable file support immediately; build the full multipart/object-storage pipeline now; ship a smaller inline-only file mode first and reject files that exceed the future multipart threshold.
**Choice**: Add a shared text/file payload envelope, expose a per-deployment file policy to the frontend, allow sender-side file selection on Manage, decode to either plaintext or file metadata on Share, and trigger download only through an explicit button. Files above the inline threshold return `MULTIPART_REQUIRED`; files above the deployment max return `FILE_TOO_LARGE`.
**Reasoning**: This preserves the existing trust model because the server still stores only opaque ciphertext, avoids the attack surface of browser-side previews, and creates a clean contract boundary (`filePolicy`, `payload.kind`) that a later multipart implementation can reuse instead of replacing.
**Trade-offs**: Phase 1 still inherits the inline ciphertext ceiling, so deployment max file size is hard-capped to the current plaintext envelope limit until multipart/object storage lands. Self-hosted config and Worker envs now need to stay aligned on file-policy defaults and validation rules.

## [2026-04-01] Keep inline text compatibility while file payloads stay envelope-backed

**Decision**: Preserve raw text delivery bytes for inline text shares, and validate file payloads after envelope metadata is added
**Context**: Phase-1 file delivery introduced a shared payload envelope and a self-hosted protocol body cap, which regressed the published 2 MB text ceiling and let file metadata overflow the inline limit late in the encryption pipeline
**Options Considered**: Keep wrapping text and add a new text oversize error, shrink the advertised file limit globally, or preserve legacy raw text bytes while checking actual file envelope size
**Choice**: Preserve legacy raw text bytes and validate file envelopes before encryption
**Reasoning**: This keeps existing text-share limits stable, fixes the late `CRYPTO_ERROR` failure mode for files, and avoids broadening the protocol surface with new client-visible error codes mid-phase
**Trade-offs**: Text and file payloads now intentionally use different wire encodings until multipart delivery lands

## [2026-04-01] Protect create-success links before resetting the sender flow

**Decision**: The create success summary now gates `Create another` behind link-saved confirmation unless the sender has successfully copied both the one-time share link and the private manage link during the current success view.
**Context**: The success screen exposes two critical links, and the share link is explicitly one-time. Navigating away immediately on `Create another` made it too easy to lose both links before the sender had saved them.
**Options Considered**: Open `Create another` in a new tab; always show a confirmation prompt; force both copy buttons before continuing; only warn when the user has not yet copied both links.
**Choice**: Track successful clipboard writes for each link, allow direct reset only after both copies succeed, and otherwise show a warning-tone confirmation panel that lets the sender cancel or continue intentionally.
**Reasoning**: This keeps the fast path for careful users who already saved both links, while protecting the common accidental-reset case without introducing popup blocking risk or forcing a rigid copy-only workflow.
**Trade-offs**: Users who save links by screenshot or another manual method will see one extra confirmation step before starting a new channel.

## [2026-03-31] Split self-hosted manage protocol flow from payload and crypto helpers to enforce the 800-line limit

**Decision**: Keep `services/selfhost-api/internal/service/protocol_manage.go` focused on transactional manage-flow entrypoints and state transitions, and move payload validation / canonicalization / proof-building / crypto-adjacent helpers into `services/selfhost-api/internal/service/protocol_manage_helpers.go`.
**Context**: PR #220 follow-up fixes included a review finding that `protocol_manage.go` had grown past the repo's hard 800-line limit while also carrying duplicated delivery validation across the WebAuthn and password/softkey branches.
**Options Considered**: Leave the file oversized until a later cleanup; split by auth mode and duplicate shared helpers; keep one flow file and extract the shared manage payload and delivery helpers into a companion file.
**Choice**: Add `validateAndApplyDelivery(...)` for the shared delivery transition path and extract the validation / proof / crypto helpers into `protocol_manage_helpers.go` while preserving package-local access.
**Reasoning**: This keeps the behavior-critical transaction flow readable in one place, removes duplicate delivery validation logic, and satisfies the repo file-size rule without widening the public surface or changing protocol semantics.
**Trade-offs**: The `service` package now spreads manage logic across two files, so future edits need to check both the flow file and the helper file together.

## [2026-03-31] Self-hosted local packaging ships as single-node realtime plus Caddy compose bundle

**Decision**: The self-hosted path now ships a first-party local deployment bundle under `deploy/selfhost/` and exposes `/api/ws/:uuid` from the Go API using an in-memory single-node realtime hub, while keeping the frontend's existing HTTP polling fallback unchanged.
**Context**: Issue #208 required the self-hosted track to stop being a partial backend spike and become an executable local deployment story. The missing gaps were realtime compatibility for the frontend sync client, an opinionated local packaging path, and operator-facing documentation/templates.
**Options Considered**: Keep `/api/ws/:uuid` unimplemented and document polling-only behavior; add Redis/pubsub and multi-node fan-out immediately; implement the frozen WebSocket contract in-process for one-node deployments and defer cross-node broadcast until there is a concrete scaling requirement.
**Choice**: Implement the exact WebSocket contract now with a process-local hub, wire service-layer state transitions to publish `state_changed` / `channel_closed`, package the stack as `db + migrate + api + web` via Docker Compose, and front it with Caddy for SPA fallback plus `/api/*` proxying.
**Reasoning**: This satisfies frontend compatibility and gives operators a runnable self-hosted path without prematurely committing to Redis or a distributed topology. The frontend already has polling fallback, so single-node realtime is a strict improvement over the previous placeholder while preserving a safe degradation path.
**Trade-offs**: Realtime fan-out is intentionally limited to a single API process. Operators who scale the API horizontally will need a later shared pubsub layer to preserve cross-node websocket delivery semantics.

## [2026-03-31] Self-hosted RP_ORIGIN must be stored as a canonical origin, not an arbitrary URL

**Decision**: Self-hosted config loading now parses `SELFHOST_API_RP_ORIGIN` as an origin-only URL, rejects path/query/fragment/userinfo, lowercases scheme and host, and strips default ports before storing it.
**Context**: PR #218 already reused `RP_ORIGIN` for three exact-match boundaries: WebAuthn `clientData.origin`, HTTP `Access-Control-Allow-Origin`, and returned `shareUrl` / `manageUrl`. Review found that the earlier config check only enforced an `http(s)` prefix, so pathful or non-canonical values could pass startup and then fail at runtime in hard-to-debug ways.
**Options Considered**: Keep the loose prefix validation and document the constraint; canonicalize only when generating URLs but leave CORS/WebAuthn to compare raw strings; validate and canonicalize the value once during config load so every downstream consumer sees the same origin.
**Choice**: Normalize once in `internal/config` and fail fast on non-origin URLs.
**Reasoning**: `RP_ORIGIN` is part of the security boundary, not just display configuration. Treating it as an origin instead of a generic URL avoids mismatches between browser-serialized origins and operator-provided environment strings.
**Trade-offs**: Configuration becomes slightly stricter, so previously tolerated but incorrect values such as `https://example.com/app` now fail startup instead of degrading only the create flow later.

## [2026-03-31] Self-hosted protocol HTTP edges must log internals, bound bodies, and preserve terminal audit reasons

**Decision**: The self-hosted Go API now treats protocol-edge hardening as part of the frozen contract boundary: unexpected internal failures still return the generic external `INTERNAL_ERROR`, but retain and log their original cause; protocol JSON bodies are capped at 64 KiB; API responses emit basic security headers plus exact-origin preflight support for the configured `RP_ORIGIN`; packed self-attestation explicitly validates `alg == -7`, invalid signatures, and P-256 curve membership; and terminal tombstones preserve an earlier `deleted` reason instead of being rewritten by later expiry paths.
**Context**: Follow-up review on PR #218 correctly identified a cluster of boundary problems that were individually small but operationally important: masked 500s had become hard to debug, POST bodies were unbounded, self-hosted HTTP responses had weaker edge defaults than the Worker path, packed attestation skipped a spec-required algorithm check, and the tombstone UPSERT could erase delete-vs-expired audit history.
**Options Considered**: Keep the route layer minimal and accept weaker diagnostics/edge hardening for now; fix only the externally visible bugs and defer the operational items; tighten the self-hosted HTTP/store/verifier boundary in one pass while keeping public response shapes stable.
**Choice**: Fix the real issues now, but keep the public contract stable: no new protocol fields, no new auth model, and no optimistic-lock redesign. Cross-origin support remains narrow and opt-in to the configured RP origin rather than becoming a wildcard CORS policy.
**Reasoning**: These changes improve survivability and debuggability without reopening the protocol design. The server still avoids exposing internal failures to clients, but operators now get logs they can act on. Likewise, the store keeps the original terminal reason, which is the only audit-preserving behavior consistent with the Worker semantics.
**Trade-offs**: The HTTP layer now carries a bit more wiring because logger/origin concerns are explicit, and the Go verifier intentionally becomes slightly stricter than the initial Worker parity patch by rejecting malformed packed self-attestation earlier and more explicitly.

## [2026-03-31] Self-hosted protocol INTERNAL_ERROR responses must not expose backend failure details

**Decision**: Self-hosted `create_begin`, `create_finish`, and `public_status` now collapse unexpected backend failures to the generic external message `unexpected internal error` while still returning `INTERNAL_ERROR` / `500`.
**Context**: PR #218 added the first self-hosted protocol routes, but review found that `internalError(err)` preserved `err.Error()` verbatim. Because the HTTP router serializes `ProtocolError.Message`, transaction, database, and verifier failures could leak backend details to clients.
**Options Considered**: Keep the raw error text for easier debugging; make masking conditional on environment; always return the same public-facing `INTERNAL_ERROR` message and rely on server-side logging/status codes for observability.
**Choice**: Always mask unexpected protocol failures behind the same generic message that the Worker returns externally.
**Reasoning**: The self-hosted API should match the frozen contract and production Worker behavior on error exposure. Internal failure text is operational detail, not protocol surface, and leaking it creates unnecessary security and implementation coupling.
**Trade-offs**: Debugging from client-visible responses is less convenient in local development, so operators must rely on server logs and targeted tests rather than raw HTTP error strings.

## [2026-03-31] Self-hosted WebAuthn create_finish must consume the stored challenge and persist a real StoredCredential

**Decision**: Self-hosted `create_finish` now treats WebAuthn finalization as a verifier-backed boundary: it loads the stored `create` challenge inside the same channel transaction as attestation verification and channel persistence, maps missing/invalid challenges to `CHALLENGE_INVALID`, maps verifier failures to `ATTESTATION_UNVERIFIABLE`, and persists only the verifier-derived `StoredCredential` fields (`credentialId`, `publicKey`, `signCount`, `aaguid`, `transports`) instead of raw attestation blobs.
**Context**: PR #218 initially made the self-hosted M3 routes usable, but review found two security/correctness gaps: arbitrary base64-shaped attestation payloads could finalize secure channels without reading the stored challenge, and the stored admin credential omitted the verifier inputs later assertion flows need.
**Options Considered**: Keep deferring all verification and accept raw attestation metadata for now; bolt challenge checks into `protocol.go` but still store opaque WebAuthn payloads; add a small Go-native attestation verifier that mirrors the Worker's current `fmt:none` / packed-self behavior and wire `create_finish` through it.
**Choice**: Add a Go-native verifier in `internal/webauthn`, keep WebAuthn `create_finish` atomic inside one `WithChannelTx(...)` transaction, keep softkey/password create semantics unchanged, and store only the finalized credential material returned by the verifier.
**Reasoning**: This closes the review-blocking downgrade/replay gap without broadening scope into assertion verification or full certificate-chain attestation support. The stored credential shape now matches the shared contract, so later self-hosted manage/delete flows can reuse the same verifier inputs as the Worker path.
**Trade-offs**: The self-hosted Go module now depends on CBOR decoding for attestation parsing, and the verifier still intentionally rejects x5c-backed certificate-chain attestations just like the current Worker implementation. Unlike the Worker's current delete-before-verify sequencing, verifier or persistence failures now roll back the challenge deletion so the waiting channel can be retried instead of being stranded until TTL expiry.

## [2026-03-31] Keep self-hosted M3 create/public status contract-compatible while deferring WebAuthn verification

**Decision**: Implement self-hosted `create_begin`, `create_finish`, and `public_status` in the Go service now, but keep WebAuthn attestation handling at the metadata/persistence boundary instead of attempting full verification before the dedicated verifier lands.
**Context**: Issue #211 needs the first end-user-facing self-hosted routes to work against the existing frontend contract. M2 already added PostgreSQL persistence, but the Go service still returned `501 NOT_IMPLEMENTED` for every protocol route and did not yet have RP configuration for creation options or share/manage URLs.
**Options Considered**: Keep returning placeholders until the full WebAuthn verifier is ready; add ad-hoc route logic directly inside `httpapi`; add a small protocol service that generates creation options, persists the same channel lifecycle fields the frontend expects, and stores opaque attestation metadata for later milestones.
**Choice**: Add `internal/service/protocol.go` as the self-hosted M3 protocol layer, wire `create_begin`, `create_finish`, and `public_status` through `httpapi`, require `SELFHOST_API_RP_ID` and `SELFHOST_API_RP_ORIGIN`, persist `waiting` channels with the same provisional `adminMode=webauthn` / empty-lock-key shape the Worker currently exposes, and store either softkey JWK metadata or raw WebAuthn attestation metadata in `admin_credential` without verifying it yet.
**Reasoning**: This is the smallest change that makes the self-hosted backend usable for frontend create flows and polling-based status sync while preserving current response shapes and terminal-state behavior. Deferring attestation verification keeps M3 scoped and avoids baking half-verified security logic into the request path before the real verifier contract is settled.
**Trade-offs**: Secure create flows currently persist attestation metadata but do not cryptographically verify it yet, so later milestones must replace or enrich the stored credential shape before WebAuthn-backed manage/delete flows can be trusted. The Go service now depends on explicit RP config from the deployment environment because share/manage URLs and browser WebAuthn origin checks are frontend-origin-sensitive.
**Follow-up (2026-03-31, PR #218 review fixes)**: Self-hosted `create_finish` no longer stores raw attestation metadata. A Go-native verifier now consumes the stored create challenge, validates WebAuthn attestation context for `fmt:none` and packed self-attestation, and persists the real `StoredCredential` fields required by later assertion verification.

## [2026-03-31] Model self-hosted channel correctness around one row plus per-channel advisory-lock transactions

**Decision**: Implement M2 for the Go self-hosted backend with four PostgreSQL tables (`channels`, `active_challenges`, `used_nonces`, `terminal_tombstones`), `sqlc`-generated queries, and a `WithChannelTx(...)` helper that acquires a transaction-scoped advisory lock derived from the channel UUID before any correctness-path read/write runs.
**Context**: Issue #213 needs the minimum persistence core that can replace Durable Object ordering guarantees before the create/lock/deliver routes are ported. The store must preserve same-channel serialization, nonce replay protection, lazy expiry finalization, and delete/expire tombstone semantics without dragging in route logic prematurely.
**Options Considered**: Normalize every nested protocol field into many relational tables now; keep using hand-written SQL helpers and add locking later; store the channel as one primary row with JSONB for nested protocol payloads, add dedicated tables only for correctness-sensitive ephemeral state, and generate the query surface with `sqlc`.
**Choice**: Keep the durable state machine centered on a single `channels` row keyed by UUID, store nested credential / receiver / ciphertext payloads as JSONB for now, move challenge lifecycle into `active_challenges`, nonce replay state into `used_nonces`, and terminal outcomes into `terminal_tombstones`. All mutation/read-modify-write correctness paths must go through `WithChannelTx(...)`, which acquires a PostgreSQL advisory transaction lock per channel before running store helpers.
**Reasoning**: This reproduces the important Durable Object guarantees with the smallest reviewable schema. JSONB keeps M2 focused on correctness rather than premature normalization, while separate challenge/nonce/tombstone tables make the anti-replay and terminal-state rules explicit and independently testable. `sqlc` gives later milestones a typed SQL surface without forcing route handlers to own raw query strings.
**Trade-offs**: The schema intentionally favors low-churn protocol portability over perfect relational modeling, so later milestones may still decide to normalize some JSONB fields once route behavior is stable. Advisory locks only serialize callers that use the transaction helper correctly, so future store code must not bypass `WithChannelTx(...)` on correctness-sensitive paths.
**Follow-up (2026-03-31, review fixes)**: Tombstone semantics are now enforced twice: `SaveChannel` refuses writes when a terminal tombstone exists, and PostgreSQL also rejects direct `channels` inserts/updates for tombstoned UUIDs via trigger. The default `pr-validate` workflow now provisions PostgreSQL and runs `services/selfhost-api` Go tests with `SELFHOST_API_TEST_DATABASE_URL` set, so DB-backed correctness tests no longer silently skip in CI.
**Follow-up (2026-03-31, sweep semantics)**: `RegisterNonce` now reuses expired rows via a single upsert instead of delete-then-upsert, `SweepExpiredEphemera(...)` runs inside one SQL transaction so it no longer reports partial success, and the store exposes `SweepExpiredChannels(...)` to proactively finalize expired channel rows into tombstones instead of relying only on lazy read-time purge. Tombstones intentionally remain non-expiring because issue #213 and the existing wire contract both require UUID reservation to preserve delete/expire semantics.
**Follow-up (2026-03-31, lock-safe maintenance)**: Background sweep helpers must honor the same per-channel advisory-lock contract as request-path mutations, so expired-channel and expired-ephemera cleanup now enumerate candidate channel IDs first and then run per-channel cleanup through `WithChannelTx(...)`. Store integration tests also require the dedicated `SELFHOST_API_TEST_DATABASE_URL` and explicitly refuse to truncate a database addressed only by `SELFHOST_API_DATABASE_URL`.

## [2026-03-31] Gate PR validation jobs by changed surface instead of always running Node and Go together

**Decision**: Keep `PR Validate` as the required workflow, but add an initial `changes` job that decides whether the Node/TS quality job, the self-hosted Go/Postgres job, or both should run for a given PR.
**Context**: The repository now contains two mostly independent validation surfaces: the existing pnpm-based frontend/Worker/shared packages, and the nested Go module under `services/selfhost-api/`. Always running both stacks on every PR wastes CI time and runner minutes when a change is clearly isolated to only one side.
**Options Considered**: Keep the current always-run behavior; split into separate workflows with path filters; keep one workflow but gate individual jobs using changed-file detection.
**Choice**: Add a lightweight `changes` job in `.github/workflows/pr-validate.yml` that diffs the PR base/head SHAs on `pull_request`, forces both jobs on `merge_group`, runs the Node/TS job only for package/root JS-TS-fixture changes, runs the Go job only for `services/selfhost-api/**`, and runs both when the workflow itself changes.
**Reasoning**: Job-level gating preserves straightforward branch protection because the same workflow still reports status, while eliminating obviously unnecessary cross-stack validation. For merge queue, forcing both jobs stays conservative and avoids under-validating combined batches.
**Trade-offs**: Path-based gating requires ongoing maintenance as new shared files or toolchain entrypoints appear. If the path map becomes stale, CI can under-run checks until the workflow is updated.
**Follow-up (2026-03-31, trigger boundary fix)**: `biome.json` must not stay in the workflow-level `paths-ignore` list because the `changes` job treats it as part of the Node validation surface. The workflow now always triggers for `biome.json` edits so the Node gate can make the decision instead of suppressing the entire workflow.

## [2026-03-31] Bootstrap the self-hosted Go API around explicit boundaries before protocol code lands

**Decision**: Start the self-hosted Go backend as a separate nested module under `services/selfhost-api/`, using standard-library HTTP + `slog`, `pgxpool` for PostgreSQL connectivity, and an embedded SQL migration runner instead of pulling in a full framework or external migration CLI at M1.
**Context**: Issue #214 needs a local-development-ready service skeleton with config validation, health endpoints, DB bootstrap, and stable package boundaries for later milestones. The repo does not currently ship any Go runtime, local `go` is not guaranteed on every workstation, and M2-M6 will need room to add transaction semantics, protocol routes, WebAuthn verification, and realtime delivery without rewriting the foundation.
**Options Considered**: Introduce a heavier HTTP framework plus a third-party migration tool now; keep everything as docs-only placeholders and defer real runtime wiring to M2; create the smallest runnable service with explicit boundaries and embedded migrations while leaving protocol logic for later milestones.
**Choice**: Add `services/selfhost-api/` as a standalone Go module with `cmd/selfhost-api`, `cmd/selfhost-migrate`, `internal/{app,config,httpapi,service,store,protocol,webauthn,realtime}`, and `migrations/`. Register the frozen protocol routes as `501 NOT_IMPLEMENTED` placeholders, provide `healthz` / `readyz`, and make readiness depend on a real PostgreSQL ping.
**Reasoning**: This keeps the change reviewable while still producing a runnable service. Embedded migrations avoid an extra binary/CLI dependency in the first milestone, placeholder routes freeze the surface area that later milestones will fill in, and a nested module prevents the existing pnpm-based TypeScript build from being entangled with Go-specific tooling prematurely.
**Trade-offs**: Root CI does not automatically execute Go tests yet, and the first migration only bootstraps service metadata rather than the full channel schema. Those pieces are deliberate follow-up work for M2 and later milestones.

## [2026-03-31] Self-hosted manage/decrypt flows live in the Go service layer

**Decision**: Implement the self-hosted `lock_*`, `compound_*`, `delete_commit`, and `decrypt_fetch` flows in `services/selfhost-api/internal/service/` with `store.WithChannelTx(...)` as the correctness boundary, while keeping `internal/httpapi/` limited to contract validation and route alias handling.
**Context**: Issue #209 needed the Go self-hosted backend to reproduce the Worker/Durable Object manage-flow semantics, including version checks, nonce replay rejection, terminal tombstones, decrypt payload reads, and the `delete_commit` alias over compound commit. `origin/main` still lacked these self-hosted paths end-to-end.
**Options Considered**: Recreate state transitions in HTTP handlers; keep WebAuthn verification stubbed and only support password mode; centralize all protocol transitions in the service layer and extend the native verifier to support assertion validation.
**Choice**: Route parsing stays in `httpapi`, state transitions stay in `service`, transactional ordering stays in `store`, and WebAuthn manage-path verification is handled by the native verifier so both password/softkey and WebAuthn admin modes share the same self-hosted protocol surface.
**Reasoning**: This matches the existing package boundaries, keeps protocol drift localized, and preserves the Durable Object ordering model by reusing the advisory-lock transaction helper instead of scattering correctness checks across handlers.
**Trade-offs**: Realtime caller-binding parity is still outside this milestone, and the DB-backed integration tests require `SELFHOST_API_TEST_DATABASE_URL` to run in environments that do not provision PostgreSQL automatically.
## [2026-03-31] Mirror Worker hardening in self-hosted manage flows

**Decision**: Enforce per-channel manage rate limits and strict compound_commit auth payload shapes in the Go self-hosted service
**Context**: PR #219 added self-hosted lock/manage flows but initially missed the Worker abuse controls and request-union hardening
**Options Considered**: Leave validation to callers, add HTTP-only middleware, enforce in the protocol service
**Choice**: Enforce in the protocol service
**Reasoning**: The service layer already owns protocol state transitions, so it is the narrowest place to preserve Worker parity across HTTP handlers and future callers
**Trade-offs**: Rate limiting is process-local instead of Durable Object-local, so multi-instance deployments still need edge or infra throttling for global enforcement

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
**Follow-up (2026-03-31, Go handoff hardening)**: The self-hosted contract doc now freezes three easy-to-misread invariants before the Go port starts: `secure` channels must complete `create_finish` with `webauthn`; `decrypt_fetch.cipherVersion` is the delivered payload version (`record.version - 1` in the current DO implementation), not the raw record version; and tombstoned or lazily purged channels canonically collapse to `404 NOT_FOUND` on public/decrypt/follow-up external requests instead of exposing `200` terminal snapshots as the target behavior.

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
