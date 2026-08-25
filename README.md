# DSH Multi-Version

`@linxin666/dsh-client-ui-multi-version`

English | [中文](README.zh.md)

An independent, open-source DeepSeek Harness (DSH) Web plugin that turns one rich prompt into multiple isolated candidate runs. It provides optional planning, bounded parallelism, durable progress in the conversation, complete result viewing, and deterministic local summaries.

> This independent community plugin uses DSH's npm and Cordis bundle format and targets the DSH Web profile.

## Why Multi-Version

A single agent run gives you one implementation path. That is efficient when the direction is already clear, but less useful when you want to compare architectures, writing approaches, or solution strategies before choosing one.

DSH Multi-Version captures the submission once, creates clean workspace copies, and runs fresh child agents against those copies. The source workspace remains untouched, while every candidate keeps its own response and file changes for inspection.

## Product highlights

- Start 2 to 20 candidate versions from the normal DSH composer.
- Preserve text, structured references, and pending images through DSH's official rich-input services instead of scraping the page DOM.
- Optionally use one planner to produce an exact set of distinct candidate briefs before execution.
- Run up to 8 candidates concurrently, with each candidate in its own writable workspace created from one common base snapshot.
- Follow durable status inside the ordinary conversation transcript, cancel the whole run, and open the full response of every completed candidate.
- Recover finished history after a Host restart and generate local navigation files without a hidden judge, ranker, merger, or summary model.

## How a run works

1. The Client atomically captures the current DSH composer submission.
2. The Host derives the trusted source workspace from the active session and creates one base snapshot.
3. Planner mode, when enabled, creates exactly the requested number of distinct briefs in an isolated planner workspace.
4. Fresh child agents run with the parent model route and preset composition in separate candidate workspaces under bounded concurrency.
5. The Host stores status and responses, then writes deterministic `SUMMARY.md` and `index.json` navigation files.

## Output layout

Each run is stored below the active source workspace:

```text
<workspace>/.multi-version/<run-id>/
├── request.json
├── run.json
├── planner.json                # only with planner mode
├── SUMMARY.md
├── index.json
├── base-snapshot/
├── planner/                    # only with planner mode
│   └── workspace/
└── versions/
    ├── version-01/
    │   ├── response.md
    │   ├── response.json
    │   ├── status.json
    │   └── workspace/
    └── version-02/
```

## Requirements

| Component | Requirement |
| --- | --- |
| DSH | `0.1.1-rc.2` tested and supported |
| Profile | Web |
| Node.js | `^22.19.0` or `>=24.0.0` |
| Package manager | pnpm 11 |

The plugin feature-detects the required composer services. On an incompatible runtime, the Versions control remains unavailable instead of silently downgrading rich input.

## Install

Build this independent project, then add it to the DSH Web profile as a linked bundle plugin:

```sh
pnpm install
pnpm build
dsh plugin --profile web add link:/absolute/path/to/dsh-multi-version
```

The package declares its DSH Client injections in `package.json` and inserts the `ui-multi-version` bundle row through `cordis.patch.yml`. No changes to a DSH source checkout are required.

## Use

1. Open a DSH Web session with an active workspace and prepare a prompt.
2. Select **Versions** in the composer toolbar.
3. Choose the version count, planner mode, and concurrency.
4. Start the run and follow its status in the conversation transcript; open any completed version to inspect the full response.

## Options

| Option | Range | Default | Behavior |
| --- | --- | --- | --- |
| Version count | 2-20 | 3 | Number of isolated candidate runs |
| Use planner | On or off | On | Generates distinct briefs before candidates start |
| Concurrency | 1-8, not above version count | 3 | Maximum candidates running at once |

`.multiversionignore` accepts workspace-root-relative path prefixes, one per line, with `#` comments. Snapshots always exclude `.git`, `.multi-version`, `node_modules`, `.pnpm-store`, `.cache`, `.next`, `dist`, `build`, and `coverage` directories.

## Compatibility and failure behavior

- Planner-off candidates receive the same captured submission without hidden version instructions.
- Planner mode fails if the planner returns malformed, repeated, or incorrectly counted briefs; it never falls back silently.
- Only a child turn ending as `completed` is successful. Partial output from an interrupted, aborted, blocked, disposed, max-token, or failed turn remains diagnostic.
- Active work becomes terminally interrupted after Host restart; pending and running candidates become failed, while navigation files are regenerated.
- Every child handle is disposed after settlement.

## Security model

The Host API lives under `/api/dsh-multi-version/v1` and accepts loopback, same-origin requests only. The browser neither supplies nor receives workspace paths, output paths, commands, or shell text; the Host resolves session and filesystem authority.

Workspace copying fails closed for absolute symlinks, escaping symlinks, unsupported entries, invalid run paths, and snapshot errors. Candidate copies do not use hard links. Writes use temporary files, fsync, and atomic rename; malformed ledgers are quarantined during recovery.

Captured submissions can contain sensitive text and encoded images. Protect `.multi-version` like the source workspace. Candidate children use fixed delegated permissions and approval policy `never`, and cannot widen those permissions from inside the run.

## Known limitations

- The compatibility adapter targets concrete DSH `0.1.1-rc.2` composer methods.
- Full responses are rendered as safe plain text rather than interpreted HTML or formatted Markdown.
- Live subagent-origin children may still be discoverable through low-level session listing because DSH has no separate durable `internal` visibility.
- Workspace snapshots are file copies, not filesystem-atomic snapshots; source files must remain stable while the base snapshot is prepared.
- Retry attempts are not implemented.
- Adopting a selected candidate back into the source workspace is not implemented.

## Development

Run the complete local gate from the repository root:

```sh
pnpm check
pnpm pack --pack-destination ./artifacts
```

## Open source and community

The repository includes the files needed for a maintainable open-source project:

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution and the independent community-plugin statement.
