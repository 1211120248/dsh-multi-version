# Contributing

Thank you for helping improve DSH Multi-Version. Contributions should keep the
plugin independently buildable and preserve its security and runtime
invariants.

## Before you start

- Use Node.js 22.19 or newer and pnpm 11.
- Search existing issues before opening a new one.
- For a behavior change, describe the user problem and the expected DSH Web
  behavior before proposing a large implementation.
- Do not include credentials, captured prompts, `.multi-version` run data, or
  other private workspace content in issues, commits, or screenshots.

## Local setup

```sh
git clone <repository-url>
cd dsh-multi-version
pnpm install
pnpm check
```

To test the built package in a local Web profile:

```sh
dsh plugin --profile web add link:"$(pwd)"
```

Use a disposable DSH profile and workspace for runtime testing. Do not point a
development build at a workspace containing sensitive data.

## Pull requests

1. Keep each pull request focused on one change.
2. Add or update tests for observable behavior.
3. Keep `README.md` and `README.zh.md` structurally aligned, then run
   `pnpm docs:write-pair`.
4. Run `pnpm check` and `pnpm pack --pack-destination ./artifacts`.
5. Explain compatibility impact, security impact, and manual DSH verification
   in the pull request description.

The repository follows Conventional Commits where practical, for example
`feat: add candidate retry` or `fix: reject escaped snapshot symlink`.

## Architecture boundaries

- Do not import files from a DSH source checkout or `dsh-web-ui` repository.
- Use published `@deepseek-ai/*` packages as build-time contracts.
- Derive filesystem authority from the trusted active Host session, never from
  browser-supplied paths.
- Keep candidates in separate writable workspaces created from one base
  snapshot.
- Accept only a completed child turn as a successful candidate.
- Keep summaries deterministic and local; do not add a hidden judge, ranker,
  merger, or recommendation model.

See `AGENTS.md` for the complete implementation invariants.
