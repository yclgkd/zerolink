# Claude Instructions

## Always Read
- `.ai/project-context.md` — what ZeroLink is and its security posture
- `.ai/coding-standards.md` — scope, typing, file size, security constraints

## Rules
- Never push implementation changes directly to `main`.
- Update `_project_specs/` when making important architectural or workflow decisions.
- For branch naming, PR workflow, and commit conventions, follow `.ai/workflows.md`.

## Skills — Load by Task Type

**Implementation work** (writing or modifying code):
- `.claude/skills/base/SKILL.md`
- `.ai/architecture.md`

**Frontend tasks** (React components, pages, styles):
- `.claude/skills/typescript/SKILL.md`
- `.claude/skills/react-web/SKILL.md`

**E2E testing**:
- `.claude/skills/playwright-testing/SKILL.md`

**Security-sensitive changes** (auth, crypto, secrets, input handling):
- `.claude/skills/security/SKILL.md`

**Code review** (`/code-review` or `/review-fix`):
- `.claude/skills/code-review/SKILL.md`

**Committing / creating PRs**:
- `.claude/skills/commit-hygiene/SKILL.md`
- `.ai/workflows.md`

**Long sessions or context limits**:
- `.claude/skills/session-management/SKILL.md`

## Reference — Load When Needed
- `.ai/commands.md` — project commands (`pnpm dev`, `pnpm test`, etc.)
- `.ai/workflows.md` — full branch/PR/release workflow

## Task Routing
- Frontend: `.ai/tasks/frontend.md`
- Backend: `.ai/tasks/backend.md`
- Release and deploy: `.ai/tasks/release.md`

## Claude Local
- Shared repo guidance lives in `.ai/`.
- `.claude/skills/` and `.claude/settings.local.json` are the Claude-local mandatory skill layer.
