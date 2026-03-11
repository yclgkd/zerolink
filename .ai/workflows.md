# Workflows

## Branch and PR Policy
- Start every AI-authored change from a new branch.
- Open a PR for every AI-authored change.
- Never push implementation changes directly to `main`.
- Do not do implementation work on `main`.
- Keep each branch scoped to one logical change.
- If the current branch already has an open PR and the task is addressing that PR's review, comments, or follow-up fixes, continue on the existing branch instead of creating a new one.
- Do not create a child branch or a second PR for review-driven fixes unless the user explicitly asks for a stacked PR.

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
2. Check whether the current branch already maps to an open PR and whether the task is a review or follow-up fix for that PR.
3. If it is a follow-up on an open PR, continue on the current branch. Otherwise create a new branch from `main`.
4. Make the smallest correct change.
5. Run relevant validation.
6. Update `_project_specs/`.
7. Commit with a Conventional Commit message.
8. Push the branch.
9. Open a PR with summary, validation, risk, and rollback if the work is not already attached to an open PR.

## _project_specs Updates
- Update `_project_specs/session/current-state.md` when active focus or status changes.
- Append important workflow or architecture changes to `_project_specs/session/decisions.md`.
- Archive finished work in `_project_specs/session/archive/completed.md`.
- Add landmarks when new entrypoints or shared workflow files are introduced.

## Validation
- Run targeted checks for the touched area.
- Run `git diff --check` before commit.
- Keep the diff reviewable and scoped.

## Decision Log
- Record changes to repo-wide workflow, architecture, security posture, or developer conventions.

## Skills Directories
- `.ai/` holds shared guidance.
- `.agents/skills/` is the agent-neutral shared skills layer.
- `.agents/skills/` must not require vendor-specific CLIs, slash commands, or a single tool-specific entrypoint.
- `.claude/skills/` remains Claude-local and may contain Claude-specific operational instructions.
- `.agents/skills/` and `.claude/skills/` may intentionally drift.
- When shared and local skills diverge, shared workflow rules still belong in `.ai/`.
- Keep shared workflow rules in `.ai/`, not in shared or tool-local skill directories.
