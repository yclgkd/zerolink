# Current Session State

*Last updated: 2026-03-03*

## Active Task
Moving the regression fix back onto PR85 and codifying the "follow-up fixes stay on the existing PR branch" rule.

## Current Status
- **Phase**: PR hygiene correction
- **Progress**: The shared-skill regression fix has been cherry-picked onto `docs/multi-agent-instructions` so PR85 is the source of truth again, and the workflow docs are being updated to require follow-up fixes on the existing open PR branch.
- **Blocking Issues**: None

## Context Summary
- The regression fix no longer lives only on a separate child branch; it has been moved back onto `docs/multi-agent-instructions` so PR85 remains the review surface.
- The workflow docs now need an explicit exception to the "new branch for every change" rule so review-driven fixes do not spawn redundant PRs.
- PR86 should be closed after the updated PR85 branch is pushed.

## Files Recently Modified
| File | Status | Notes |
|------|--------|-------|
| `CLAUDE.md` | updated | Restored explicit Claude-local mandatory skill loading |
| `AGENTS.md` | updated | Clarified `.agents/skills/` as agent-neutral and added the follow-up-on-existing-PR rule |
| `GEMINI.md` | updated | Clarified `.agents/skills/` as agent-neutral |
| `.ai/` | updated | Shared workflow guardrails now define the shared/local skill boundary and the existing-PR follow-up rule |
| `.agents/skills/` | updated | Shared skills are being rewritten as agent-neutral guidance |

## Next Steps
1. [ ] Run `git diff --check` and a final wording pass.
2. [ ] Commit the branch-rule update on `docs/multi-agent-instructions`.
3. [ ] Push `docs/multi-agent-instructions` to update PR85.
4. [ ] Close PR86.

## Key Context to Preserve
- `.ai/` is the canonical shared guidance layer.
- `.agents/skills/` is the agent-neutral shared skills layer.
- `.claude/skills/` is the Claude-local execution layer.
- The two skill directories may intentionally drift.
- Task IDs stay in issues and PRs, not in branch names.
- Neutral wording rules apply to code, commits, PRs, and PR comments.

## Resume Instructions
1. Review `.ai/workflows.md` and `AGENTS.md` for the follow-up-on-existing-PR rule.
2. Confirm PR85 is updated from `docs/multi-agent-instructions`.
3. Close PR86 after push.
