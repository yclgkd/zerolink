> **Language**: English | [中文](./INDEX.zh.md)

# ZeroLink Documentation Index

> Quick navigation guide for AI assistants and developers

## Document Structure

```
docs/
├── INDEX.md           # This file - Quick index
├── QUICK_START.md     # Quick start guide (zero to running)
├── DEPLOYMENT.md      # Deployment guide (Cloudflare one-click + manual)
├── TECH_STACK.md      # Tech stack specification (toolchain, Monorepo, testing)
├── PRD.md             # Full product requirements document (main document)
├── ARCHITECTURE.md    # Architecture overview
├── SECURITY.md        # Security model
└── VERIFY.md          # Verified release & build integrity
```

---

## Quick Lookup

### I want to learn about...

#### Project Concepts
- **What is this project?** → [README.md](../README.md)
- **How to get started quickly?** → [QUICK_START.md](./QUICK_START.md)
- **How to deploy to Cloudflare?** → [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Core value proposition** → [PRD.md § 1. Product Overview](./PRD.md#1-product-overview)
- **User flows** → [PRD.md § 5. User Flows](./PRD.md#5-user-flows-v25-ux-edition)

#### Technical Architecture
- **Overall architecture** → [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Tech stack specification** → [TECH_STACK.md](./TECH_STACK.md)
- **Monorepo structure** → [TECH_STACK.md § Monorepo Structure](./TECH_STACK.md#monorepo-structure)
- **Three-party role model** → [ARCHITECTURE.md § Three-Party Role Model](./ARCHITECTURE.md#2-three-party-role-model)
- **State machine** → [ARCHITECTURE.md § State Machine](./ARCHITECTURE.md#state-machine)

#### Security Design
- **Threat model** → [SECURITY.md § Threat Model](./SECURITY.md#threat-model)
- **Security objectives** → [PRD.md § 2.1 Security Objectives](./PRD.md#21-security-objectives-mandatory)
- **Attack scenario analysis** → [SECURITY.md § Attack Scenario Analysis](./SECURITY.md#attack-scenario-analysis)
- **Security tiers** → [PRD.md § 4. Product Modes and Security Tiers](./PRD.md#4-product-modes-and-security-tiers-externally-clear)

#### Core Mechanisms
- **Lock Secret (Anti-TOFU)** → [ARCHITECTURE.md § TOFU Preemptive Lock Protection](./ARCHITECTURE.md#1-tofu-preemptive-lock-protection-v25-core)
- **Padding (Anti-Length Leakage)** → [ARCHITECTURE.md § Ciphertext Length Leakage Mitigation](./ARCHITECTURE.md#2-ciphertext-length-leakage-mitigation-padding)
- **Admin Authority (WebAuthn / ECDSA)** → [ARCHITECTURE.md § Product Modes](./ARCHITECTURE.md#product-modes-current-profiles)
- **Intent Binding** → [ARCHITECTURE.md § Intent Binding](./ARCHITECTURE.md#4-intent-binding)

#### Cryptography
- **Encryption scheme** → [PRD.md § 7. Cryptography and Data Formats](./PRD.md#7-cryptography-and-data-formats-v25)
- **Cryptographic specification** → [SECURITY.md § Cryptographic Specification](./SECURITY.md#cryptographic-specification)
- **Protocol constants** → [PRD.md § Appendix A](./PRD.md#appendix-a-parameter-table-and-constants-mandatory)

#### API Protocol
- **Full API definition** → [PRD.md § 10. API](./PRD.md#10-api-v30-current)
- **Lock API** → [PRD.md § Appendix D](./PRD.md#appendix-d-lock-api-schema-v25)
- **Protocol diagrams (Mermaid)** → [PRD.md § 15. Protocol Diagrams](./PRD.md#15-protocol-diagram-mermaid)

#### Implementation Details
- **Canonical specification** → [PRD.md § Appendix B](./PRD.md#appendix-b-canonical-ghost-canon-v1-specification-and-test-vectors-mandatory)
- **Lock precise definition** → [PRD.md § Appendix C](./PRD.md#appendix-c-tofu-lock-sniping-fix-lock-secret--lock-key--lock-proof-precise-definition)
- **Padding format** → [PRD.md § Appendix E](./PRD.md#appendix-e-padding-specification-precise-byte-format--notes)
- **WebAuthn verification** → [PRD.md § Appendix H](./PRD.md#appendix-h-webauthn-verification-byte-level-steps-continuing-v24-with-supplementary-constraints-for-lockprofile)

#### UX Design
- **Softened fingerprint verification** → [PRD.md § 13.1](./PRD.md#131-softened-fingerprint-verification-presentation)
- **Safety Code specification** → [PRD.md § Appendix K](./PRD.md#appendix-k-safety-code-visual-specification-emoji--color)
- **WebAuthn unavailable guidance** → [PRD.md § 13.3](./PRD.md#133-guidance-when-webauthn-is-unavailable)

#### Testing
- **Test vectors** → [PRD.md § 14. Test Vectors and Acceptance](./PRD.md#14-test-vectors-and-acceptance-v30)
- **Security checklist** → [SECURITY.md § Security Checklist](./SECURITY.md#security-checklist-implementation)

#### Build Integrity
- **Verified release process** → [VERIFY.md](./VERIFY.md)
- **Manifest signing** → [DEPLOYMENT.md § Manifest Signing](./DEPLOYMENT.md#manifest-signing-optional)

---

## Reading by Role

### Product Manager
1. [README.md](../README.md) - Project overview
2. [PRD.md § 1-5](./PRD.md) - Product definition, flows, UX
3. [PRD.md § 4](./PRD.md#4-product-modes-and-security-tiers-externally-clear) - Security tiers
4. [PRD.md § 13](./PRD.md#13-uiux-specification-implementing-product-manager-recommendations) - UI/UX specification

### Frontend Developer
1. [QUICK_START.md](./QUICK_START.md) - Initialize project
2. [TECH_STACK.md](./TECH_STACK.md) - Full tech stack specification
3. [ARCHITECTURE.md § Data Flow Diagrams](./ARCHITECTURE.md#data-flow-diagrams) - Frontend responsibilities
4. [PRD.md § 7](./PRD.md#7-cryptography-and-data-formats-v25) - Cryptography implementation
5. [PRD.md § Appendix C](./PRD.md#appendix-c-tofu-lock-sniping-fix-lock-secret--lock-key--lock-proof-precise-definition) - Lock Secret implementation
6. [PRD.md § Appendix E](./PRD.md#appendix-e-padding-specification-precise-byte-format--notes) - Padding implementation

### Backend Developer
1. [QUICK_START.md](./QUICK_START.md) - Initialize project
2. [TECH_STACK.md § Deployment & Release](./TECH_STACK.md#deployment--release) - Cloudflare Workers configuration
3. [ARCHITECTURE.md § Technology Stack](./ARCHITECTURE.md#3-technology-stack) - Backend architecture
4. [PRD.md § 10](./PRD.md#10-api-v30-current) - Full API
5. [PRD.md § Appendix D](./PRD.md#appendix-d-lock-api-schema-v25) - Lock API Schema
6. [PRD.md § Appendix H](./PRD.md#appendix-h-webauthn-verification-byte-level-steps-continuing-v24-with-supplementary-constraints-for-lockprofile) - WebAuthn verification

### Security Auditor
1. [SECURITY.md](./SECURITY.md) - Full security model
2. [SECURITY.md § Attack Scenario Analysis](./SECURITY.md#attack-scenario-analysis) - Threat analysis
3. [SECURITY.md § Security Checklist](./SECURITY.md#security-checklist-implementation) - Audit checkpoints
4. [PRD.md § 14](./PRD.md#14-test-vectors-and-acceptance-v30) - Test vectors
5. [SECURITY.md § Cryptographic Specification](./SECURITY.md#cryptographic-specification) - Encryption parameters

### DevOps / Deployment
1. [DEPLOYMENT.md](./DEPLOYMENT.md) - **Full deployment guide (one-click + manual)**
2. [DEPLOYMENT.md](./DEPLOYMENT.md) - GitHub Actions and release process
3. [TECH_STACK.md § Deployment & Release](./TECH_STACK.md#deployment--release) - Frontend and backend deployment
4. [TECH_STACK.md § Release Pipeline](./TECH_STACK.md#version-management--release-pipeline) - PR validation and tag releases
5. [VERIFY.md](./VERIFY.md) - Build integrity verification

---

## Version History

### v3.0 (Current)
- **Core improvements**: Lock Secret (URL Fragment) + Padding + Argon2id enforced
- **New**: Quick Share (Password) / Secure Share (Passkey) dual-mode creation
- **New**: Verifiable release chain design
- **Refined**: Create and sender management flows unified into Quick Share / Secure Share; legacy tiers retained only for backward compatibility

### v2.4 (Previous)
- WebAuthn admin authority + DO atomicity + Intent Binding

### v2.3 (Earlier)
- ECDSA software key management

---

## FAQ Quick Reference

### Q: Why use URL Fragment to store lock_secret?
→ [SECURITY.md § TOFU Preemptive Lock](./SECURITY.md#3-tofu-preemptive-lock)

### Q: How does Padding prevent length leakage?
→ [ARCHITECTURE.md § Ciphertext Length Leakage Mitigation](./ARCHITECTURE.md#2-ciphertext-length-leakage-mitigation-padding)

### Q: Can WebAuthn private keys be exported?
→ [SECURITY.md § Admin Private Key Non-Exportable (Secure Share)](./SECURITY.md#7-admin-private-key-non-exportable--secure-share)

### Q: Can the server see plaintext?
→ [SECURITY.md § Server Zero-Knowledge](./SECURITY.md#1-server-zero-knowledge-)

### Q: How to prevent man-in-the-middle attacks?
→ [SECURITY.md § Man-in-the-Middle Attack](./SECURITY.md#4-man-in-the-middle-attack-mitm)

### Q: How are Argon2id parameters chosen?
→ [SECURITY.md § Cryptographic Specification § KDF](./SECURITY.md#cryptographic-specification)

### Q: How to verify frontend code hasn't been tampered with?
→ [VERIFY.md](./VERIFY.md) and [PRD.md § 12. Frontend Integrity](./PRD.md#12-frontend-integrity-and-verifiable-release-chain-ceiling-solution-for-malicious-js-delivery)

### Q: What's the difference between Quick Share and Secure Share?
→ [PRD.md § 4. Product Modes and Security Tiers](./PRD.md#4-product-modes-and-security-tiers-externally-clear)

### Q: How are legacy tiers and old softkey channels handled?
→ [PRD.md § 4. Product Modes and Security Tiers](./PRD.md#4-product-modes-and-security-tiers-externally-clear)

### Q: How to initialize the Monorepo?
→ [QUICK_START.md](./QUICK_START.md)

### Q: Why choose pnpm Monorepo?
→ [TECH_STACK.md § Design Principles](./TECH_STACK.md#design-principles)

### Q: How is the testing system designed?
→ [TECH_STACK.md § Testing System](./TECH_STACK.md#testing-system)

---

## AI Assistant Guide

### When asked "What is ZeroLink?"
→ Read [README.md](../README.md) first, then cite [PRD.md § 1](./PRD.md#1-product-overview)

### When asked "How to prevent XXX attack?"
→ Check [SECURITY.md § Attack Scenario Analysis](./SECURITY.md#attack-scenario-analysis) first, find the corresponding section

### When implementing a feature
1. Check [ARCHITECTURE.md](./ARCHITECTURE.md) for overall architecture
2. Check [PRD.md § 10. API](./PRD.md#10-api-v30-current) for interfaces
3. Check the corresponding appendix for precise byte formats

### When writing tests
→ Check [PRD.md § 14](./PRD.md#14-test-vectors-and-acceptance-v30) and [PRD.md § Appendix B](./PRD.md#appendix-b-canonical-ghost-canon-v1-specification-and-test-vectors-mandatory)

### When reviewing security
→ Follow [SECURITY.md § Security Checklist](./SECURITY.md#security-checklist-implementation) item by item

---

## Documentation Maintenance

### Update Rules
- PRD is the authoritative source (Single Source of Truth)
- ARCHITECTURE.md and SECURITY.md are extracted from PRD, kept in sync
- Any protocol-level changes must update PRD first, then other documents

### Version Control
- Major protocol changes: create new PRD version (e.g., v2.6.md)
- Minor corrections: update current version, note revision date at top
- Deprecated clauses: retain but mark `[Deprecated]`

### Bilingual Maintenance
- English (`.md`) is the primary/authoritative version
- Chinese (`.zh.md`) may lag behind; each Chinese file has a `<!-- synced-with: <hash> -->` comment tracking the English version it was last synced with
- Run `git diff <hash>..HEAD -- docs/X.md` to see what changed since last sync

---

**Last Updated**: 2026-03-21
**Current Version**: v3.0
**Maintainer**: ZeroLink Team
