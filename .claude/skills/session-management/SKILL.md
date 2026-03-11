---
name: session-management
description: Context preservation, tiered summarization, resumability
---

# Session Management Skill

*Load with: base.md*

For maintaining context across long development sessions and enabling seamless resume after breaks.

---

## Core Principle

**Checkpoint at natural breakpoints, resume instantly.**

Long development sessions risk context loss. Proactively document state, decisions, and progress so any session can resume exactly where it left off - whether returning after a break or hitting context limits.

---

## Durable Context Rules

### Tier 1: No Repo Update Needed
**Trigger**: After completing a small task whose state is already obvious from the diff, commit history, or open PR
**Action**: Do not write a repo-local status log; rely on git/worktree/PR context
**Time**: ~0 seconds

### Tier 2: Decision Checkpoint (`decisions.md`)
**Trigger**:
- After any architectural, workflow, security, or tooling decision
- When a trade-off would be hard to reconstruct from code review alone

**Action**:
1. Add or update a dated entry in `decisions.md`
2. Record the reasoning, trade-offs, and follow-up if needed

### Tier 3: Navigation Checkpoint (`code-landmarks.md`)
**Trigger**:
- When adding new entrypoints or shared workflow files
- When discovering a non-obvious gotcha that future sessions should not re-learn
- When a refactor changes where the important code now lives

**Action**:
1. Update `code-landmarks.md`
2. Keep entries terse and durable

### Decision Heuristic
```
┌─────────────────────────────────────────────────────┐
│ After completing work, ask:                         │
├─────────────────────────────────────────────────────┤
│ Was a decision made?        → Log to decisions.md   │
│ Did navigation change?      → Update landmarks      │
│ Is this only transient status? → Keep it in git/PR  │
│ Otherwise                   → No repo-local update  │
└─────────────────────────────────────────────────────┘
```

---

## Session State Structure

Create `_project_specs/session/` directory:

```
_project_specs/
└── session/
    ├── decisions.md          # Key decisions log (append-only)
    └── code-landmarks.md     # Important code locations
```

---

## Volatile State

Do not keep a repo-local session-status file. For "what is happening now", use:

- `git status --short --branch`
- recent commits on the current branch
- the open PR discussion / review comments
- the current diff

Use `_project_specs/` only for durable context that git history does not explain well.

```markdown
# Durable context only

- Use `decisions.md` for "why"
- Use `code-landmarks.md` for "where"
- Use git / PR / current diff for "what is happening now"
```

---

## Decision Log

**`_project_specs/session/decisions.md`** - Append-only log of architectural and implementation decisions.

```markdown
# Decision Log

Track key decisions for future reference. Never delete entries.

---

## [2025-01-15] JWT Algorithm Choice

**Decision**: Use RS256 instead of HS256 for JWT signing

**Context**: Implementing authentication system

**Options Considered**:
1. HS256 (symmetric) - Simpler, single secret
2. RS256 (asymmetric) - Public/private key pair

**Choice**: RS256

**Reasoning**:
- Allows token verification without exposing signing key
- Better for microservices (services only need public key)
- Industry standard for production systems

**Trade-offs**:
- Slightly more complex key management
- Larger token size

**References**:
- src/auth/keys/ - Key storage
- docs/security.md - Security architecture

---

## [2025-01-14] Database Schema Approach

**Decision**: Use Drizzle ORM with PostgreSQL

**Context**: Setting up data layer

**Options Considered**:
1. Prisma - Popular, good DX
2. Drizzle - Type-safe, SQL-like
3. Raw SQL - Maximum control

**Choice**: Drizzle

**Reasoning**:
- Better TypeScript inference than Prisma
- More transparent SQL generation
- Lighter weight, faster cold starts

**References**:
- src/db/schema.ts - Schema definitions
- src/db/migrations/ - Migration files
```

---

## Code Landmarks

**`_project_specs/session/code-landmarks.md`** - Important code locations for quick reference.

```markdown
# Code Landmarks

Quick reference to important parts of the codebase.

## Entry Points
| Location | Purpose |
|----------|---------|
| src/index.ts | Main application entry |
| src/api/routes.ts | API route definitions |
| src/workers/index.ts | Background job entry |

## Core Business Logic
| Location | Purpose |
|----------|---------|
| src/core/auth/ | Authentication system |
| src/core/billing/ | Payment processing |
| src/core/workflows/ | Main workflow engine |

## Configuration
| Location | Purpose |
|----------|---------|
| src/config/index.ts | Environment config |
| src/config/features.ts | Feature flags |
| drizzle.config.ts | Database config |

## Key Patterns
| Pattern | Example Location | Notes |
|---------|------------------|-------|
| Service Layer | src/services/user.ts | Business logic encapsulation |
| Repository | src/repos/user.ts | Data access abstraction |
| Middleware | src/middleware/auth.ts | Request processing |

## Testing
| Location | Purpose |
|----------|---------|
| tests/unit/ | Unit tests |
| tests/integration/ | API tests |
| tests/e2e/ | End-to-end tests |
| tests/fixtures/ | Test data |

## Gotchas & Non-Obvious Behavior
| Location | Issue | Notes |
|----------|-------|-------|
| src/utils/date.ts | Timezone handling | Always use UTC internally |
| src/api/middleware.ts:45 | Auth bypass | Skip auth for health checks |
| src/db/pool.ts | Connection limit | Max 10 connections in dev |
```

---

## CLAUDE.md Session Rules

Add this section to CLAUDE.md:

```markdown
## Session Management

**IMPORTANT**: Follow session-management.md skill. Only write durable context into `_project_specs/`.

### After Every Task Completion
Ask yourself:
1. Was a decision made? → Log to `decisions.md`
2. Did a key entrypoint / gotcha change? → Update `code-landmarks.md`
3. Otherwise → Keep progress in git / PR context only

### Checkpoint Triggers
**Decision Checkpoint** (`decisions.md`):
- After any meaningful decision
- After significant trade-off discussions

**Navigation Checkpoint** (`code-landmarks.md`):
- After refactors that move key files
- After discovering durable gotchas

**No Repo Update**:
- For ordinary progress that is already visible in git / PR context

### Session Start Protocol
When beginning work:
1. Check `git status --short --branch`
2. Review recent commits or the open PR if needed
3. Review `decisions.md` if you need rationale
4. Review `code-landmarks.md` if you need navigation back into an unfamiliar area

### Session End Protocol
Before ending or when context limit approaches:
1. Make sure the current diff or commit history reflects progress clearly
2. Log any durable decisions in `decisions.md`
3. Update `code-landmarks.md` if new entrypoints or gotchas were introduced
4. Leave explicit next steps in the PR or final response when relevant
```

---

## Compression Strategies

### When to Compress (Tier 3 Handoff)

| Trigger | Action |
|---------|--------|
| ~50+ tool calls | Prefer a commit or PR update over a repo-local status file |
| Major feature complete | Update `decisions.md` / `code-landmarks.md` if durable context changed |
| Context shift | Review branch/PR state, then refresh only durable notes |
| End of session | Leave next steps in the PR or final response if needed |

### What to Keep vs Compress

**Keep in active context:**
- Branch/worktree status
- Current diff and recent commits
- PR discussion and review notes
- Key decisions affecting current work

**Compress/summarize:**
- Exploration paths that didn't work out
- Detailed debugging traces (keep conclusion only)
- Verbose error messages (keep root cause only)
- Research notes (keep recommendations only)

### Compression Template

When compressing, use this format:

```markdown
## Compressed Context - [Topic]

**Summary**: [1-2 sentences]

**Key Findings**:
- [Bullet points of important discoveries]

**Decisions Made**:
- [Reference to decisions.md entries]

**Relevant Code**:
- [File:line references]

**Stored In**: git / PR context (+ `decisions.md` / `code-landmarks.md` if needed)
```

---

## Session Handoff

After significant work or at session end, leave handoff context in the PR or final response instead of creating a repo-local status file:

```markdown
Next steps:
1. Add integration coverage for refresh-token expiry.
2. Update `decisions.md` if token storage policy changes.
```

---

## Integration with Task Tracking

### Link Tracked Tasks to Sessions

In your active task notes or issue tracker, reference session context:

```markdown
## [TODO-042] Implement token refresh

**Status:** in-progress
**Session Context:** See branch history / PR discussion

### Progress Notes
- 2025-01-15: Started implementation, base structure done
- 2025-01-15: Added rotation logic, need error handling
```

### Auto-Update on Task Completion

When completing a tracked task:
1. Make sure the diff / commit / PR clearly reflects the completed work
2. Log any durable decisions in `decisions.md`
3. Update `code-landmarks.md` if new patterns introduced

---

## Quick Commands

Add to project scripts or aliases:

```bash
# Show worktree status
alias session-status="git status --short --branch"

# View recent decisions
alias decisions="tail -100 _project_specs/session/decisions.md"
```

---

## Enforcement Mechanisms

### 1. CLAUDE.md as Entry Point
CLAUDE.md must reference session-management.md in the Skills section. Claude reads CLAUDE.md first, which directs it to follow session rules.

### 2. Self-Check Questions
After completing any task, Claude should ask:
```
□ Did I make a decision? → Log it
□ Did I change a key entrypoint or uncover a durable gotcha? → Update landmarks
□ Is the rest already obvious from git / PR context? → No repo-local note needed
```

### 3. Session Start Verification
When starting a session, Claude must:
1. Check branch status / recent commits / open PR
2. Review `decisions.md` only if rationale matters
3. Review `code-landmarks.md` only if navigation matters

### 4. Periodic Self-Audit
Every ~20 tool calls, Claude should check:
- Are there unlogged decisions?
- Are there new landmarks or gotchas worth recording?

### 5. User Prompts
Users can enforce by asking:
- "Update project specs" → Triggers a decisions/landmarks review
- "What's the current state?" → Claude reports from git / PR context
- "End session" → Claude leaves next steps in the response if needed
- "Resume from last session" → Claude checks branch/PR state first

---

## Anti-Patterns

- **No state tracking** - Flying blind, can't resume
- **Over-documenting transient state** - Git and PR history already hold it
- **Missing decisions** - Future you won't remember why
- **No code landmarks** - Wastes time re-discovering the codebase
- **Ignoring compression signals** - Context overload degrades performance
- **Skipping checkpoint after decisions** - Key context lost
- **No clear PR/commit context** - The next session starts from guesswork

---

## Quick Reference

### Checkpoint Decision Tree
```
Task completed?
    │
    ├── Decision made? ──────────────────→ Log to decisions.md
    │
    ├── Navigation / gotcha changed? ────→ Update landmarks
    │
    └── Otherwise ───────────────────────→ Keep it in git / PR context
```

### Files at a Glance
| File | Update Frequency | Purpose |
|------|------------------|---------|
| decisions.md | When deciding | Architectural choices |
| code-landmarks.md | When patterns change | Code navigation |
