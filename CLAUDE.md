# Claude Instructions

## Skills
Load these Claude-local mandatory skills before implementation work:
- `.claude/skills/base/SKILL.md`
- `.claude/skills/security/SKILL.md`
- `.claude/skills/typescript/SKILL.md`
- `.claude/skills/react-web/SKILL.md`
- `.claude/skills/playwright-testing/SKILL.md`
- `.claude/skills/session-management/SKILL.md`
- `.claude/skills/code-review/SKILL.md`
- `.claude/skills/commit-hygiene/SKILL.md`

Shared repo guidance still lives in `.ai/`, while `.claude/skills/` remains the Claude-local mandatory skill layer and may keep Claude-specific automation.

## Rules
- Create a new branch for every change.
- Open a PR for every change.
- Never push implementation changes directly to `main`.
- Use `<type>/<short-name>` for branch names.
- `type` must be one of: `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`, `revert`.
- Do not include task IDs in branch names.
- Do not use legacy or tool-branded prefixes such as `task/`, `codex/`, `ai/`, `agent/`, `tmp/`, or `misc/`.
- Do not mention tool authorship or AI generation in code, commits, PRs, or PR comments.
- Keep diffs small and scoped.
- Update `_project_specs/` with every AI-authored change.

## Read First
- `.ai/workflows.md`
- `.ai/project-context.md`
- `.ai/coding-standards.md`
- `.ai/architecture.md`
- `.ai/commands.md`

## Task Routing
- Frontend: `.ai/tasks/frontend.md`
- Backend: `.ai/tasks/backend.md`
- Release and deploy: `.ai/tasks/release.md`

## Claude Local
- Shared repo guidance lives in `.ai/`.
- `.claude/skills/` and `.claude/settings.local.json` are the Claude-local mandatory skill layer and compatibility assets.
- `.agents/skills/` is the general, agent-neutral compatibility layer.
