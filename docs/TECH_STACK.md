> **Language**: English | [中文](./TECH_STACK.zh.md)

# ZeroLink Tech Stack Specification

> **Version**: v1.1
> **Last Updated**: 2026-03-10
> **Status**: Implemented, kept in sync with the main branch

---

## Table of Contents

- [Overview](#overview)
- [Core Tech Stack](#core-tech-stack)
- [Monorepo Structure](#monorepo-structure)
- [Cryptography & Security](#cryptography--security)
- [Development Workflow](#development-workflow)
- [Quality Gates](#quality-gates)
- [Deployment & Release](#deployment--release)
- [Configuration File Inventory](#configuration-file-inventory)

---

## Overview

### Design Principles

1. **Security First**: Type safety + runtime validation for dual-layer protection
2. **Protocol Consistency**: Frontend and backend share critical code (Canonical, constants, Schema)
3. **Fast Feedback**: Vite for rapid development + Vitest for rapid testing
4. **Code Quality**: Biome for unified standards + TypeScript strict + automated checks
5. **Maintainability**: Monorepo + GitHub Actions release pipeline

### Technology Selection Rationale (ZeroLink-Specific)

| Technology | Selection Rationale | ZeroLink Relevance |
|------|---------|--------------|
| **Monorepo** | Protocol-level consistency requirement (Canonical, constants, Schema must be shared) | Prevents catastrophic bugs like intent_hash mismatch between frontend and backend |
| **TypeScript strict** | Prevents cryptographic data type errors (Buffer vs string, etc.) | Type safety is critical for encryption operations |
| **Zod** | Runtime validation + type inference | Defends against malicious server returning unexpected data |
| **Biome** | Unified code style + fast (10-100x faster than ESLint+Prettier) | Extensive cryptographic code requires strict formatting |
| **Vitest** | Seamless integration with Vite + fast | Testing protocol logic like Canonical requires fast feedback |
| **Playwright** | WebAuthn API simulation + cross-browser | Testing the complete Create->Lock->Deliver flow |

---

## Core Tech Stack

### Language & Frameworks

#### React 19 + TypeScript

```json
{
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "typescript": "^5.9.3"
  }
}
```

**Configuration Requirements**:
- TypeScript **strict mode** (mandatory)
- `tsconfig.json` must include:
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "noUncheckedIndexedAccess": true,  // Prevent array out-of-bounds
      "noImplicitOverride": true,
      "noPropertyAccessFromIndexSignature": true
    }
  }
  ```

#### Vite

```json
{
  "devDependencies": {
    "vite": "^7.3.1",
    "@vitejs/plugin-react": "^5.1.4"
  }
}
```

#### Tailwind CSS v4 + shadcn/ui

```json
{
  "dependencies": {
    "tailwindcss": "^4.2.1",
    "@tailwindcss/vite": "^4.2.1",
    "@radix-ui/react-slot": "^1.2.4",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.5.0"
  }
}
```

**Security configuration requirements** (see "Security-Related Configuration" below)

---

### Code Standards & Quality Gates

#### Biome (Replaces ESLint + Prettier)

```json
{
  "devDependencies": {
    "@biomejs/biome": "^2.4.4"
  }
}
```

**Responsibilities**:
- Format (code formatting)
- Lint (code checking)
- Organize imports (automatic import sorting)

**Configuration**: `biome.json` (see below)

#### TypeScript Type Checking (Hard Gate)

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:watch": "tsc --noEmit --watch"
  }
}
```

**CI must run**: `pnpm typecheck` failure blocks merge

---

### Data Validation & Type Consistency

#### Zod

```json
{
  "dependencies": {
    "zod": "^4.3.6"
  }
}
```

**Usage** (ZeroLink-specific):

1. **API Schema Definition** (`packages/shared/src/schemas.ts`):
   ```typescript
   // Shared between frontend and backend to ensure type consistency
   export const LockCommitRequestSchema = z.object({
     uuid: z.string().length(21),
     lock_challenge_id: z.string(),
     lock_proof: z.string().regex(/^[0-9a-f]{64}$/),
     receiver_pub_jwk: ReceiverPubJWKSchema,
     receiver_pub_fpr: z.string().regex(/^[0-9a-f]{64}$/),
     locked_at: z.number().int().positive()
   });

   export type LockCommitRequest = z.infer<typeof LockCommitRequestSchema>;
   ```

2. **Runtime Validation**:
   ```typescript
   // Frontend: self-check before sending
   const request = LockCommitRequestSchema.parse(data);

   // Backend: defend after receiving
   const validated = LockCommitRequestSchema.safeParse(await req.json());
   if (!validated.success) {
     return Response.json({ ok: false }, { status: 400 });
   }
   ```

3. **Form Input Validation**:
   ```typescript
   const PasswordSchema = z.string()
     .min(8, "Password must be at least 8 characters")
     .max(128, "Password must be at most 128 characters");
   ```

---

### Mock / Integration / Test Consistency

#### MSW (Mock Service Worker)

```json
{
  "devDependencies": {
    "msw": "^2.4.0"
  }
}
```

**Usage Boundaries** (important):

| Scenario | Use MSW | Use Real Backend |
|------|---------|-------------|
| Development environment (UI debugging) | OK | Recommended (miniflare) |
| UI component tests | Recommended | Not needed |
| Protocol logic tests | **Prohibited** | **Required** |
| E2E tests | **Prohibited** | **Required** |

**Reason**: Protocol elements like Canonical and lock_proof must be validated with a real backend; MSW cannot detect protocol inconsistency bugs.

**Configuration**:
```typescript
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  // Only mock interfaces needed for the UI layer
  http.post('/api/lock_begin/:uuid', () => {
    return HttpResponse.json({
      ok: true,
      lock_challenge_id: 'mock_challenge_id',
      lock_challenge: 'mock_challenge',
      expires_at: Date.now() + 60000
    });
  })
];
```

---

### Testing System

#### Vitest

```json
{
  "devDependencies": {
    "vitest": "^4.0.18",
    "@vitest/ui": "^4.0.18",
    "@vitest/coverage-v8": "^4.0.18"
  }
}
```

**Test Layers**:

1. **Unit Tests** (protocol logic):
   ```typescript
   // packages/shared/src/__tests__/canonical.test.ts
   import { ghostCanonV1 } from '../canonical';

   describe('Ghost Canon v1', () => {
     test('PRD Appendix B test vector: update', () => {
       const input = {
         op: "update",
         uuid: "u",
         version: 1,
         // ...
       };
       const expected = '{"cipher_bundle":{"aad":"aad",...}}';
       expect(ghostCanonV1(input)).toBe(expected);
     });
   });
   ```

2. **Component Tests** (with React Testing Library)

#### React Testing Library

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.3.2",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.2"
  }
}
```

**Principle**: Test from the user's perspective, not internal implementation.

```typescript
// packages/frontend/src/features/lock/__tests__/LockPage.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('displays Safety Code and allows copying', async () => {
  const user = userEvent.setup();
  render(<LockPage />);

  // Simulate successful locking
  await user.type(screen.getByLabelText('Password'), 'test-password');
  await user.click(screen.getByRole('button', { name: 'Lock' }));

  // Verify Safety Code is displayed
  expect(screen.getByTestId('safety-code-emoji')).toBeInTheDocument();
});
```

#### Playwright

```json
{
  "devDependencies": {
    "@playwright/test": "^1.58.2"
  }
}
```

**E2E Test Scenarios** (ZeroLink-specific):

1. **Complete Flow**:
   ```typescript
   // packages/frontend/e2e/create-lock-deliver.spec.ts
   import { test, expect } from '@playwright/test';

   test('complete flow: Create → Lock → Deliver → View', async ({ page, context }) => {
     // 1. Sender Create
     await page.goto('/');
     await page.click('text=Create');
     // WebAuthn simulation
     const cdpSession = await context.newCDPSession(page);
     await cdpSession.send('WebAuthn.enable');
     // ...

     // 2. Receiver Lock
     const shareUrl = await page.locator('[data-testid="share-url"]').textContent();
     await page.goto(shareUrl);
     // ...

     // 3. Sender Deliver
     // ...

     // 4. Receiver View
     // ...
   });
   ```

2. **WebAuthn Tests**:
   ```typescript
   test('shows fallback guidance when WebAuthn is unavailable', async ({ page }) => {
     // Disable WebAuthn
     await page.addInitScript(() => {
       delete (window.navigator as any).credentials;
     });

     await page.goto('/');
     expect(page.locator('text=Switch browser/device (recommended)')).toBeVisible();
   });
   ```

---

### Package Management & Engineering

#### pnpm + pnpm workspaces

```json
{
  "packageManager": "pnpm@9.12.0"
}
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - 'packages/*'
```

**Advantages** (ZeroLink-relevant):
- Strict dependency management (prevents security issues from phantom dependencies)
- Fast installation (saves CI time)
- Workspace support for shared code

---

### Git Hooks & Commit Standards

#### Husky + lint-staged

```json
{
  "devDependencies": {
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0"
  }
}
```

**Configuration**:
```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": [
      "biome check --write --no-errors-on-unmatched"
    ],
    "*.{json,md}": [
      "biome format --write"
    ]
  }
}
```

**.husky/pre-commit**:
```bash
#!/bin/sh
pnpm lint-staged
pnpm typecheck
```

#### commitlint + Conventional Commits

```json
{
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0"
  }
}
```

**commitlint.config.js**:
```javascript
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'security', // Security fix (ZeroLink-specific)
        'perf',     // Performance optimization
        'refactor', // Refactoring
        'test',     // Tests
        'docs',     // Documentation
        'chore',    // Build/tooling
        'revert'    // Revert
      ]
    ]
  }
};
```

**Example commit**:
```bash
feat(lock): implement Lock Secret anti-preemption locking

- Add lock_secret to URL fragment
- Implement lock_proof calculation logic
- Add lock_begin/lock_commit two-phase flow

Refs: PRD § Appendix C
```

---

### Version Management & Release Pipeline

#### PR Validation + Tag Release

This repository no longer uses Changesets. Version and release workflows are driven by GitHub Actions:

- `pull_request` / `merge_group` runs `pr-validate.yml`
- `push main` auto-deploys to staging
- `push v*` tag auto-deploys to production
- Official signed releases generate, sign, and verify `manifest.json` before deployment

**Workflow**:
```bash
# 1. Develop and push feature branch
git push origin <branch>

# 2. Wait for PR validation to pass
pnpm typecheck
pnpm test
pnpm --filter @zerolink/frontend build
pnpm --filter @zerolink/frontend test:e2e

# 3. Auto-deploy to staging after merging to main

# 4. Push tag to trigger production deployment
git tag v1.0.0
git push origin v1.0.0
```

---

## Monorepo Structure

### Project Structure

```
ZeroLink/
├── packages/
│   ├── shared/                    # Shared code (protocol-level consistency)
│   │   ├── src/
│   │   │   ├── constants.ts       # PRD Appendix A constants
│   │   │   ├── canonical.ts       # Ghost Canon v1 implementation
│   │   │   ├── schemas.ts         # Zod schemas (API contracts)
│   │   │   ├── types.ts           # Shared type definitions
│   │   │   ├── crypto/            # Cryptographic utilities (optionally shared)
│   │   │   │   ├── padding.ts
│   │   │   │   └── hash.ts
│   │   │   └── __tests__/
│   │   │       ├── canonical.test.ts
│   │   │       └── schemas.test.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   ├── frontend/                  # React application
│   │   ├── src/
│   │   │   ├── pages/             # Page components
│   │   │   │   ├── CreatePage.tsx  # Sender Create
│   │   │   │   ├── SharePage.tsx   # Receiver Lock/Decrypt
│   │   │   │   ├── ManagePage.tsx  # Sender Manage/Deliver
│   │   │   │   ├── TrustPage.tsx   # Trust Model
│   │   │   │   ├── NotFoundPage.tsx
│   │   │   │   └── manage/        # Manage submodule
│   │   │   ├── crypto/            # Encryption orchestration layer
│   │   │   │   ├── orchestrator.ts          # Entry point
│   │   │   │   ├── orchestrator-create.ts   # Create flow
│   │   │   │   ├── orchestrator-lock.ts     # Lock flow
│   │   │   │   ├── orchestrator-deliver.ts  # Deliver flow
│   │   │   │   ├── orchestrator-decrypt.ts  # Decrypt flow
│   │   │   │   ├── orchestrator-delete.ts   # Delete flow
│   │   │   │   ├── webauthn.ts     # WebAuthn adapter
│   │   │   │   ├── softkey.ts      # ECDSA softkey
│   │   │   │   ├── storage.ts      # IndexedDB receiver key
│   │   │   │   └── protocol-utils.ts
│   │   │   ├── api/
│   │   │   │   └── client.ts
│   │   │   ├── components/        # UI components
│   │   │   │   ├── safety/        # Safety Code
│   │   │   │   ├── lock/          # Passphrase input
│   │   │   │   ├── layout/        # Page card, badges
│   │   │   │   └── ui/            # shadcn/ui primitives
│   │   │   ├── features/
│   │   │   │   └── share/         # Share page logic
│   │   │   ├── stores/            # Zustand stores
│   │   │   ├── locales/           # i18n (en, zh)
│   │   │   ├── release/           # Verified Release
│   │   │   ├── sync/              # WebSocket channel sync
│   │   │   ├── mocks/             # MSW handlers
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── e2e/                   # Playwright E2E
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── vitest.config.ts
│   │   └── playwright.config.ts
│   │
│   └── backend/                   # Cloudflare Workers
│       ├── src/
│       │   ├── index.ts           # Worker entry point
│       │   ├── worker.ts          # Worker routing
│       │   ├── security-headers.ts
│       │   ├── commitTokens.ts
│       │   ├── do/                # Durable Objects (split mixins)
│       │   │   ├── SecretVault.ts           # DO main class
│       │   │   ├── SecretVaultCompound.ts   # Compound operations (deliver/update)
│       │   │   ├── SecretVaultLock.ts       # Lock logic
│       │   │   ├── SecretVaultStateMachine.ts
│       │   │   ├── SecretVaultStorage.ts    # Persistence
│       │   │   ├── SecretVaultWebSocket.ts  # Real-time push
│       │   │   ├── SecretVaultTypes.ts
│       │   │   └── ...
│       │   ├── crypto/
│       │   │   ├── webauthn.ts
│       │   │   ├── softkey.ts
│       │   │   ├── attestation.ts
│       │   │   └── bytes.ts
│       │   └── __tests__/
│       ├── package.json
│       ├── wrangler.toml
│       └── vitest.config.ts
│
├── .husky/                        # Git hooks
├── docs/                          # Documentation
├── biome.json                     # Biome configuration
├── pnpm-workspace.yaml
├── package.json                   # Root package.json
└── tsconfig.base.json             # Base TypeScript configuration
```

### Package Dependency Graph

```
frontend  ──depends on──▶  shared
   │                         ▲
   │                         │
backend   ──depends on───────┘
```

**package.json example**:
```json
// packages/frontend/package.json
{
  "name": "@zerolink/frontend",
  "dependencies": {
    "@zerolink/shared": "workspace:*",
    "react": "^19.2.4",
    "zod": "^4.3.6"
  }
}

// packages/backend/package.json
{
  "name": "@zerolink/backend",
  "dependencies": {
    "@zerolink/shared": "workspace:*"
  }
}
```

---

## Cryptography & Security

### Required Dependencies

#### Argon2id (KDF)

```json
{
  "dependencies": {
    "@noble/hashes": "^2.0.1"  // includes argon2
  }
}
```

**Usage**:
```typescript
// packages/frontend/src/crypto/kdf.ts
import { argon2id } from '@noble/hashes/argon2';

export async function wrapPrivateKey(
  privateKeyJWK: JsonWebKey,
  password: string
): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Argon2id parameters (PRD target: 250-500ms)
  const key = argon2id(password, salt, {
    m: 65536,  // 64MB
    t: 3,      // 3 iterations
    p: 1       // parallelism
  });

  // Wrap private key with derived key (AES-GCM)
  // ...
}
```

#### WebAuthn Type Definitions

```json
{
  "devDependencies": {
    "@github/webauthn-json": "^2.1.1"  // Simplifies WebAuthn API
  }
}
```

#### Base64url Encoding

```json
{
  "dependencies": {
    "base64-js": "^1.5.1"
    // Or implement your own (recommended, fewer dependencies)
  }
}
```


#### Ed25519 (Manifest Signature Verification)

```json
{
  "dependencies": {
    "@noble/ed25519": "^3.0.0"
  }
}
```

**Purpose**: Browser-side verification of the Ed25519 signature on the signed Manifest (`packages/frontend/src/release/`).

#### Internationalization (i18n)

```json
{
  "dependencies": {
    "i18next": "^25.8.18",
    "react-i18next": "^16.5.8",
    "i18next-browser-languagedetector": "^8.2.1"
  }
}
```

**Purpose**: Bilingual support (Chinese and English), translation files in `packages/frontend/src/locales/`.

#### Fonts

```json
{
  "dependencies": {
    "@fontsource-variable/sora": "^5.2.8"
  }
}
```

**Purpose**: Sora variable font, zero third-party CDN loading (fonts are distributed with the build artifacts).

### Security-Related Configuration

#### Vite Configuration (CSP + Verified Release)

```typescript
// packages/frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    headers: {
      // CSP (Content Security Policy)
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",  // Prohibit inline scripts
        "style-src 'self' 'unsafe-inline'",  // Temporarily allow inline styles (React requires it)
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self' https://*.workers.dev",  // API domain
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
      ].join('; '),

      // Security headers
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  },

  build: {
    // Filenames include hash (for Verified Release runtime verification)
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    },

    // Generate sourcemaps (for debugging, not deployed to production)
    sourcemap: true
  }
});
```

#### TypeScript Configuration (Strict Mode)

```json
// tsconfig.base.json (root directory)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    // Strict mode (mandatory)
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,

    // Path mapping (Monorepo)
    "baseUrl": ".",
    "paths": {
      "@zerolink/shared": ["./packages/shared/src"]
    },

    "skipLibCheck": true
  }
}
```

#### Biome Configuration (Code Standards)

```json
// biome.json (root directory)
{
  "$schema": "https://biomejs.dev/schemas/2.4.4/schema.json",
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error",
        "noDebugger": "error"
      },
      "security": {
        "noDangerouslySetInnerHtml": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "useExhaustiveDependencies": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5",
      "semicolons": "always"
    }
  },
  "files": {
    "ignoreUnknown": true,
    "includes": ["**", "!templates/**", "!pnpm-lock.yaml"]
  }
}
```

---

## Development Workflow

### Project Initialization

```bash
# 1. Install pnpm (if not already installed)
npm install -g pnpm

# 2. Initialize the project
mkdir ZeroLink && cd ZeroLink
pnpm init

# 3. Create Monorepo structure
mkdir -p packages/{shared,frontend,backend}

# 4. Create pnpm-workspace.yaml
echo "packages:\n  - 'packages/*'" > pnpm-workspace.yaml

# 5. Initialize each package
cd packages/shared && pnpm init
cd ../frontend && pnpm init
cd ../backend && pnpm init
cd ../..

# 6. Install root dependencies (toolchain)
pnpm add -D -w \
  @biomejs/biome \
  husky lint-staged \
  @commitlint/cli @commitlint/config-conventional \
  typescript

# 7. Initialize Git Hooks
pnpm exec husky init

# 8. Set up CI / deploy workflow
# Use the existing .github/workflows/pr-validate.yml and deploy.yml in the repository
```

### Daily Development

```bash
# Install dependencies
pnpm install

# Development mode (all packages in parallel)
pnpm -r --parallel dev

# Or run frontend only
pnpm --filter @zerolink/frontend dev

# Type checking
pnpm typecheck

# Code checking and formatting
pnpm biome check --write .

# Run tests
pnpm test                    # All packages
pnpm --filter @zerolink/shared test  # Single package

# E2E tests
pnpm --filter @zerolink/frontend test:e2e
```

### CI Pipeline (GitHub Actions Example)

```yaml
# .github/workflows/pr-validate.yml
name: PR Validate

on:
  pull_request:
    branches: [main]
  merge_group:
    types: [checks_requested]

jobs:
  pr-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: "22"

      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @zerolink/frontend build

# E2E tests run in a separate workflow (e2e-full.yml, scheduled/manual)
```

---

## Quality Gates

### Local Development (Pre-commit)

```
Automatically run before commit:
1. lint-staged (only checks staged files)
   └─ biome check --write
2. typecheck (full)
   └─ tsc --noEmit
```

### Pull Request (CI)

```
Must pass before merge (pr-validate.yml):
1. pnpm typecheck (fails on type errors)
2. pnpm test (fails on unit test failures)
3. pnpm --filter @zerolink/frontend build (fails on signed release build errors)

E2E tests run in a separate workflow (e2e-full.yml, scheduled/manual), not as a PR gate.
```

### Pre-Release (Release)

```
1. All CI checks pass
2. Manually verify deployment instructions and signing configuration
3. Tag the version: git tag v1.0.0
4. Push the tag: git push origin v1.0.0
5. Wait for `deploy.yml` to complete the production release
```

---

## Deployment & Release

### Frontend Deployment (Workers Assets Unified Deployment)

Frontend build artifacts are deployed alongside the Worker via the `[assets]` binding in `wrangler.toml`, not using Cloudflare Pages.

```bash
# Build frontend
pnpm --filter @zerolink/frontend build

# Output directory: packages/frontend/dist

# Unified deployment (Worker + frontend static assets)
cd packages/backend
npx wrangler deploy
```

### Backend Deployment (Cloudflare Workers)

```bash
# Deploy to Cloudflare Workers
pnpm --filter @zerolink/backend deploy

# wrangler.toml configuration
# name = "zerolink-api"
# main = "src/index.ts"
# compatibility_date = "2024-01-01"
```

### Billing Model & Limits (Cost & Limits)

ZeroLink's core logic relies on **Cloudflare Durable Objects (DO)**. Since 2026, Cloudflare has provided a full **Free Tier** for DO, allowing developers to run this project without a paid subscription.

| Billing Item | Free Tier Quota (Free Plan) | Notes |
|------|-------------------|------|
| **Compute Requests** | 100,000/day | DO stops responding after quota is exceeded until the next day's reset |
| **Compute Duration** | 12,800 GB-s/day | Billed based on wall-clock time (each DO calculated at a fixed 128MB memory) |
| **SQLite Storage Reads** | 5,000,000 rows/day | This project recommends and uses SQLite as the DO storage backend |
| **SQLite Storage Writes** | 100,000 rows/day | Includes atomic transactional writes |
| **Total Storage Capacity** | 5 GB | Upper limit for DO persistent data |

**Key Notes**:
1. **Free Tier Limitation**: The free tier only supports the **SQLite storage backend**. This project is already adapted for SQLite.
2. **Paid Plan**: If higher quotas or the traditional KV storage backend are needed, the Workers Paid plan is required (starting at $5/month).
3. **Hibernation**: This project leverages WebSocket auto-hibernation to reduce compute duration consumption.

---

## Configuration File Inventory

### Root Directory

```
ZeroLink/
├── package.json              # Root package.json (toolchain)
├── pnpm-workspace.yaml       # Monorepo configuration
├── tsconfig.base.json        # Base TS configuration
├── biome.json                # Biome configuration
├── commitlint.config.js      # Commitlint configuration
├── .husky/
│   ├── pre-commit
│   └── commit-msg
├── .github/workflows/pr-validate.yml  # PR CI
├── .github/workflows/deploy.yml       # staging / production deploy
└── .gitignore
```

### Per-Package Configuration

```
packages/shared/
├── package.json
├── tsconfig.json            # Extends tsconfig.base.json
└── vitest.config.ts

packages/frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts

packages/backend/
├── package.json
├── tsconfig.json
├── wrangler.toml
└── vitest.config.ts
```

---

## Dependency Version Strategy

### Fixed Versions vs Range Versions

**Principles**:
- **Application packages** (frontend/backend): Use `^` ranges (auto-upgrade minor versions)
- **Library packages** (shared): Use `^` ranges (for compatibility)
- **Cryptographic libraries**: Consider fixed versions (for security audit requirements)

**Example**:
```json
{
  "dependencies": {
    "react": "^19.2.4",           // Application dependency: allow minor upgrades
    "@noble/hashes": "^2.0.1",    // Cryptographic: Argon2id KDF
    "@zerolink/shared": "workspace:*"  // Monorepo internal: workspace protocol
  }
}
```

### Renovate Bot Configuration (Optional)

```json
// renovate.json
{
  "extends": ["config:base"],
  "packageRules": [
    {
      "matchPackagePatterns": ["^argon2", "^@noble"],
      "matchUpdateTypes": ["major", "minor"],
      "automerge": false,
      "labels": ["security-review"]
    }
  ]
}
```

---

## Appendix: Complete package.json Templates

### Root package.json

```json
{
  "name": "zerolink",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @zerolink/frontend test:e2e",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check package.json biome.json commitlint.config.js pnpm-workspace.yaml packages docs scripts .husky",
    "format": "biome format --write package.json biome.json commitlint.config.js pnpm-workspace.yaml packages docs scripts .husky",
    "prepare": "husky"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.4",
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0",
    "typescript": "^5.9.3"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,md}": [
      "biome check --write --no-errors-on-unmatched"
    ]
  }
}
```

### packages/shared/package.json

```json
{
  "name": "@zerolink/shared",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./constants": "./src/constants.ts",
    "./schemas": "./src/schemas.ts"
  },
  "scripts": {
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^4.0.18"
  }
}
```

### packages/frontend/package.json

```json
{
  "name": "@zerolink/frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zerolink/shared": "workspace:*",
    "@noble/hashes": "^2.0.1",
    "@github/webauthn-json": "^2.1.1",
    "@radix-ui/react-slot": "^1.2.4",
    "@tailwindcss/vite": "^4.2.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.13.1",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^4.2.1",
    "zod": "^4.3.6",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.4",
    "@vitest/ui": "^4.0.18",
    "msw": "^2.12.10",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  }
}
```

---

## Related Documentation

- [PRD v3.0](./PRD.md) - Product Requirements
- [Architecture Design](./ARCHITECTURE.md) - System Architecture
- [Security Model](./SECURITY.md) - Threat Model
- [Documentation Index](./INDEX.md) - Quick Navigation

---

**Last Updated**: 2026-03-11
**Maintainer**: ZeroLink Team
**Status**: Implemented, updated to match the current main branch workflow
