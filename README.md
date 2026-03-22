> **Language**: English | [中文](./README.zh.md)

# ZeroLink

> Zero-knowledge secret sharing: no accounts, end-to-end encrypted, sender-managed but never decryptable by the server

## Overview

ZeroLink is a security-first secret sharing tool with the following features:

- **Zero-Knowledge Architecture**: The server never stores plaintext or any private keys
- **End-to-End Encryption**: Only the receiver can decrypt the content
- **Dual Creation Modes**: Quick Share (password) / Secure Share (Passkey)
- **WebAuthn Management**: Secure Share uses system/hardware keys for non-exportable management authority
- **TOFU Protection**: URL Fragment + Lock Challenge prevents race-condition lock hijacking
- **Ciphertext Length Protection**: Padding reduces length-based information leakage
- **Current Product Modes**: Quick Share / Secure Share; legacy mode retained only for backward compatibility

## Core Flow

```
1. Sender → Create (Quick Share password mode / Secure Share Passkey mode)
          → Share link: /s/:uuid#k=<lock_secret>[&af=<sender_auth_fpr>]

2. Receiver → Lock (enter password → generate RSA keypair → store locally)
            → Display Safety Code (Emoji/Color)

3. Sender → Verify Safety Code (out-of-band)
          → Deliver (hybrid encryption + Padding → deliver ciphertext)

4. Receiver → Enter password → Decrypt and view
```

## Documentation

### Getting Started
- [Quick Start Guide](./docs/QUICK_START.md) - From zero to running dev environment
- [Deployment Guide](./docs/DEPLOYMENT.md) - Deploy to Cloudflare (including one-click deploy)
- [Tech Stack Specification](./docs/TECH_STACK.md) - Complete tech stack and toolchain

### Design Documents
- [Full PRD v3.0](./docs/PRD.md) - Product Requirements Document
- [Architecture Overview](./docs/ARCHITECTURE.md) - Technical architecture and core protocols
- [Security Model](./docs/SECURITY.md) - Threat model and security guarantees

### Navigation
- [Documentation Index](./docs/INDEX.md) - Quick navigation for AI assistants and developers

## Tech Stack

### Frontend
- React 19 + Vite 7 + React Router
- Tailwind CSS v4 + shadcn/ui (based on Radix primitives)
- Zustand + Zod
- Web Crypto API (AES-GCM, RSA-OAEP, SHA-256)
- WebAuthn (FIDO2)
- Argon2id (KDF)

### Backend
- Cloudflare Workers + Durable Objects (free tier available, SQLite backend supported) + KV
- Optional: Docker Compose self-hosted (planned, not yet implemented)

## Browser Compatibility

| Browser | Minimum Version | Release Date |
|---------|-----------------|--------------|
| Chrome / Edge | 93+ | September 2021 |
| Firefox | 92+ | September 2021 |
| Safari | 15.4+ | March 2022 |

**Notes**:
- WebAuthn (hardware keys) requires HTTPS; `localhost` works for local development
- Ed25519 signature verification: Chrome 113+ / Safari 16.4+ use native WebCrypto; older versions automatically fall back to pure JS implementation (`@noble/ed25519`)
- No polyfills provided; Internet Explorer is not supported

## Security Features

### v3.0 Current Focus

1. **Lock Secret (URL Fragment)**: Prevents preload crawlers from hijacking locks
2. **Padding (4KB blocks)**: Reduces ciphertext length-based information leakage
3. **Argon2id Enforced**: Receiver private key wrapping (250-500ms target duration)
4. **Dual Creation Modes**: Quick Share (password) / Secure Share (Passkey)
5. **Verifiable Release Chain**: Signed Manifest + runtime hash verification

### Security Guarantees

- Server zero-knowledge
- End-to-end confidentiality
- Update/destroy operations are unforgeable (WebAuthn or ECDSA)
- Replay/reorder/concurrent-overwrite resistant (DO atomicity)
- Minimal metadata leakage
- Frontend integrity verifiable (CSP + Signed Manifest)
- Secure Share management private key is non-exportable (WebAuthn); Quick Share admin key is encoded in the management link

## Deploy

### One-Click Deploy to Cloudflare

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-F4801A?style=for-the-badge&logo=cloudflare&logoColor=white)](https://deploy.cloudflare.com/?url=https://github.com/yclgkd/ZeroLink)

> **Note**: After one-click deploy, run `pnpm setup` to finish KV namespace creation and secrets configuration.

### Prerequisites

- Cloudflare account (free plan is sufficient; Durable Objects free tier supported)
- Node.js 22+ · pnpm 9+ · Wrangler CLI 4+

For full deployment documentation, see the [Deployment Guide](./docs/DEPLOYMENT.md).

---

## Quick Start (Local Dev)

```bash
git clone https://github.com/yclgkd/ZeroLink.git
cd ZeroLink
pnpm install
pnpm dev
```

## License

(TBD)
