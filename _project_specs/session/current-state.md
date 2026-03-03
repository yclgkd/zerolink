# Current Session State

*Last updated: 2026-03-03*

## Active Task
Restructuring the repo instruction system for Claude, generic agents, and Gemini CLI.

## Current Status
- **Phase**: Documentation workflow refactor
- **Progress**: Root agent entrypoints, shared `.ai/` docs, and the `.agents/skills/` compatibility layout have been added on the working branch.
- **Blocking Issues**: None

## Context Summary
- Shared agent guidance is moving out of a long `CLAUDE.md` into short root routers plus `.ai/`.
- `.agents/skills/` has been added as a compatibility copy of `.claude/skills/`.
- AI-authored changes now require `branch -> PR -> merge`; direct implementation pushes to `main` are disallowed.
- Branch names now use `<type>/<short-name>` and never include task IDs.
- Tool-authorship wording is disallowed in code, commits, PRs, and PR comments.

## Files Recently Modified
| File | Status | Notes |
|------|--------|-------|
| `CLAUDE.md` | rewritten | Reduced to a short Claude router |
| `AGENTS.md` | created | Generic agent entrypoint |
| `GEMINI.md` | created | Gemini CLI entrypoint |
| `.ai/` | created | Shared workflow and project guidance |
| `.agents/skills/` | created | Compatibility copy of `.claude/skills/` |

## Next Steps
1. [ ] Review the diff for scope and wording compliance.
2. [ ] Record validation results, including the existing unrelated lint failures.
3. [ ] Commit the doc and workflow change on the branch.
4. [ ] Push the branch and open a PR.

## Key Context to Preserve
- `.ai/` is the canonical shared guidance layer.
- `.agents/skills/` is a compatibility copy and may drift from `.claude/skills/`.
- Task IDs stay in issues and PRs, not in branch names.
- Neutral wording rules apply to code, commits, PRs, and PR comments.

## Resume Instructions
1. Review `.ai/workflows.md`.
2. Review `docs/TASK_BREAKDOWN.md`, `.github/ISSUE_TEMPLATE/ai-task.md`, and `scripts/create-task-issues.sh`.
3. Run validation and prepare the PR.
