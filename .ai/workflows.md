# Workflows

## Branch and PR Policy
- Start every AI-authored change from a new branch.
- Open a PR for every AI-authored change.
- Never push implementation changes directly to `main`.
- Do not do implementation work on `main`.
- Keep each branch scoped to one logical change.

## Branch Naming
- Use `<type>/<short-name>`.
- Use kebab-case for `short-name`.
- `type` must be one of: `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`, `revert`.
- Do not include task IDs in branch names.
- Do not use `task/`, `codex/`, `ai/`, `agent/`, `tmp/`, or `misc/` prefixes.

## Task Tracking
- Track task IDs in issue links, PR references, and optional PR titles.
- Branch names do not carry task IDs.

## AI Output Wording
- Use neutral, project-focused wording only.
- Do not mention Codex, Claude, Gemini, AI generation, or tool authorship in source code, comments, commit messages, PR titles, PR bodies, or PR comments.

## AI Change Flow
1. Read `.ai/workflows.md`, `.ai/project-context.md`, `.ai/coding-standards.md`, and the relevant task doc.
2. Create a new branch from `main`.
3. Make the smallest correct change.
4. Run relevant validation.
5. Update `_project_specs/`.
6. Commit with a Conventional Commit message.
7. Push the branch.
8. Open a PR with summary, validation, risk, and rollback.

## _project_specs Updates
- Update `_project_specs/session/current-state.md` when active focus or status changes.
- Append important workflow or architecture changes to `_project_specs/session/decisions.md`.
- Move finished work into `_project_specs/todos/completed.md`.
- Add landmarks when new entrypoints or shared workflow files are introduced.

## Validation
- Run targeted checks for the touched area.
- Run `git diff --check` before commit.
- Keep the diff reviewable and scoped.

## Decision Log
- Record changes to repo-wide workflow, architecture, security posture, or developer conventions.

## Skills Directories
- `.ai/` holds shared guidance.
- `.agents/skills/` is a general skills compatibility directory.
- `.claude/skills/` remains Claude-local.
- `.agents/skills/` is currently a copy of `.claude/skills/` and may drift.
- Keep shared workflow rules in `.ai/`, not in copied skills.
