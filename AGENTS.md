# AGENTS.md — dsh-multi-version

Standalone DSH Web GUI multi-version runner. This repository owns its source, build preset, tests, documentation, and release artifacts; it must not import files from `dsh-web-ui` or a DSH source checkout.

## Architecture

- `src/core/` contains protocol types and pure logic shared by Host and browser bundles.
- `src/` contains Host routing, snapshots, ledgers, scheduling, and DSH child-Agent adapters.
- `src/client/` contains official slot controls, atomic composer admission, transcript business nodes, and result viewing.
- Host derives every filesystem path from the trusted active session workspace. Browser requests and run views never contain arbitrary output paths, commands, or shell text.
- Durable run history belongs in a non-command `conversation.chat.node` projected from the known command lifecycle; never mount it in an input or composer dock.
- A run creates one `base-snapshot`, then copies planner and candidate workspaces from that snapshot. Candidates never share a writable workspace.

## Runtime invariants

- Rich input capture uses DSH session input state, reference codecs, and draft-image serialization with prepare/commit/rollback semantics. Never read textarea or DOM state.
- Planner-off candidates receive the same captured submission without hidden version instructions. Planner-on runs require exactly the requested number of distinct briefs and never silently fall back.
- Candidate children have no history seed, use explicit isolated cwd values, inherit the parent route and preset composition, receive fixed delegated permissions, and are disposed after settlement.
- Only a completed child turn is successful. Partial output from aborted, interrupted, disposed, blocked, max-token, or error endings remains diagnostic and must not be marked completed.
- Final summaries are deterministic Host output. Do not start judge, reviewer, ranker, merger, recommendation, or summary models.

## Repository rules

- Use only published `@deepseek-ai/*` SDK packages from `node_modules`; TypeScript configuration must not reference a DSH checkout.
- Browser SDK imports remain type-only, except platform modules resolved by the DSH module loader.
- Keep English and Chinese README files structurally aligned whenever behavior changes.
- Do not use emoji in code, comments, documentation, UI text, or commit messages.

## Validation

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
pnpm pack --pack-destination ./artifacts
```
