# Backlog

Future work, prioritized. Move to active.md when starting.

---

## TODO-101: Implement full secret creation flow (UI + API)

**Priority**: P2
**Depends on**: TODO-001, TODO-002, TODO-003, TODO-004

Full create flow: user enters secret → WebAuthn optional auth → encrypt → store → generate share URL.

---

## TODO-102: Implement secret decryption flow (UI + API)

**Priority**: P2
**Depends on**: TODO-101

Recipient opens URL → parse fragment → derive key → fetch ciphertext → decrypt → display → burn.

---

## TODO-103: WebAuthn passkey integration

**Priority**: P2
**Depends on**: TODO-002

Optional passkey authentication for secret creation using `@github/webauthn-json`.

---

## TODO-104: Durable Object atomic state for burn-after-read

**Priority**: P2
**Depends on**: TODO-003

Implement single-use enforcement using Durable Object transactions. Secret deleted on first successful read.

---

## TODO-105: TTL and expiry

**Priority**: P3

Secrets auto-expire based on user-selected TTL (1 hour, 24 hours, 7 days).
Scheduled cleanup via Cloudflare Cron Triggers.

---

## TODO-106: Rate limiting and abuse prevention

**Priority**: P3

IP-based rate limiting on secret creation. Cloudflare WAF rules.

---

## TODO-107: E2E Playwright tests

**Priority**: P3
**Depends on**: TODO-101, TODO-102

Full user flow E2E tests: create secret → share link → decrypt → verify burn.

---

## TODO-108: Accessibility audit

**Priority**: P3

WCAG 2.1 AA compliance. Screen reader testing. Keyboard navigation.

---

## TODO-109: Performance optimization

**Priority**: P4

Bundle size analysis. Crypto operations on Web Worker to avoid blocking UI. Lazy route loading.

---

## TODO-110: Production deployment

**Priority**: P4

Custom domain setup. Cloudflare Pages for frontend. Worker deployment pipeline.
