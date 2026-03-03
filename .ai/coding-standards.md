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

## Project State
- Update `_project_specs/` whenever AI-authored work changes repo behavior, workflow, or status.
