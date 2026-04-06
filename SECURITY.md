# Security Policy

ZeroLink is a security-focused secret sharing tool. We take vulnerability reports seriously and appreciate responsible disclosure.

## Reporting a Vulnerability

**DO NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

Email: **security@zerolink.dev**

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected component(s): frontend, backend, shared, crypto, protocol
- Impact assessment (your best estimate)
- Suggested fix (optional)

### Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix (critical) | Within 30 days |

Timelines may vary depending on complexity. We will keep you informed of our progress.

### Credit

We will credit reporters in the security advisory unless you prefer to remain anonymous.

## Scope

### In Scope

- Cryptographic implementation flaws
- Key material exposure (logging, network, storage)
- Authentication or authorization bypass
- Protocol-level attacks (replay, reorder, hijack)
- XSS, CSRF, injection in the web frontend
- Server-side information leakage

### Out of Scope

- Denial of service (unless it reveals secrets)
- Social engineering
- Attacks requiring physical access to the user's device
- Vulnerabilities in third-party dependencies (please report upstream and notify us if critical)

## Disclosure Policy

We follow coordinated disclosure:

1. Report the vulnerability privately using the method above
2. Allow us reasonable time to investigate and fix the issue
3. We will coordinate a disclosure timeline with you
4. Do not publicly disclose before we have released a fix or agreed on a timeline

## Security Architecture

For ZeroLink's security model and threat analysis, see [Security Model](./docs/SECURITY.md).
