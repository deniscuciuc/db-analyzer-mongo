# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-10

### Added

- A programmatic API. `MongoAnalyzer` is exported from the package root, alongside the
  analyzers, collectors, reporters and every report type. Importing the package now has
  no side effects — previously `require("@deniscuciuc/mongo-analyzer")` connected to the
  database and ran an analysis, because the CLI was the package entry point and
  `main`/`types` pointed at it. The CLI moved to `src/cli/main.ts` and is still reached
  through the `mongo-analyzer` binary.
- A test suite. `pnpm test` runs it, and CI runs it on Node 20, 22 and 24.
- `SECURITY.md` and `CODE_OF_CONDUCT.md`.

### Fixed

- `--watch -1` was mistaken for a flag and silently replaced by the default interval
  instead of being rejected.
- Numeric flags were parsed with no validation, so `--port abc` produced `NaN` and
  surfaced as a confusing driver error far from the actual mistake. Each flag now reports
  its own name.
- A flag at the end of the argument list stored `undefined` rather than failing.
- An unknown flag was silently ignored, so a typo like `--jsno` produced human-readable
  output instead of JSON.
- The connection is no longer torn down by an unhandled `error` event: with no listener
  attached, an idle-connection failure terminated the process, which was near-certain in
  `--watch` mode.
- Ctrl+C during a query did nothing, and a second Ctrl+C did nothing either, so the CLI
  appeared to hang. A second signal now exits, and `SIGTERM` is handled so `docker stop`
  reaches the connection cleanup.
- `process.exitCode` is set instead of calling `process.exit`, which could truncate
  buffered output when piping `--json` to a file.

### Changed

- The npm tarball no longer contains the compiled tests.
- Stricter TypeScript (`noUncheckedIndexedAccess` and friends) and Biome rules; unused
  variables and imports are errors rather than warnings.
- CI runs on every branch, not just `main` and `develop`, and cancels superseded runs.
- Publishing now emits npm provenance and verifies the tag matches `package.json`.

## [1.0.0] - 2026-06-13

### Added

- MongoDB database analyzer CLI with subcommands
- Unused / missing / duplicate index detection
- Slow query analysis via MongoDB profiler
- Query anti-pattern detection
- Schema analysis (mixed types, sparse fields, oversize values)
- Collection statistics and fragmentation detection
- Compaction execution
- WiredTiger cache and replica-set monitoring
- Sharding status and balancer information
- Database health score (0–100) with prioritized recommendations
- Interactive CLI mode with prompts
- Markdown report generation to `./reports/`
- JSON output for automation workflows (`-j` flag)
- GitHub Actions CI workflow (lint, build matrix)
- GitHub Actions publish workflow
- Dependabot configuration for npm + GitHub Actions
- MIT license
- Makefile with common development targets
- Config-file support via `.analyzerrc.json`, global fallback config, and named connection profiles
- Collection filters for scoped MongoDB analysis runs
- Self-contained HTML report generation with light/dark mode and sortable sections
- Report diffing against previous JSON snapshots with delta summaries
- Watch mode for polling-safe commands with refresh intervals and countdown feedback
- `pnpm analyze:html` and `pnpm analyze:watch` convenience scripts
- Global CLI publishing via `npm install -g @deniscuciuc/mongo-analyzer` and `npx @deniscuciuc/mongo-analyzer`

### Changed

- Full analysis output can now generate Markdown, JSON, and optional HTML reports from the same run
- CLI compare mode accepts saved JSON reports and wrapped CLI JSON output when diffing snapshots
- `slow-queries`, `collections`, and filtered TTL reporting now align with the selected analysis scope

### Fixed

- Explicit `--profile` selection now overrides sourced environment connection defaults for the active run
