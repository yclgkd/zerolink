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

## Tiered Summarization Rules

### Tier 1: Quick Update (current-state.md only)
**Trigger**: After completing any small task or todo item
**Action**: Update "Active Task", "Progress", and "Next Steps" sections
**Time**: ~30 seconds

### Tier 2: Full Checkpoint (current-state.md + decisions.md)
**Trigger**:
- After completing a feature or significant change
- After any architectural/library decision
- After ~20 tool calls during active work
- When switching to a different area of the codebase

**Action**:
1. Update full current-state.md
2. Log any decisions to decisions.md
3. Update files being modified table

### Tier 3: Session Handoff (full checkpoint + cleanup)
**Trigger**:
- End of work session
- Completing a major feature/milestone
- Before a significant context shift
- When context feels heavy (~50+ tool calls)

**Action**:
1. Full checkpoint in `current-state.md`
2. Log durable decisions in `decisions.md`
3. Update `code-landmarks.md` if new patterns or entrypoints matter
4. Trim stale detail and leave explicit resume steps in `current-state.md`

### Decision Heuristic
```
┌─────────────────────────────────────────────────────┐
│ After completing work, ask:                         │
├─────────────────────────────────────────────────────┤
│ Was a decision made?        → Log to decisions.md   │
│ Task took >10 tool calls?   → Full Checkpoint       │
│ Major feature complete?     → Full Checkpoint + Landmarks │
│ Ending session?             → Handoff + Next Steps  │
│ Otherwise                   → Quick Update          │
└─────────────────────────────────────────────────────┘
```

---

## Session State Structure

Create `_project_specs/session/` directory:

```
_project_specs/
└── session/
    ├── current-state.md      # Live session state (update frequently)
    ├── decisions.md          # Key decisions log (append-only)
    └── code-landmarks.md     # Important code locations
```

---

## Current State File

**`_project_specs/session/current-state.md`** - Update every 15-20 minutes or after significant progress.

```markdown
# Current Session State

*Last updated: 2025-01-15 14:32*

## Active Task
[One sentence: what are we working on right now]

Example: Implementing user authentication flow with JWT tokens

## Current Status
- **Phase**: [exploring | planning | implementing | testing | debugging | refactoring]
- **Progress**: [X of Y steps complete, or percentage]
- **Blocking Issues**: [None, or describe blockers]

## Context Summary
[2-3 sentences summarizing the current state of work]

Example: Created auth middleware and login endpoint. JWT signing works.
Currently implementing token refresh logic. Need to add refresh token
rotation for security.

## Files Being Modified
| File | Status | Notes |
|------|--------|-------|
| src/auth/middleware.ts | Done | JWT verification |
| src/auth/refresh.ts | In Progress | Token rotation |
| src/auth/types.ts | Done | Token interfaces |

## Next Steps
1. [ ] Complete refresh token rotation in refresh.ts
2. [ ] Add token blacklist for logout
3. [ ] Write integration tests for auth flow

## Key Context to Preserve
- Using RS256 algorithm (not HS256) per security requirements
- Refresh tokens stored in HttpOnly cookies
- Access tokens: 15 min, Refresh tokens: 7 days

## Resume Instructions
To continue this work:
1. Read src/auth/refresh.ts - currently at line 45
2. The rotateRefreshToken() function needs error handling
3. Check decisions.md for why we chose RS256 over HS256
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

**IMPORTANT**: Follow session-management.md skill. Update session state at natural breakpoints.

### After Every Task Completion
Ask yourself:
1. Was a decision made? → Log to `decisions.md`
2. Did this take >10 tool calls? → Full checkpoint to `current-state.md`
3. Is a major feature complete? → Create archive entry
4. Otherwise → Quick update to `current-state.md`

### Checkpoint Triggers
**Quick Update** (current-state.md):
- After any todo completion
- After small changes

**Full Checkpoint** (current-state.md + decisions.md):
- After significant changes
- After ~20 tool calls
- After any decision
- When switching focus areas

**Session Handoff** (full checkpoint + cleanup):
- End of session
- Major feature complete
- Context feels heavy

### Session Start Protocol
When beginning work:
1. Read `_project_specs/session/current-state.md`
2. Review recent `decisions.md` entries if needed
3. Review `code-landmarks.md` if you need navigation back into an unfamiliar area
4. Continue from "Next Steps"

### Session End Protocol
Before ending or when context limit approaches:
1. Update `current-state.md` with a concise handoff
2. Log any durable decisions in `decisions.md`
3. Update `code-landmarks.md` if new entrypoints or gotchas were introduced
4. Ensure next steps are specific and actionable
```

---

## Compression Strategies

### When to Compress (Tier 3 Handoff)

| Trigger | Action |
|---------|--------|
| ~50+ tool calls | Summarize progress and trim verbose notes |
| Major feature complete | Leave a concise handoff and update landmarks |
| Context shift | Summarize previous context and refresh next steps |
| End of session | Full session handoff in `current-state.md` |

### What to Keep vs Compress

**Keep in active context:**
- Current task and immediate next steps
- Active file list with status
- Blocking issues
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

**Stored In**: `current-state.md` (+ `decisions.md` / `code-landmarks.md` if needed)
```

---

## Session Handoff

After significant work or at session end, leave a concise handoff in `current-state.md` instead of creating a separate archive file:

```markdown
## Latest Update (2025-01-15)
- `src/auth/login.ts`, `src/auth/refresh.ts` — Added token rotation and logout blacklist handling.
- Validation: `npm test -- --grep "auth"`, `npm run typecheck`

## Next Steps
1. [ ] Add integration coverage for refresh-token expiry.
2. [ ] Update `decisions.md` if token storage policy changes.
```

---

## Integration with Task Tracking

### Link Tracked Tasks to Sessions

In your active task notes or issue tracker, reference session context:

```markdown
## [TODO-042] Implement token refresh

**Status:** in-progress
**Session Context:** See current-state.md

### Progress Notes
- 2025-01-15: Started implementation, base structure done
- 2025-01-15: Added rotation logic, need error handling
```

### Auto-Update on Task Completion

When completing a tracked task:
1. Update `current-state.md` progress and handoff notes
2. Log any durable decisions in `decisions.md`
3. Update `code-landmarks.md` if new patterns introduced

---

## Quick Commands

Add to project scripts or aliases:

```bash
# Show current session state
alias session-status="cat _project_specs/session/current-state.md"

# Quick edit session state
alias session-edit="$EDITOR _project_specs/session/current-state.md"

# View recent decisions
alias decisions="tail -100 _project_specs/session/decisions.md"
```

---

## Enforcement Mechanisms

### 1. CLAUDE.md as Entry Point
CLAUDE.md must reference session-management.md in the Skills section. Claude reads CLAUDE.md first, which directs it to follow session rules.

### 2. Session File Headers with Reminders
Include enforcement reminders in session file headers:

**current-state.md header:**
```markdown
<!--
CHECKPOINT RULES (from session-management.md):
- Quick update: After any todo completion
- Full checkpoint: After ~20 tool calls or decisions
- Session handoff: End of session or major feature complete
-->
```

### 3. Self-Check Questions
After completing any task, Claude should ask:
```
□ Did I make a decision? → Log it
□ Did this take >10 tool calls? → Full checkpoint
□ Is a feature complete? → Full checkpoint + landmarks
□ Am I ending/switching context? → Handoff + next steps
```

### 4. Session Start Verification
When starting a session, Claude must:
1. Check if `current-state.md` exists and read it
2. Announce what it found: "Resuming from: [last state]"
3. Confirm next steps before proceeding

### 5. Periodic Self-Audit
Every ~20 tool calls, Claude should check:
- Is current-state.md up to date?
- Are there unlogged decisions?
- Is context getting heavy?

### 6. User Prompts
Users can enforce by asking:
- "Update session state" → Triggers checkpoint
- "What's the current state?" → Claude reads and reports
- "End session" → Triggers full checkpoint + handoff
- "Resume from last session" → Claude reads state files first

---

## Anti-Patterns

- **No state tracking** - Flying blind, can't resume
- **Overly verbose state** - Keep it scannable, not a novel
- **Stale state files** - Update regularly or they become useless
- **Missing decisions** - Future you won't remember why
- **No code landmarks** - Wastes time re-discovering the codebase
- **Never handing off** - The next session starts without a reliable resume point
- **Ignoring compression signals** - Context overload degrades performance
- **Skipping checkpoint after decisions** - Key context lost
- **No handoff at session end** - Next session starts blind

---

## Quick Reference

### Checkpoint Decision Tree
```
Task completed?
    │
    ├── Decision made? ──────────────────→ Log to decisions.md
    │
    ├── >10 tool calls OR significant? ──→ Full Checkpoint
    │
    ├── Major feature done? ─────────────→ Full Checkpoint + Landmarks
    │
    └── Otherwise ───────────────────────→ Quick Update
```

### Files at a Glance
| File | Update Frequency | Purpose |
|------|------------------|---------|
| current-state.md | Every task | Live state, next steps |
| decisions.md | When deciding | Architectural choices |
| code-landmarks.md | When patterns change | Code navigation |
