# AI Docs

`.ai/` is the shared guidance layer for Claude, generic agents, and Gemini CLI.

## Directory Roles
- `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` are entrypoint routers.
- `.ai/` is the canonical shared guidance.
- `.agents/skills/` is the agent-neutral shared skills layer.
- `.claude/skills/` is the Claude-local skills layer.
- Shared workflow rules belong in `.ai/`, not in shared or tool-local skill directories.

## Read Order
1. `.ai/workflows.md`
2. `.ai/project-context.md`
3. `.ai/coding-standards.md`
4. `.ai/architecture.md`
5. `.ai/commands.md`
6. The relevant file under `.ai/tasks/`

## Maintenance Note
- `.agents/skills/` must remain agent-neutral.
- Vendor-specific commands and tool-local automation belong in `.claude/skills/` or other tool-local assets.
- `.agents/skills/` and `.claude/skills/` may intentionally drift.
- Update shared workflow rules in `.ai/`, not in shared or tool-local skill directories.
