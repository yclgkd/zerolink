---
name: code-review
description: Mandatory code reviews before commits and deploys
---

# Code Review Skill

*Load with: base.md*

**Purpose:** Enforce automated code reviews as a mandatory guardrail before every commit and deployment. Use the current environment's review capability when available, or perform a structured manual diff review against the base branch.

---

## Core Philosophy

Code review is non-negotiable:
- Every commit should pass review.
- Every PR should be reviewed before merge.
- Every deployment should include review sign-off.
- Tests catch correctness issues; review catches security, performance, and maintainability gaps.

---

## When to Run Code Review

### Mandatory Review Points

| Trigger | Action |
|---------|--------|
| Before commit | Review staged or local changes |
| Before PR | Review the full branch diff against the base branch |
| Before merge | Re-check the final PR state |
| Before deploy | Review the deployment diff and rollback assumptions |

### Commit Workflow

1. Write or update tests.
2. Run relevant validation.
3. Review the diff with a review tool or manual diff inspection.
4. Fix all critical and high-severity issues.
5. Commit only after the review is clean.

Skipping review is a workflow failure, not an optional shortcut.

---

## How to Review

### Preferred Order

1. Use the environment's native review capability if one exists.
2. Otherwise review the diff directly with `git diff --cached` before commit.
3. For branch-wide review, inspect `git diff <base>...HEAD`.
4. Re-run focused validation for any risk areas you touched while addressing review findings.

### Structured Manual Review

When reviewing manually, check the diff in this order:

1. Public interfaces: contracts, schemas, types, CLI flags, config keys.
2. Behavior: correctness, edge cases, state transitions, error handling.
3. Security: secrets, input validation, auth, crypto, permissions.
4. Performance: wasteful loops, duplicate work, large payloads, missing batching.
5. Maintainability: complexity, duplication, confusing coupling, missing tests.

### Review Categories

| Category | What It Checks |
|----------|----------------|
| Security | Vulnerabilities, injection risks, auth gaps, secrets exposure |
| Performance | N+1 patterns, memory leaks, inefficient algorithms |
| Architecture | Layering, coupling, design consistency |
| Code Quality | Readability, complexity, duplication |
| Best Practices | Language idioms, framework conventions |
| Testing | Coverage gaps, weak assertions, missing edge cases |
| Documentation | Missing or stale docs, unclear rollout notes |

### Severity Levels

| Level | Action Required | Can Commit? |
|-------|-----------------|-------------|
| Critical | Must fix immediately | No |
| High | Should fix before commit | No |
| Medium | Fix soon, can commit with awareness | Yes |
| Low | Nice to have | Yes |
| Info | Suggestion only | Yes |

---

## Review Checklist

### Before Every Commit

- [ ] Reviewed the changed files or staged diff
- [ ] No critical issues remain
- [ ] No high-severity issues remain
- [ ] Security-sensitive paths were checked explicitly
- [ ] Tests cover new or changed behavior

### Before Every PR

- [ ] Reviewed the full branch diff against the base branch
- [ ] Acceptance criteria still match the implementation
- [ ] Documentation and rollout notes are updated when needed
- [ ] Validation results are recorded accurately

### Before Every Deployment

- [ ] Final diff was reviewed after the last merge or rebase
- [ ] Security assumptions still hold in the deployed environment
- [ ] Rollback path is documented and still viable

---

## Common Review Findings

### Security Issues

| Issue | Example | Fix |
|-------|---------|-----|
| SQL injection | Interpolated SQL strings | Use parameterized queries |
| XSS | Raw `innerHTML` from user input | Sanitize or render as text |
| Secrets in code | Hard-coded tokens or keys | Move to environment variables |
| Missing auth | Sensitive route without auth | Add auth middleware or guards |
| Insecure crypto | Weak hashing or custom crypto | Use vetted primitives |

### Performance Issues

| Issue | Example | Fix |
|-------|---------|-----|
| N+1 queries | Loop with one query per item | Batch or eager-load |
| Memory leak | Unclosed handles or listeners | Clean up resources |
| Missing index | Slow hot-path query | Add or tune indexes |
| Large payload | Fetching unused fields | Select only required fields |
| No pagination | Loading every record | Paginate or stream |

### Maintainability Issues

| Issue | Example | Fix |
|-------|---------|-----|
| Long function | 100+ line handler | Extract helpers |
| Deep nesting | 5+ nested conditionals | Use early returns |
| Magic values | `if (status === 3)` | Use named constants |
| Duplicate logic | Repeated validation blocks | Extract shared utility |
| Missing types | Overuse of `any` | Add explicit types |

---

## Review Response Template

When review finds issues, summarize them with severity, impact, and the required follow-up:

```markdown
## Code Review Results

### Critical Issues
1. Short summary of the blocking issue
   - Impact: why this breaks correctness, security, or reliability
   - Fix: the required remediation

### High Issues
1. Short summary of the urgent issue
   - Impact: where it appears and who it affects
   - Fix: the required remediation

### Medium Issues
1. Short summary of a follow-up item

### Low Issues
1. Optional improvement

### Summary
- Critical: 0
- High: 0
- Medium: 1
- Low: 1
- Status: Ready to commit
```

---

## Agent Workflow

### When to Trigger Review

The agent should automatically trigger or suggest review:

1. After completing a feature
2. Before creating a PR
3. When the user asks to commit or merge
4. After fixing a bug or regression

### Focus Areas by Change Type

| Change Type | Focus Areas |
|-------------|-------------|
| Auth or security code | Security, input validation, crypto, permissions |
| Database code | Query safety, indexes, transactions, data shape |
| API endpoints | Auth, validation, rate limiting, error handling |
| Frontend code | XSS, state management, render performance |
| Infrastructure | Secrets, permissions, logging, rollback plan |

### Manual Review Fallback

If no specialized review tool is available, the agent should:

1. Inspect the diff directly.
2. Enumerate findings by severity.
3. Confirm whether critical or high issues remain.
4. Block commit or deploy until blocking issues are resolved.

---

## Integration with TDD Workflow

1. RED: Write failing tests.
2. GREEN: Implement the minimum change.
3. REFACTOR: Simplify the implementation.
4. REVIEW: Inspect the diff for bugs and risks.
5. FIX: Resolve critical and high-severity findings.
6. VALIDATE: Run lint, typecheck, and tests.
7. COMMIT: Only after the review is clean.

---

## Quick Reference

### Severity Actions

```text
Critical -> Stop. Fix now. No commit.
High     -> Stop. Fix now. No commit.
Medium   -> Track it. Fix soon. Commit allowed.
Low      -> Optional improvement.
Info     -> Context only.
```

### Minimal Workflow

```text
Code -> Test -> Review -> Fix -> Validate -> Commit -> Push -> PR -> Merge -> Deploy
```
