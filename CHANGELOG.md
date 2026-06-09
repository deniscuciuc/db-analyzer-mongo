# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- GitHub Actions release workflow
- Dependabot configuration for npm + GitHub Actions
- MIT license
- Makefile with common development targets
