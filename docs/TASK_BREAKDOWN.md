# ZeroLink Task Breakdown (AI Parallel Execution)

Last Updated: 2026-03-03

## Goal
将大模块拆分为可独立执行、低冲突、可并行开发的任务。每个任务对应一个 Git 分支 + 一个 PR。

## Working Rules
- 一任务一分支：`<type>/<short-name>`
- 一任务一 PR：PR 仅包含当前任务目标，不混入其他改动
- Task ID 跟踪放在 issue / PR 中，不放进分支名
- 先契约后实现：优先完成 `shared` 的常量/类型/schema，再接 backend/frontend
- 依赖未完成不启动下游任务（避免返工）
- **Mock 驱动 UI**：前端 UI 开发必须同步实现 MSW Handlers，确保 UI 可独立运行。

## Difficulty Scale
- 1: 纯常量/导出整理，几乎无业务逻辑
- 2: 基础骨架/路由/类型映射
- 3: 中等复杂度实现，需联调或较完整测试
- 4: 安全敏感或状态一致性逻辑
- 5: 高复杂状态机/跨模块流程/高回归风险

## Task List
| Task ID | Task Name | Scope | Depends On | Difficulty | Suggested AI Tier |
|---|---|---|---|---:|---|
| ZL-001 | shared-constants | `packages/shared/src/constants.ts` | None | 1 | 基础模型 |
| ZL-002 | shared-types-core | `packages/shared/src/types.ts` | None | 2 | 中配模型 |
| ZL-003 | shared-schemas-api | `packages/shared/src/schemas.ts` + `index.ts` | ZL-001, ZL-002 | 3 | 中配模型 |
| ZL-005 | crypto-aes-padding | `packages/shared/src/crypto/aes.ts` + tests | ZL-001 | 4 | 强模型 |
| ZL-006 | crypto-rsa-wrap | `packages/shared/src/crypto/rsa.ts` + tests | ZL-001 | 4 | 强模型 |
| ZL-007 | crypto-kdf-argon2id | `packages/shared/src/crypto/kdf.ts` + tests | ZL-001 | 4 | 强模型 |
| ZL-008 | backend-worker-routing | `packages/backend/wrangler.toml` + `src/index.ts` | ZL-002, ZL-003 | 2 | 中配模型 |
| ZL-009 | backend-do-state-machine | `SecretVault.ts` 状态机实现 (严格对齐 PRD 附录 8) | ZL-008 | 5 | 强模型 |
| ZL-010 | backend-lock-challenge | `lock_begin/lock_commit` 挑战响应逻辑 | ZL-003, ZL-009 | 4 | 强模型 |
| ZL-011 | backend-compound-delete | `compound_begin/commit`, `delete_commit` | ZL-003, ZL-009 | 4 | 强模型 |
| ZL-012 | frontend-app-shell-routing | `App.tsx`, 路由树, MSW 基础架构初始化 | None | 2 | 基础/中配模型 |
| ZL-013 | frontend-theme-tokens | `src/styles/globals.css`（Tailwind v4 tokens）+ shadcn/ui 基础接入 | ZL-012 | 2 | 基础/中配模型 |
| ZL-014 | frontend-layout-primitives | 基于 shadcn/ui 组合 `Card/Button/Badge` 等页面基础块 | ZL-013 | 3 | 中配模型 |
| ZL-015 | frontend-security-profile-card | `SecurityProfileCard` 组件与交互 | ZL-014 | 2 | 基础/中配模型 |
| ZL-016 | frontend-passphrase-input | `PassphraseInput` 组件（强度/可见性/校验） | ZL-014 | 3 | 中配模型 |
| ZL-017 | frontend-safety-code | `SafetyCode` 组件（emoji/color blocks/raw hex） | ZL-014, ZL-002 | 3 | 中配模型 |
| ZL-018 | frontend-create-page-ui | Create 页面 UI + MSW Create Handlers | ZL-012, ZL-015, ZL-016 | 2 | 基础/中配模型 |
| ZL-019 | frontend-lock-page-ui | Lock 页面 UI + MSW Lock Handlers | ZL-012, ZL-016, ZL-017 | 2 | 基础/中配模型 |
| ZL-020 | frontend-manage-page-ui | Manage 页面 UI + MSW Manage Handlers | ZL-012, ZL-017 | 2 | 基础/中配模型 |
| ZL-021 | frontend-unlock-delivered-state-ui | `/s/:uuid` 页面"已送达"态 UI + MSW Decrypt Handlers（扩展 ZL-019，非新页面） | ZL-019, ZL-016, ZL-017 | 2 | 基础/中配模型 |
| ZL-022 | frontend-state-store | `stores/` Zustand slices（create/lock/deliver/decrypt） | ZL-002, ZL-012 | 3 | 中配模型 |
| ZL-023 | frontend-api-client | API client (需与 MSW Handler 契约对齐) | ZL-003, ZL-008 | 3 | 中配模型 |
| ZL-024 | frontend-webauthn-adapter | register/assert 封装 + profile gating + fallback | ZL-012, ZL-023 | 4 | 强模型 |
| ZL-025 | frontend-crypto-orchestrator | 前端协议编排（create→lock→deliver→decrypt） | ZL-005, ZL-006, ZL-007, ZL-022, ZL-023 | 5 | 强模型 |
| ZL-026 | frontend-create-page-integration | Create 页面接入 store/api/webauthn | ZL-018, ZL-022, ZL-023, ZL-024 | 4 | 强模型 |
| ZL-027 | frontend-lock-page-integration | Lock 页面接入 lock_begin/commit 与 safety code | ZL-019, ZL-022, ZL-023, ZL-025, ZL-010 | 4 | 强模型 |
| ZL-028 | frontend-manage-page-integration | Manage 页面接入 deliver/update/delete | ZL-020, ZL-022, ZL-023, ZL-024, ZL-025, ZL-011 | 4 | 强模型 |
| ZL-029 | frontend-unlock-decrypt-integration | `/s/:uuid` 已送达态接入解密 crypto 与 burn 后态 | ZL-021, ZL-022, ZL-023, ZL-025, ZL-011 | 4 | 强模型 |
| ZL-030 | frontend-a11y-and-error-states | 可访问性 + 错误空态统一 | ZL-026, ZL-027, ZL-028, ZL-029 | 3 | 中配模型 |
| ZL-031 | frontend-coverage-gaps | 补齐各任务遗漏的单测覆盖率，目标整体 ≥ 80%（不改生产逻辑） | ZL-026, ZL-027, ZL-028, ZL-029 | 3 | 中配模型 |
| ZL-032 | e2e-happy-path | Playwright 端到端主流程 | ZL-010, ZL-011, ZL-027, ZL-028, ZL-029 | 3 | 中配模型 |

## Definition of Done (Per Task)
- 只改动任务声明范围内文件（必要联动除外，需在 PR 说明）
- 本任务相关测试通过（单测/集成/E2E）
- Typecheck/Lint 通过
- PR 描述包含：变更点、风险点、验证步骤、回滚方案

## Task Contracts (Out of Scope + DoD Commands)

### ZL-001 shared-constants
- Out of Scope: 不实现 crypto 函数与 API 逻辑
- DoD Commands:
  - `pnpm --filter shared typecheck`

### ZL-002 shared-types-core
- Out of Scope: 不改 schema 校验规则
- DoD Commands:
  - `pnpm --filter shared typecheck`

### ZL-003 shared-schemas-api
- Scope: `packages/shared/src/schemas.ts` + `packages/shared/src/index.ts`（合并原 ZL-004）
- Out of Scope: 不改 backend handler 行为
- DoD Commands:
  - `pnpm --filter shared typecheck`
  - `pnpm --filter shared test`

### ZL-005 crypto-aes-padding
- Out of Scope: 不涉及 RSA/KDF
- DoD Commands:
  - `pnpm --filter shared typecheck`
  - `pnpm --filter shared test`

### ZL-006 crypto-rsa-wrap
- Difficulty: 4（generateKey + importKey/exportKey + OAEP wrap/unwrap，不亚于 AES-GCM）
- Out of Scope: 不涉及 AES padding/KDF
- DoD Commands:
  - `pnpm --filter shared typecheck`
  - `pnpm --filter shared test`

### ZL-007 crypto-kdf-argon2id
- Out of Scope: 不改前端 UI 与后端 API
- DoD Commands:
  - `pnpm --filter shared typecheck`
  - `pnpm --filter shared test`

### ZL-008 backend-worker-routing
- Scope: `packages/backend/wrangler.toml`（新建）+ `packages/backend/src/index.ts`（路由骨架）
- Out of Scope: 不实现完整 DO 状态机细节
- DoD Contracts:
  - `wrangler.toml` 包含 KV binding（`SECRETS_KV`）和 DO binding（`SECRET_VAULT`）
  - 所有 `/api/*` 路由返回正确 CORS headers（`Access-Control-Allow-Origin`）
- DoD Commands:
  - `pnpm --filter backend typecheck`

### ZL-009 backend-do-state-machine
- Out of Scope: 不实现前端联调页面
- DoD Contracts: 状态转移必须通过 Vitest 验证（Waiting -> Locked -> Delivered -> Deleted）
- DoD Commands:
  - `pnpm --filter backend typecheck`
  - `pnpm --filter backend test`

### ZL-010 backend-lock-challenge
- Out of Scope: 不实现 compound/delete 逻辑
- DoD Commands:
  - `pnpm --filter backend typecheck`
  - `pnpm --filter backend test`

### ZL-011 backend-compound-delete
- Out of Scope: 不改 lock challenge 协议定义
- DoD Commands:
  - `pnpm --filter backend typecheck`
  - `pnpm --filter backend test`

### ZL-012 frontend-app-shell-routing
- Out of Scope: 不接入真实 API 或 crypto
- DoD Contracts: 完成 `src/mocks/browser.ts` 与 `handlers.ts` 的基础架设，支持 `?mock=true` 切换
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend build`

### ZL-013 frontend-theme-tokens
- Out of Scope: 不改路由/状态管理
- DoD Contracts: Tailwind v4 + shadcn/ui 初始化完成，页面不再依赖手写 BEM 样式类
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend build`

### ZL-014 frontend-layout-primitives
- Out of Scope: 不接入协议流程与网络请求
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-015 frontend-security-profile-card
- Out of Scope: 不实现 WebAuthn 调用
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-016 frontend-passphrase-input
- Out of Scope: 不做真实 KDF 运算
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-017 frontend-safety-code
- Out of Scope: 不实现 lock API
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-018 frontend-create-page-ui
- Out of Scope: 不接真 WebAuthn
- DoD Contracts: 实现 `create_begin/finish` 的 MSW Mock 响应（符合 ZL-003 定义）
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend build`

### ZL-019 frontend-lock-page-ui
- Out of Scope: 不接真 lock_begin/commit
- DoD Contracts: 实现 `lock_begin/commit` 的 MSW Mock 响应
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend build`

### ZL-020 frontend-manage-page-ui
- Out of Scope: 不接真 deliver/update/delete API
- DoD Contracts: 实现 `compound_begin/commit` 的 MSW Mock 响应
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend build`

### ZL-021 frontend-unlock-delivered-state-ui
- Scope: 扩展 `/s/:uuid`（UnlockAndLock）页面，增加"已送达"态 UI，**不新建路由**
- Out of Scope: 不接真实 decrypt 数据链路
- DoD Contracts:
  - 页面能根据 channel 状态切换"等待中"/"已锁定"/"已送达"视图
  - 实现密文获取的 MSW Mock 响应
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend build`

### ZL-022 frontend-state-store
- Out of Scope: 不写页面样式与动效
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-023 frontend-api-client
- Out of Scope: 不改后端接口定义
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-024 frontend-webauthn-adapter
- Out of Scope: 不改页面视觉组件
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-025 frontend-crypto-orchestrator
- Out of Scope: 不改后端 DO 状态机规则
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-026 frontend-create-page-integration
- Out of Scope: 不实现 lock/manage/decrypt 页面集成
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-027 frontend-lock-page-integration
- Out of Scope: 不实现 create/manage/decrypt 页面集成
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-028 frontend-manage-page-integration
- Out of Scope: 不实现 create/lock/decrypt 页面集成
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-029 frontend-unlock-decrypt-integration
- Scope: `/s/:uuid` 已送达态接入真实解密 crypto（ZL-025）与 burn 后状态展示
- Out of Scope: 不实现 create/manage 页面集成
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-030 frontend-a11y-and-error-states
- Out of Scope: 不新增协议字段与 API
- DoD Commands:
  - `pnpm --filter frontend typecheck`
  - `pnpm --filter frontend test`

### ZL-031 frontend-coverage-gaps
- Scope: 仅补齐前置任务遗漏的测试覆盖，不新增功能。各任务 DoD 已要求随任务写测试，本任务是最终兜底。
- Out of Scope: 不改生产逻辑（除修复测试必需的小改）
- DoD Contracts: `pnpm --filter frontend test --coverage` 覆盖率 ≥ 80%
- DoD Commands:
  - `pnpm --filter frontend test`

### ZL-032 e2e-happy-path
- Out of Scope: 不新增业务功能，仅做 E2E 验证与必要修复
- DoD Commands:
  - `pnpm --filter frontend test`
  - `pnpm --filter frontend build`

## Recommended GitHub Operation Model
1. Source of truth: 本文件（版本化、可审计）
2. Execution unit: GitHub Issues（每个任务 1 issue）
3. Flow management: GitHub Project（看板状态 + 难度 + 依赖字段）

## Frontend Parallel Lanes (from CLAUDE.md)
- Lane A (Design System): ZL-013, ZL-014, ZL-015, ZL-016, ZL-017
- Lane B (Page UI): ZL-018, ZL-019, ZL-020, ZL-021（ZL-021 为扩展 ZL-019 的已送达态，非独立页面）
- Lane C (State + API + WebAuthn): ZL-022, ZL-023, ZL-024
- Lane D (Protocol Integration): ZL-025, ZL-026, ZL-027, ZL-028, ZL-029
- Lane E (Quality): ZL-030, ZL-031, ZL-032

## Suggested Project Fields
- `Status`: Todo / In Progress / In Review / Done
- `Difficulty`: 1-5
- `Area`: shared / backend / frontend / qa
- `Risk`: low / medium / high
- `DependsOn`: task id list

## Issue Title Convention
`[Task] ZL-xxx <task-name>`

## Branch Convention
`<type>/<short-name>`

- `type` must come from the repo Conventional Commit types:
  `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`, `revert`
- Do not include task IDs in branch names.
- Do not use `task/`, `codex/`, `ai/`, `agent/`, `tmp/`, or `misc/` prefixes.

## PR Title Convention
`[ZL-xxx] <summary>`
