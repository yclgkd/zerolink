---
name: base
description: Universal coding patterns, constraints, TDD workflow, atomic todos
---

# Base Skill - Universal Patterns

## Core Principle

Complexity is the enemy. Every line of code is a liability. The goal is software simple enough that any engineer (or AI) can understand the entire system in one session.

---

## Simplicity Rules (STRICTLY ENFORCED)

**CRITICAL: These limits are non-negotiable. The agent MUST check and enforce these limits for EVERY file created or modified.**

### Function Level
- **Maximum 20 lines per function** - if longer, decompose IMMEDIATELY
- **Maximum 3 parameters per function** - if more, use an options object or decompose
- **Maximum 2 levels of nesting** - flatten with early returns or extract functions
- **Single responsibility** - each function does exactly one thing
- **Descriptive names over comments** - if you need a comment to explain what, rename it

### File Level
- **Maximum 200 lines per file** - if longer, split by responsibility BEFORE continuing
- **Maximum 10 functions per file** - keeps cognitive load manageable
- **One export focus per file** - a file should have one primary purpose

### Module Level
- **Maximum 3 levels of directory nesting** - flat is better than nested
- **Clear boundaries** - each module has a single public interface
- **No circular dependencies** - ever

### Enforcement Protocol

**Before completing ANY file:**
1. Count total lines - if > 200, STOP and split
2. Count functions - if > 10, STOP and split
3. Check each function length - if any > 20 lines, STOP and decompose
4. Check parameter counts - if any > 3, STOP and refactor

**If limits are exceeded during development:**
```
⚠️ FILE SIZE VIOLATION DETECTED

[filename] has [X] lines (limit: 200)

Splitting into:
- [filename-a].ts - [responsibility A]
- [filename-b].ts - [responsibility B]
```

**Never defer refactoring.** Fix violations immediately, not "later".

---

## Architectural Patterns

### Functional Core, Imperative Shell
- Pure functions for business logic - no side effects, deterministic
- Side effects only at boundaries - API calls, database, file system at edges
- Data in, data out - functions transform data, they don't mutate state

### Composition Over Inheritance
- No inheritance deeper than 1 level - prefer interfaces/composition
- Small, composable utilities - build complex from simple
- Dependency injection - pass dependencies, don't import them directly

### Error Handling
- Fail fast, fail loud - errors surface immediately
- No silent failures - every error is logged or thrown
- Design APIs where misuse is impossible

---

## Testing Philosophy

- **100% coverage on business logic** - the functional core
- **Integration tests for boundaries** - API endpoints, database operations
- **No untested code merges** - CI blocks without passing tests
- **Test behavior, not implementation** - tests survive refactoring
- **Each test runs in isolation** - no interdependence

---

## Anti-Patterns (Never Do This)

- ❌ Global state
- ❌ Magic numbers/strings - use named constants
- ❌ Deep nesting - flatten or extract
- ❌ Long parameter lists - use objects
- ❌ Comments explaining "what" - code should be self-documenting
- ❌ Dead code - delete it, git remembers
- ❌ Copy-paste duplication - extract to shared function
- ❌ God objects/files - split by responsibility
- ❌ Circular dependencies
- ❌ Premature optimization
- ❌ Large PRs - small, focused changes only
- ❌ Mixing refactoring with features - separate commits

---

## Documentation Structure

Every project must have clear separation between code docs and project specs:

```
project/
├── docs/                      # Code documentation
│   ├── architecture.md        # System design decisions
│   ├── api.md                 # API reference (if applicable)
│   └── setup.md               # Development setup guide
├── _project_specs/            # Project specifications
│   ├── overview.md            # Project vision and goals
│   ├── features/              # Feature specifications
│   │   ├── feature-a.md
│   │   └── feature-b.md
│   ├── session/               # Session state (see session-management.md)
│   │   ├── current-state.md   # Live session state
│   │   ├── decisions.md       # Key decisions log
│   │   └── code-landmarks.md  # Important code locations
│   └── prompts/               # LLM prompt specifications (if AI-first)
└── AGENTS.md                  # Agent entrypoint doc (or CLAUDE.md / GEMINI.md)
```

### What Goes Where

| Location | Content |
|----------|---------|
| `docs/` | Technical documentation, API refs, setup guides |
| `_project_specs/` | Business logic, features, requirements, and session metadata |
| `_project_specs/session/` | Live session state, decisions, and code landmarks |
| `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` | Agent entrypoint instructions and skill references |

---

## Atomic Todos

All work is tracked as atomic todos with validation and test criteria.

### Todo Format (Required)
```markdown
## [TODO-001] Short descriptive title

**Status:** pending | in-progress | blocked | done
**Priority:** high | medium | low
**Estimate:** XS | S | M | L | XL

### Description
One paragraph describing what needs to be done.

### Acceptance Criteria
- [ ] Criterion 1 - specific, measurable
- [ ] Criterion 2 - specific, measurable

### Validation
How to verify this is complete:
- Manual: [steps to manually test]
- Automated: [test file/command that validates this]

### Test Cases
| Input | Expected Output | Notes |
|-------|-----------------|-------|
| ... | ... | ... |

### Dependencies
- Depends on: [TODO-xxx] (if any)
- Blocks: [TODO-yyy] (if any)

### TDD Execution Log
| Phase | Command | Result | Timestamp |
|-------|---------|--------|-----------|
| RED | `[test command]` | - | - |
| GREEN | `[test command]` | - | - |
| VALIDATE | `[lint && typecheck && test --coverage]` | - | - |
| COMPLETE | Checkpoint recorded in `current-state.md` | - | - |
```

### Todo Rules
1. **Atomic** - Each todo is a single, completable unit of work
2. **Testable** - Every todo has validation criteria and test cases
3. **Sized** - If larger than "M", break it down further
4. **Independent** - Minimize dependencies between todos
5. **Tracked** - Keep active and freshly finished work in `current-state.md`; log durable rationale in `decisions.md`

### Todo Execution Workflow (TDD - Mandatory)

**Every todo MUST follow this exact workflow. No exceptions.**

```
┌─────────────────────────────────────────────────────────────┐
│  1. RED: Write Tests First                                  │
│     └─ Create test file(s) based on Test Cases table        │
│     └─ Tests should cover all acceptance criteria           │
│     └─ Run tests → ALL MUST FAIL (proves tests are valid)   │
├─────────────────────────────────────────────────────────────┤
│  2. GREEN: Implement the Feature                            │
│     └─ Write minimum code to make tests pass                │
│     └─ Follow simplicity rules (20 lines/function, etc.)    │
│     └─ Run tests → ALL MUST PASS                            │
├─────────────────────────────────────────────────────────────┤
│  3. VALIDATE: Quality Gates                                 │
│     └─ Run linter (auto-fix if possible)                    │
│     └─ Run type checker (tsc/mypy/pyright)                  │
│     └─ Run full test suite with coverage                    │
│     └─ Verify coverage threshold (≥80%)                     │
├─────────────────────────────────────────────────────────────┤
│  4. COMPLETE: Mark Done                                     │
│     └─ Only after ALL validations pass                      │
│     └─ Update current-state.md and related session files    │
│     └─ Checkpoint session state                             │
└─────────────────────────────────────────────────────────────┘
```

#### Execution Commands by Stack

**Node.js/TypeScript:**
```bash
# 1. RED - Run tests (expect failures)
npm test -- --grep "todo-description"

# 2. GREEN - Run tests (expect pass)
npm test -- --grep "todo-description"

# 3. VALIDATE - Full quality check
npm run lint && npm run typecheck && npm test -- --coverage
```

**Python:**
```bash
# 1. RED - Run tests (expect failures)
pytest -k "todo_description" -v

# 2. GREEN - Run tests (expect pass)
pytest -k "todo_description" -v

# 3. VALIDATE - Full quality check
ruff check . && mypy . && pytest --cov --cov-fail-under=80
```

**React/Next.js:**
```bash
# 1. RED - Run tests (expect failures)
npm test -- --testPathPattern="ComponentName"

# 2. GREEN - Run tests (expect pass)
npm test -- --testPathPattern="ComponentName"

# 3. VALIDATE - Full quality check
npm run lint && npm run typecheck && npm test -- --coverage --watchAll=false
```

#### Blocking Conditions

**NEVER mark a todo as complete if:**
- ❌ Tests were not written first (skipped RED phase)
- ❌ Tests did not fail initially (invalid tests)
- ❌ Any test is failing
- ❌ Linter has errors (warnings may be acceptable)
- ❌ Type checker has errors
- ❌ Coverage dropped below threshold

**If blocked by failures:**
```markdown
## [TODO-042] - BLOCKED

**Blocking Reason:** [Lint error in X / Test failure in Y / Coverage at 75%]
**Action Required:** [Specific fix needed]
```

### Bug Fix Workflow (TDD - Mandatory)

**When a user reports a bug, NEVER jump to fixing it directly.**

```
┌─────────────────────────────────────────────────────────────┐
│  1. DIAGNOSE: Identify the Test Gap                         │
│     └─ Run existing tests - do any fail?                    │
│     └─ If tests pass but bug exists → tests are incomplete  │
│     └─ Document: "Test gap: [what was missed]"              │
├─────────────────────────────────────────────────────────────┤
│  2. RED: Write a Failing Test for the Bug                   │
│     └─ Create test that reproduces the exact bug            │
│     └─ Test should FAIL with current code                   │
│     └─ This proves the test catches the bug                 │
├─────────────────────────────────────────────────────────────┤
│  3. GREEN: Fix the Bug                                      │
│     └─ Write minimum code to make the test pass             │
│     └─ Run test → must PASS now                             │
├─────────────────────────────────────────────────────────────┤
│  4. VALIDATE: Full Quality Check                            │
│     └─ Run ALL tests (not just the new one)                 │
│     └─ Run linter and type checker                          │
│     └─ Verify no regression in coverage                     │
└─────────────────────────────────────────────────────────────┘
```

#### Bug Report Todo Format

```markdown
## [BUG-001] Short description of the bug

**Status:** pending
**Priority:** high
**Reported:** [how user reported it / reproduction steps]

### Bug Description
What is happening vs. what should happen.

### Reproduction Steps
1. Step one
2. Step two
3. Observe: [incorrect behavior]
4. Expected: [correct behavior]

### Test Gap Analysis
- Existing test coverage: [list relevant test files]
- Gap identified: [what the tests missed]
- New test needed: [describe the test to add]

### Test Cases for Bug
| Input | Current (Bug) | Expected (Fixed) |
|-------|---------------|------------------|
| ... | ... | ... |

### TDD Execution Log
| Phase | Command | Result | Timestamp |
|-------|---------|--------|-----------|
| DIAGNOSE | `npm test` | All pass (gap!) | - |
| RED | `npm test -- --grep "bug description"` | 1 test failed ✓ | - |
| GREEN | `npm test -- --grep "bug description"` | 1 test passed ✓ | - |
| VALIDATE | `npm run lint && npm run typecheck && npm test -- --coverage` | Pass ✓ | - |
```

#### Bug Fix Anti-Patterns

- ❌ **Fixing without a test** - Bug will likely return
- ❌ **Writing test after fix** - Can't prove test catches the bug
- ❌ **Skipping test gap analysis** - Misses why tests didn't catch it
- ❌ **Only testing the fix** - Must run full test suite for regressions

### Example Atomic Todo
```markdown
## [TODO-042] Add email validation to signup form

**Status:** pending
**Priority:** high
**Estimate:** S

### Description
Validate email format on the signup form before submission. Show inline error if invalid.

### Acceptance Criteria
- [ ] Email field shows error for invalid format
- [ ] Error clears when user fixes the email
- [ ] Form cannot submit with invalid email
- [ ] Valid emails pass through without error

### Validation
- Manual: Enter "notanemail" in signup form, verify error appears
- Automated: `npm test -- --grep "email validation"`

### Test Cases
| Input | Expected Output | Notes |
|-------|-----------------|-------|
| user@example.com | Valid, no error | Standard email |
| user@sub.example.com | Valid, no error | Subdomain |
| notanemail | Invalid, show error | No @ symbol |
| user@ | Invalid, show error | No domain |
| @example.com | Invalid, show error | No local part |

### Dependencies
- Depends on: [TODO-041] Signup form component
- Blocks: [TODO-045] Signup flow integration test

### TDD Execution Log
| Phase | Command | Result | Timestamp |
|-------|---------|--------|-----------|
| RED | `npm test -- --grep "email validation"` | 5 tests failed ✓ | - |
| GREEN | `npm test -- --grep "email validation"` | 5 tests passed ✓ | - |
| VALIDATE | `npm run lint && npm run typecheck && npm test -- --coverage` | Pass, 84% coverage ✓ | - |
| COMPLETE | Checkpoint recorded in `current-state.md` | ✓ | - |
```

---

## Credentials Management (Non-Negotiable)

When a project needs API keys, always ask the user for their centralized access file first.

### Workflow
```
1. Ask: "Do you have an access keys file? (e.g., ~/Documents/Access.txt)"
2. Read and parse the file for known key patterns
3. Validate keys are working
4. Create project .env with found keys
5. Report missing keys and where to get them
```

### Key Patterns to Detect
| Service | Pattern | Env Variable |
|---------|---------|--------------|
| OpenAI | `sk-proj-*` | `OPENAI_API_KEY` |
| Claude | `sk-ant-*` | `ANTHROPIC_API_KEY` |
| Render | `rnd_*` | `RENDER_API_KEY` |
| Replicate | `r8_*` | `REPLICATE_API_TOKEN` |
| Reddit | client_id + secret | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` |

See `credentials.md` for full parsing logic and validation commands.

---

## Security (Non-Negotiable)

Every project must meet these security requirements. See `security.md` skill for detailed patterns.

### Essential Security Checks
1. **No secrets in code** - Use environment variables, never commit secrets
2. **`.env` in `.gitignore`** - Always, no exceptions
3. **No secrets in client-exposed env vars** - Never use `VITE_*`, `NEXT_PUBLIC_*` for secrets
4. **Validate all input** - Use Zod/Pydantic at API boundaries
5. **Parameterized queries only** - No string concatenation for SQL
6. **Hash passwords properly** - bcrypt with 12+ rounds
7. **Dependency scanning** - npm audit / safety check must pass

### Required Files
- `.gitignore` with secrets patterns
- `.env.example` with all required vars (no values)
- `scripts/security-check.sh` for pre-commit validation

### Security in CI
Every PR must pass:
- Secret scanning (detect-secrets / trufflehog)
- Dependency audit (npm audit / safety)
- Static analysis (CodeQL)

---

## Quality Gates (Non-Negotiable)

### Coverage Threshold
- **Minimum 80% code coverage** - CI must fail below this
- Business logic (core/) should aim for 100%
- Integration tests cover boundaries

### Pre-Commit Hooks
All projects must have pre-commit hooks that run:
1. Linting (auto-fix where possible)
2. Type checking
3. Tests (at minimum, affected tests)

This catches issues before they hit CI, saving time and keeping the main branch clean.

---

## Session Management (Non-Negotiable)

Maintain context for resumability. See `session-management.md` for full details.

### Core Rule: Checkpoint at Natural Breakpoints

After completing any task, ask:
1. **Decision made?** → Log to `_project_specs/session/decisions.md`
2. **>10 tool calls?** → Full checkpoint to `current-state.md`
3. **Major feature done?** → Full checkpoint and update `code-landmarks.md` if navigation changed
4. **Otherwise** → Quick update to `current-state.md`

### Session Start
1. Read `_project_specs/session/current-state.md`
2. Review documented "Next Steps"
3. Review `decisions.md` or `code-landmarks.md` only if recent rationale or navigation matters

### Session End
1. Update `current-state.md` with handoff notes
2. Sync `decisions.md` / `code-landmarks.md` if workflow or entrypoints changed
3. Ensure next steps are specific and actionable

---

## Response Format

When implementing features (following TDD):
1. **Clarify requirements** if ambiguous
2. **Propose structure** - outline before code
3. **Write tests FIRST** - based on test cases table (RED phase)
4. **Run tests to verify they fail** - proves tests are valid
5. **Implement minimum code** to make tests pass (GREEN phase)
6. **Run full validation** - lint, typecheck, coverage (VALIDATE phase)
7. **Flag complexity** - warn if approaching limits
8. **Checkpoint after completing** - update session state, log TDD execution

**TDD is non-negotiable.** Tests must exist and fail before any implementation begins.

When you notice code violating these rules, **stop and refactor** before continuing.

---

## Automatic Iterative TDD Mode

**For any non-trivial task, the agent MUST use iterative TDD loops.**

### When to Use Iterative TDD

| Task Type | Action |
|-----------|--------|
| New feature (any size) | Use a full RED -> GREEN -> VALIDATE cycle |
| Bug fix | Reproduce with a failing test first |
| Refactoring | Lock behavior with tests before changing structure |
| API development | Define contracts and tests before implementation |
| Simple question or explanation | No TDD loop required |
| One-line typo or wording fix | Use judgment; tests may be unnecessary |

### Default Iteration Workflow

For requests such as:
- "Add email validation"
- "Fix the login bug"
- "Build a REST API for todos"
- "Refactor the auth module"

the agent should:

1. **Extract requirements** from the request.
2. **Define completion criteria** such as tests passing, lint clean, and typecheck clean.
3. **Write failing tests first** for the requested behavior or bug.
4. **Implement the minimum change** to make the tests pass.
5. **Run validation** including lint, typecheck, and relevant tests.
6. **Repeat the loop** until the completion criteria are satisfied.

### Completion Criteria Template

Use a checklist like this for non-trivial work:
- [ ] All relevant tests pass
- [ ] New behavior is covered by tests
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Security-sensitive paths were reviewed when applicable

### Opt-Out

Iterative TDD can be skipped only when the task is truly non-implementation work, such as:
- Explanation only
- Small copy edit
- Metadata-only documentation change
