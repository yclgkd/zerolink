# Agent Instructions

## Rules
- Create a new branch for every change.
- Open a PR for every change.
- Never push implementation changes directly to `main`.
- Use `<type>/<short-name>` for branch names.
- `type` must come from the repo Conventional Commit types: `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`, `revert`.
- Do not include task IDs in branch names.
- Do not use legacy or tool-branded prefixes such as `task/`, `codex/`, `ai/`, `agent/`, `tmp/`, or `misc/`.
- Do not mention tool authorship or AI generation in code, commits, PRs, or PR comments.
- Keep changes scoped and reviewable.
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

## Agent Skills
- Shared repo guidance lives in `.ai/`.
- Reusable skills are available in `.agents/skills/`.
- Claude-local compatibility assets remain under `.claude/skills/`.
