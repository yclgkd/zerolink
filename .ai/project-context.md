# Project Context

## Product
ZeroLink is a zero-knowledge secret sharing tool for passwords, API keys, tokens, recovery codes, private messages, and other sensitive content. The server must never see plaintext secrets or private keys.

## Protocol
1. Create: the sender creates a channel and shares a link with key material in the URL fragment.
2. Lock: the recipient derives local key material and locks the channel.
3. Deliver: the sender encrypts and uploads ciphertext.
4. Decrypt: the recipient decrypts locally and may optionally remove local plaintext from the current device without changing the channel state.

## Packages
- `packages/shared`: types, schemas, crypto helpers, shared constants.
- `packages/frontend`: React app and browser-side protocol orchestration.
- `packages/backend`: Cloudflare Worker, Durable Object state machine (SQLite backend).
- `services/selfhost-api`: Go self-hosted backend (PostgreSQL, native WebAuthn, single-node WebSocket).

## Security Posture
- Never log, store, or transmit plaintext secrets or private keys.
- Keep key material in URL fragments, not query params.
- Use browser-side crypto for encryption and decryption.
- Preserve terminal-state integrity for sender deletion and TTL expiry in the backend.
