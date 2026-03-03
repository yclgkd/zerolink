# AI Docs

`.ai/` is the shared guidance layer for Claude, generic agents, and Gemini CLI.

## Directory Roles
- `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` are entrypoint routers.
- `.ai/` is the canonical shared guidance.
- `.agents/skills/` is a general skills compatibility directory.
- `.claude/skills/` is Claude-local.
- Shared workflow rules belong in `.ai/`, not in copied skills.

## Read Order
1. `.ai/workflows.md`
2. `.ai/project-context.md`
3. `.ai/coding-standards.md`
4. `.ai/architecture.md`
5. `.ai/commands.md`
6. The relevant file under `.ai/tasks/`

## Maintenance Note
- `.agents/skills/` is currently a copy of `.claude/skills/` and may drift.
- Update shared workflow rules in `.ai/`, not in copied skill directories.
