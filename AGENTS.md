# Agent Instructions

## Always Read
- `.ai/project-context.md` — what ZeroLink is and its security posture
- `.ai/coding-standards.md` — scope, typing, file size, security constraints

## Rules
- Never push implementation changes directly to `main`.
- Update `_project_specs/` when making important architectural or workflow decisions.
- For branch naming, PR workflow, and commit conventions, follow `.ai/workflows.md`.

## Skills — Load by Task Type

**Implementation work** (writing or modifying code):
- `.agents/skills/base/SKILL.md`
- `.ai/architecture.md`

**Frontend tasks** (React components, pages, styles):
- `.agents/skills/typescript/SKILL.md`
- `.agents/skills/react-web/SKILL.md`

**E2E testing**:
- `.agents/skills/playwright-testing/SKILL.md`

**Security-sensitive changes** (auth, crypto, secrets, input handling):
- `.agents/skills/security/SKILL.md`

**Code review**:
- `.agents/skills/code-review/SKILL.md`

**Committing / creating PRs**:
- `.agents/skills/commit-hygiene/SKILL.md`
- `.ai/workflows.md`

**Long sessions or context limits**:
- `.agents/skills/session-management/SKILL.md`

## Reference — Load When Needed
- `.ai/commands.md` — project commands (`pnpm dev`, `pnpm test`, etc.)
- `.ai/workflows.md` — full branch/PR/release workflow

## Task Routing
- Frontend: `.ai/tasks/frontend.md`
- Backend: `.ai/tasks/backend.md`
- Release and deploy: `.ai/tasks/release.md`

## Agent Local
- Shared repo guidance lives in `.ai/`.
- `.agents/skills/` is the agent-neutral reusable skills layer.
