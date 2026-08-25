# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Replaced full-response result dialogs with per-version status, duration, and
  concise summaries plus a workspace-relative generated-file location.
- Removed the separate run-created notice; the transcript run node is the
  single progress surface.
- Marked transient candidate and planner children with DSH's one-shot
  subagent descriptor so session surfaces classify them correctly.

### Fixed

- Starting a run in a blank session now synchronizes its prompt preview to the
  parent session title without overwriting an existing title.

### Added

- Independent open-source project metadata and community documentation.
- Continuous integration for typechecking, tests, builds, documentation, and
  package-content verification.

## [0.1.0] - 2026-08-25

### Added

- DSH Web composer control for multi-version runs.
- Optional planner mode with strict distinct-brief validation.
- Isolated base snapshots and per-candidate workspaces.
- Bounded candidate concurrency and cancellable execution.
- Durable transcript run nodes and restart recovery.
- Deterministic local `SUMMARY.md` and `index.json` generation.
- English and Chinese product documentation.
