# Coding Standards

## Scope
- Make the smallest correct change.
- Do not refactor unrelated code.
- Keep PRs scoped to one logical change.

## TypeScript
- Preserve strict typing.
- Reuse shared types and schemas before creating new ones.
- Prefer explicit names over short or ambiguous identifiers.

## Security
- Never log secrets, private keys, lock secrets, or decrypted payloads.
- Never add plaintext persistence beyond the required local encryption step.
- Keep browser-side crypto browser-side.

## Shared Contracts
- Add or update protocol schemas in `packages/shared/src/schemas.ts`.
- Keep package boundaries intact: frontend and backend import shared contracts instead of redefining them.

## Comments and Wording
- Add comments only when they explain non-obvious behavior.
- Do not add tool authorship or AI-generation notes to source code or comments.

## File Size

- **Target:** 200–400 lines per file.
- **Hard limit:** 800 lines. Files exceeding this must be split before merging.
- **Test files:** Follow the same limit. Split by describe block / feature domain.
- **Splitting pattern:** Extract shared test helpers to `__tests__/helpers/` before splitting test files. Note that `vi.mock()` calls cannot be moved to helper files (Vitest hoisting requirement).
- **Enforcement:** Any PR adding code that pushes a file over 800 lines should be flagged in code review.

## Project State
- Update `_project_specs/` whenever AI-authored work changes repo behavior, workflow, or status.
