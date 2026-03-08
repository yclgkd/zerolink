# Completed

Done items for reference. Move here from active.md when complete.

---

## DONE-001: Monorepo initialization

**Completed**: 2026-02-24

Set up pnpm monorepo with 3 packages (`@zerolink/shared`, `@zerolink/frontend`, `@zerolink/backend`).
Configured Biome, Husky + lint-staged, commitlint (Conventional Commits), Changesets.
Installed 226 packages. Git hooks activated. Changesets initialized.

## DONE-002: Claude project structure

**Completed**: 2026-02-24

Created CLAUDE.md, `.claude/skills/` with 7 skills (base, security, typescript, react-web,
playwright-testing, session-management, code-review), and `_project_specs/` directory tree.

## DONE-003: Multi-agent instruction structure

**Completed**: 2026-03-03

Replaced the long root `CLAUDE.md` with short agent routers, added `AGENTS.md`, `GEMINI.md`,
and a shared `.ai/` guidance layer, copied `.claude/skills/` to `.agents/skills/` as a
compatibility directory, migrated branch naming to `<type>/<short-name>`, and codified the
branch-plus-PR workflow plus neutral wording policy for AI-authored changes.

## DONE-004: Physical delete semantics for channel destroy/expiry

**Completed**: 2026-03-08

Changed sender destroy and TTL expiry from logical terminal-state persistence to real physical
purge of Durable Object channel state, including the main `ChannelRecord`, creation/compound/lock
challenges, nonce records, nonce indexes, and scheduled alarms. Public status and decrypt-fetch
now return `404 NOT_FOUND` after purge, frontend manage/share flows render an unavailable state on
revisit, and sender-side `deleted` remains a current-session-only confirmation UI state.
