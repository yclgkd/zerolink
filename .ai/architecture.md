# Architecture

## Boundaries
- Frontend owns user flows, browser crypto orchestration, and local state.
- Backend owns channel lifecycle, atomic transitions, and ciphertext storage.
- Shared owns schemas, constants, and reusable crypto helpers.

## Frontend
- Package: `packages/frontend/`
- Stack: React, Vite, React Router, Zustand, Zod.
- Keep secret material browser-side and short-lived.

## Backend (Hosted)
- Package: `packages/backend/`
- Stack: Cloudflare Worker, Durable Objects (SQLite backend).
- Durable Objects enforce ordered state transitions and terminal-state guarantees.

## Backend (Self-Hosted)
- Service: `services/selfhost-api/`
- Stack: Go, PostgreSQL, native WebAuthn (`go-webauthn`), in-memory single-node WebSocket fan-out.
- Per-channel advisory-lock transactions (`WithChannelTx`) reproduce Durable Object ordering guarantees.
- Entrypoints: `cmd/selfhost-api` (API server), `cmd/selfhost-migrate` (DB migrations).

## Shared Contracts
- Package: `packages/shared/`
- Define shared request and response shapes in `packages/shared/src/schemas.ts`.
- Use shared types and constants instead of duplicating protocol details.

## Crypto Boundaries
- Use Web Crypto APIs and vetted helpers from `packages/shared/src/crypto/`.
- Do not move secret-handling logic to the server.
- Treat URL fragments as the only acceptable place for shared key material in links.

## Error Handling
- Prefer explicit result values for protocol and crypto flows.
- Preserve current state-machine guarantees and terminal-state handling.
