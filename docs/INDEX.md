> **Language**: English | [中文](./INDEX.zh.md)

# ZeroLink Documentation Index

## Quick Lookup

### I want to learn about...

#### Project Concepts
- **What is this project?** → [README.md](../README.md)
- **How to get started quickly?** → [QUICK_START.md](./QUICK_START.md)
- **How to deploy to Cloudflare?** → [DEPLOYMENT.md](./DEPLOYMENT.md)
- **How to self-host locally?** → [SELF_HOSTED_DEPLOYMENT.md](./SELF_HOSTED_DEPLOYMENT.md)
- **Core value proposition** → [PRD.md § 1. Product Overview](./PRD.md#1-product-overview)
- **User flows** → [PRD.md § 5. User Flows](./PRD.md#5-user-flows-v25-ux-edition)

#### Technical Architecture
- **Overall architecture** → [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Tech stack** → [TECH_STACK.md](./TECH_STACK.md)
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
- **Self-hosted backend contract** → [SELF_HOSTED_CONTRACT.md](./SELF_HOSTED_CONTRACT.md)
- **Lock API** → [PRD.md § Appendix D](./PRD.md#appendix-d-lock-api-schema-v25)
- **Protocol diagrams (Mermaid)** → [PRD.md § 15. Protocol Diagrams](./PRD.md#15-protocol-diagram-mermaid)

#### Implementation Details
- **Canonical specification** → [PRD.md § Appendix B](./PRD.md#appendix-b-canonical-ghost-canon-v1-specification-and-test-vectors-mandatory)
- **Lock precise definition** → [PRD.md § Appendix C](./PRD.md#appendix-c-tofu-lock-sniping-fix-lock-secret--lock-key--lock-proof-precise-definition)
- **Padding format** → [PRD.md § Appendix E](./PRD.md#appendix-e-padding-specification-precise-byte-format--notes)
- **WebAuthn verification** → [PRD.md § Appendix H](./PRD.md#appendix-h-webauthn-verification-byte-level-steps-continuing-v24-with-supplementary-constraints-for-lockprofile)

#### UX Design
- **Safety Code specification** → [PRD.md § Appendix K](./PRD.md#appendix-k-safety-code-visual-specification-emoji--color)
- **WebAuthn unavailable guidance** → [PRD.md § 13.3](./PRD.md#133-guidance-when-webauthn-is-unavailable)

#### Testing
- **Test vectors** → [PRD.md § 14. Test Vectors and Acceptance](./PRD.md#14-test-vectors-and-acceptance-v30)
- **Cross-runtime self-host fixtures** → [SELF_HOSTED_CONTRACT.md § Fixture Consumption Rules](./SELF_HOSTED_CONTRACT.md#fixture-consumption-rules)
- **Security invariants** → [SECURITY.md § Security Invariants](./SECURITY.md#security-invariants-implementation)

#### Build Integrity
- **Verified release process** → [VERIFY.md](./VERIFY.md)
- **Manifest signing** → [DEPLOYMENT.md § Manifest Signing](./DEPLOYMENT.md#manifest-signing-optional)

---

## Reading by Role

### Frontend Developer
1. [QUICK_START.md](./QUICK_START.md) - Set up the project
2. [TECH_STACK.md](./TECH_STACK.md) - Tech stack overview
3. [ARCHITECTURE.md § Data Flow Diagrams](./ARCHITECTURE.md#data-flow-diagrams) - Frontend responsibilities
4. [PRD.md § 7](./PRD.md#7-cryptography-and-data-formats-v25) - Cryptography implementation
5. [PRD.md § Appendix C](./PRD.md#appendix-c-tofu-lock-sniping-fix-lock-secret--lock-key--lock-proof-precise-definition) - Lock Secret implementation
6. [PRD.md § Appendix E](./PRD.md#appendix-e-padding-specification-precise-byte-format--notes) - Padding implementation

### Backend Developer
1. [QUICK_START.md](./QUICK_START.md) - Set up the project
2. [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
3. [SELF_HOSTED_CONTRACT.md](./SELF_HOSTED_CONTRACT.md) - Self-hosted backend contract
4. [PRD.md § 10](./PRD.md#10-api-v30-current) - Full API
5. [PRD.md § Appendix D](./PRD.md#appendix-d-lock-api-schema-v25) - Lock API Schema
6. [PRD.md § Appendix H](./PRD.md#appendix-h-webauthn-verification-byte-level-steps-continuing-v24-with-supplementary-constraints-for-lockprofile) - WebAuthn verification

### Security Auditor
1. [SECURITY.md](./SECURITY.md) - Full security model
2. [SECURITY.md § Attack Scenario Analysis](./SECURITY.md#attack-scenario-analysis) - Threat analysis
3. [SECURITY.md § Security Invariants](./SECURITY.md#security-invariants-implementation) - Audit checkpoints
4. [SECURITY.md § Cryptographic Specification](./SECURITY.md#cryptographic-specification) - Encryption parameters
5. [PRD.md § 14](./PRD.md#14-test-vectors-and-acceptance-v30) - Test vectors

### DevOps / Deployment
1. [DEPLOYMENT.md](./DEPLOYMENT.md) - Full deployment guide
2. [SELF_HOSTED_DEPLOYMENT.md](./SELF_HOSTED_DEPLOYMENT.md) - Docker Compose self-hosting
3. [VERIFY.md](./VERIFY.md) - Build integrity verification

---

## FAQ

### Q: Why use URL Fragment to store lock_secret?
→ [SECURITY.md § TOFU Preemptive Lock](./SECURITY.md#3-tofu-preemptive-lock)

### Q: How does Padding prevent length leakage?
→ [ARCHITECTURE.md § Ciphertext Length Leakage Mitigation](./ARCHITECTURE.md#2-ciphertext-length-leakage-mitigation-padding)

### Q: Can WebAuthn private keys be exported?
→ [SECURITY.md § Admin Private Key Non-Exportable](./SECURITY.md#7-admin-private-key-non-exportable--secure-share)

### Q: Can the server see plaintext?
→ [SECURITY.md § Server Zero-Knowledge](./SECURITY.md#1-server-zero-knowledge-)

### Q: How to prevent man-in-the-middle attacks?
→ [SECURITY.md § Man-in-the-Middle Attack](./SECURITY.md#4-man-in-the-middle-attack-mitm)

### Q: What's the difference between Quick Share and Secure Share?
→ [PRD.md § 4. Product Modes and Security Tiers](./PRD.md#4-product-modes-and-security-tiers-externally-clear)

### Q: How to verify frontend code hasn't been tampered with?
→ [VERIFY.md](./VERIFY.md)
