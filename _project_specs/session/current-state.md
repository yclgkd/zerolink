# Current Session State

*Last updated: 2026-03-03*

## Active Task
Fixing multi-agent instruction regressions in the shared skills and root entrypoints.

## Current Status
- **Phase**: Documentation regression fix -> validation complete
- **Progress**: Shared `.agents/skills/` guidance has been neutralized, `CLAUDE.md` now restores explicit Claude-local skill loading, and the shared guidance docs now define the shared/local skill boundary. Static validation for forbidden Claude-only strings passed.
- **Blocking Issues**: None

## Context Summary
- The first multi-agent doc refactor left Claude-only commands inside `.agents/skills/`, which broke the new agent-neutral contract.
- `CLAUDE.md` also lost its explicit `.claude/skills/*` entrypoint list, weakening the Claude-local workflow.
- This follow-up change keeps `.ai/` as the shared source of truth while separating agent-neutral shared skills from Claude-local execution guidance.

## Files Recently Modified
| File | Status | Notes |
|------|--------|-------|
| `CLAUDE.md` | updated | Restored explicit Claude-local mandatory skill loading |
| `AGENTS.md` | updated | Clarified `.agents/skills/` as agent-neutral |
| `GEMINI.md` | updated | Clarified `.agents/skills/` as agent-neutral |
| `.ai/` | updated | Shared workflow guardrails now define the shared/local skill boundary |
| `.agents/skills/` | updated | Shared skills are being rewritten as agent-neutral guidance |

## Next Steps
1. [ ] Review the final diff for wording and scope one last time.
2. [ ] Commit the regression fix on the branch.
3. [ ] Push the branch.
4. [ ] Open the PR for review.

## Key Context to Preserve
- `.ai/` is the canonical shared guidance layer.
- `.agents/skills/` is the agent-neutral shared skills layer.
- `.claude/skills/` is the Claude-local execution layer.
- The two skill directories may intentionally drift.
- Task IDs stay in issues and PRs, not in branch names.
- Neutral wording rules apply to code, commits, PRs, and PR comments.

## Resume Instructions
1. Review `CLAUDE.md`, `.ai/README.md`, and `.ai/workflows.md`.
2. Review `.agents/skills/code-review/SKILL.md` and `.agents/skills/base/SKILL.md` for the shared-skill boundary.
3. Prepare the commit and PR.
