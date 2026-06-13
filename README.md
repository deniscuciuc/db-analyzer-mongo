# MongoDB Analyzer

[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/@deniscuciuc/mongo-analyzer?logo=npm&color=cb3837)](https://www.npmjs.com/package/@deniscuciuc/mongo-analyzer)
[![npm downloads](https://img.shields.io/npm/dm/@deniscuciuc/mongo-analyzer)](https://www.npmjs.com/package/@deniscuciuc/mongo-analyzer)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![CI](https://github.com/deniscuciuc/db-analyzer-mongo/actions/workflows/ci.yml/badge.svg)](https://github.com/deniscuciuc/db-analyzer-mongo/actions/workflows/ci.yml)

A CLI tool that analyzes MongoDB databases for performance issues: index usage, slow queries, schema problems, fragmentation, replica-set health, and operational metrics. Outputs structured JSON for automation or rich Markdown reports for humans.

## Quick start

No installation required:

```bash
npx @deniscuciuc/mongo-analyzer --uri "mongodb://localhost:27017" -d mydb -c health
npx @deniscuciuc/mongo-analyzer --uri "mongodb://localhost:27017" -d mydb -c full --json > report.json
```

Or install globally:

```bash
npm install -g @deniscuciuc/mongo-analyzer
mongo-analyzer --uri "mongodb://localhost:27017" -d mydb -c health
```

> **Working with an AI agent?** See [.github/copilot-instructions.md](.github/copilot-instructions.md) for the integrated GitHub Copilot agent workflow and JSON contracts.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Development / local setup](#development--local-setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Commands](#commands)
- [CLI options](#cli-options)
- [Output formats](#output-formats)
- [Health score](#health-score)
- [Programmatic usage](#programmatic-usage)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Contributing](#contributing)

---

## Features

### Index analysis

- Detect unused indexes (with reasons to keep: unique, TTL, sparse).
- Find missing indexes from slow-query patterns.
- Detect duplicate / overlapping / prefix indexes.
- Covering-index opportunities and index efficiency.

### Query analysis

- Slow queries via the MongoDB profiler (find/update/delete/insert/aggregate/findAndModify/bulkWrite).
- Query anti-patterns: `$where`, unanchored `$regex`, negation operators, COLLSCAN.
- Current operations, long-running operations, blocking operations.
- Severity classification: critical / high / medium / low.

### Schema analysis

- Document structure and field-type variance.
- Mixed types in the same field, sparse fields, oversize arrays / strings.
- Cross-collection schema comparison.

### Collection & storage

- Collection stats (size, document count, index count).
- Fragmentation detection with severity.
- Compaction execution.
- Index-to-data ratio.

### System metrics

- Database / storage / index size.
- Cache hit ratio with diagnostics.
- Connection statistics by client.
- Replica-set status with **replication lag**.
- Sharding / balancer status.
- WiredTiger cache (eviction, checkpoint, dirty pages).
- Oplog ops/sec.

### Operations & health

- Operations per second (queries / inserts / updates / deletes).
- Read/write ratio, lock queues, active clients.
- TTL index efficiency, document-size distribution.
- Composite **health score (0–100)** with prioritized recommendations.

---

## Requirements

- Node.js >= 20.12.0
- pnpm >= 10
- MongoDB 4.4+

## Development / local setup

```bash
pnpm install
cp .env.example .env
# edit .env with your connection details
```

## Configuration

### Environment variables (`.env`)

```bash
# Recommended: full connection string (mongodb:// or mongodb+srv://)
# Database name is taken from the path component.
MONGODB_CONNECTION_STRING='mongodb+srv://user:password@cluster.mongodb.net/mydb?replicaSet=rs0&tls=true&authSource=admin'

# Alternative: legacy URI
# MONGO_URI=mongodb://localhost:27017
# MONGO_DB=mydb

# Or individual fields (used when no connection string is set)
# MONGO_HOST=localhost
# MONGO_PORT=27017
# MONGO_USER=
# MONGO_PASSWORD=
# MONGO_AUTH_DB=admin
# MONGO_DB=mydb
```

### Config file (`.analyzerrc.json`)

Place `.analyzerrc.json` in your project root (or `~/.config/db-analyzer/config.json` for global settings).
Copy `analyzerrc.example.json` to get started:

```bash
cp analyzerrc.example.json .analyzerrc.json
```

Connection profiles let you switch databases without re-typing flags:

```bash
# use a named profile
node --env-file=.env -r ts-node/register index.ts -c health --profile atlas

# or with npm script
pnpm analyze:health -- --profile staging
```

CLI flags always win. When you explicitly select a profile with `--profile`, that
profile's connection fields override sourced environment defaults for that run.

### Threshold tuning

All analysis thresholds live in [`src/config/thresholds.ts`](src/config/thresholds.ts):

```ts
THRESHOLDS = {
  fragmentation: { minor: 20, moderate: 30, high: 40, critical: 50 },
  cache:         { excellent: 98, optimal: 95, acceptable: 90, poor: 80 },
  indexes:       { minAccessesForUsed: 50, highIndexRatio: 50 },
  queries:       { slowMs: 100, verySlowMs: 1000, criticalMs: 5000 },
  // ...
}
```

---

## Usage

### Interactive mode

```bash
pnpm start
# or
pnpm analyze -- -i
```

### npm scripts

```bash
# Analysis (JSON output unless noted)
pnpm analyze              # Full analysis + Markdown report
pnpm analyze:help         # Help
pnpm analyze:health       # Health score + key metrics
pnpm analyze:indexes      # Unused indexes
pnpm analyze:queries      # Slow queries
pnpm analyze:html         # Full analysis + Markdown + HTML reports
pnpm analyze:watch        # Live health dashboard (refreshes every 30s)

# Maintenance
pnpm compact:check        # Collections with high fragmentation
pnpm compact              # Run compact on fragmented collections

# Profiler
pnpm profiler:enable
pnpm profiler:disable

# Development
pnpm build                # Compile TypeScript
pnpm lint                 # Biome check
pnpm lint:fix             # Biome auto-fix
```

### Direct CLI

```bash
# Any command via -c
npx ts-node index.ts -j -c <command>

# Examples
npx ts-node index.ts -j -c health
npx ts-node index.ts -j -c slow-queries
npx ts-node index.ts --uri "mongodb+srv://..." -c full
```

---

## Commands

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `health`             | Health score and metrics                       |
| `unused-indexes`     | Index usage statistics                         |
| `missing-indexes`    | Query patterns that need indexes               |
| `duplicate-indexes`  | Overlapping / prefix indexes                   |
| `slow-queries`       | Slow queries from the profiler                 |
| `query-stats`        | Aggregated query statistics                    |
| `query-antipatterns` | Detect inefficient query patterns              |
| `current-ops`        | Currently running operations                   |
| `long-running`       | Operations running > 1 minute                  |
| `blocking`           | Operations waiting on locks                    |
| `collections`        | Collection statistics                          |
| `largest-collections`| Top collections by size                        |
| `compact-needed`     | Collections with > 30% fragmentation           |
| `run-compact`        | Run compact on selected collections            |
| `auto-compact`       | Automatically compact fragmented collections   |
| `schema`             | Schema overview                                |
| `schema-issues`      | Schema problems                                |
| `connections`        | Connection statistics                          |
| `config`             | Server configuration settings                  |
| `server-info`        | MongoDB server information                     |
| `replica-set`        | Replica set status                             |
| `sharding`           | Sharding status                                |
| `wiredtiger`         | WiredTiger cache statistics                    |
| `oplog`              | Oplog statistics                               |
| `enable-profiler`    | Enable profiler (level 1, slow ops)            |
| `disable-profiler`   | Disable profiler                               |
| `profiler-status`    | Current profiler status                        |

## CLI options

| Option                          | Short | Description                                  | Default     |
| ------------------------------- | ----- | -------------------------------------------- | ----------- |
| `--uri <uri>`                   |       | MongoDB URI (overrides individual params)    | -           |
| `--host <host>`                 | `-h`  | Host                                         | `localhost` |
| `--port <port>`                 | `-p`  | Port                                         | `27017`     |
| `--database <name>`             | `-d`  | Database name                                | -           |
| `--user <user>`                 | `-U`  | User                                         | -           |
| `--password <pass>`             | `-W`  | Password                                     | -           |
| `--authSource <db>`             |       | Auth database                                | `admin`     |
| `--profile`                     |       | Use a named connection profile from `.analyzerrc.json` | - |
| `--config`                      |       | Path to a config file                        | auto-search |
| `--collections`                 |       | Comma-separated collection names to analyze  | all         |
| `--compare`                     |       | Path to a previous JSON report for diffing   | -           |
| `--html`                        |       | Also generate an HTML report                 | `false`     |
| `--watch`                       |       | Poll interval in seconds (enables watch mode) | -          |
| `--slow-query-threshold <ms>`   |       | Slow-query threshold                         | `100`       |
| `--min-index-accesses <n>`      |       | Min accesses to consider an index "used"     | `50`        |
| `--output <dir>`                | `-o`  | Reports directory                            | `./reports` |
| `--command <cmd>`               | `-c`  | Run a single command (see table)             | `full`      |
| `--json`                        | `-j`  | JSON output                                  | `false`     |
| `--quiet`                       | `-q`  | Suppress progress output                     | `false`     |
| `--interactive`                 | `-i`  | Interactive menu                             | `false`     |

---

## Output formats

### Markdown report

Generated by `pnpm analyze`. Includes:

- Executive summary with health score
- Database / operation / lock metrics
- Index analysis (unused / missing / duplicate / TTL)
- Collection analysis + document size distribution
- Slow queries (with severity) and anti-patterns
- Schema issues
- Fragmentation
- WiredTiger / replica-set / connection sections
- Prioritized recommendations

Saved to `./reports/mongodb-analysis-{timestamp}.md`.

### JSON report

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "databaseName": "mydb",
  "healthScore": 85,
  "metrics": { "...": "..." },
  "unusedIndexes": [],
  "missingIndexes": [],
  "duplicateIndexes": [],
  "collectionStats": [],
  "slowQueries": [],
  "fragmentedCollections": [],
  "queryAntiPatterns": [],
  "schemaIssues": [],
  "recommendations": [],
  "errors": []
}
```

### HTML report

Generated by `pnpm analyze:html` or `pnpm analyze -- --html`. Includes the same content
as the Markdown report in a self-contained HTML file with:

- Light/dark mode (follows OS preference)
- Color-coded severity badges
- Collapsible sections
- Sortable tables
- No external dependencies — share as a single file

Saved to `./reports/mongodb-analysis-{timestamp}.html`.

### Report diff

Compare two snapshots to see what changed:

```bash
# save a baseline
pnpm analyze

# later, compare
pnpm analyze -- --compare ./reports/mongodb-analysis-2026-01-01.json
```

Output:
```
⬆️  Health score            72 → 85 (+13)  ✓ better
⬇️  Cache hit ratio         95% → 91% (-4%)  ✗ worse
↔️  Fragmented collections  2 → 2  no change
⚠️  New issues (1): old_email_idx (unused index)
✓  Resolved (1): logs_archive (fragmented collection)
```

---

## Health score

| Score   | Status    | Action                  |
| ------- | --------- | ----------------------- |
| 90–100  | Excellent | Monitor only            |
| 70–89   | Good      | Plan optimization       |
| 50–69   | Warning   | Needs attention         |
| 0–49    | Critical  | Immediate action needed |

---

## Programmatic usage

```ts
import { MongoDBAnalyzer } from "@deniscuciuc/mongo-analyzer";

const analyzer = await MongoDBAnalyzer.connect({
  uri: process.env.MONGODB_CONNECTION_STRING!,
  database: "mydb",
});

const report = await analyzer.analyze();
analyzer.printSummary(report);
await analyzer.generateReport(report);
await analyzer.close();
```

---

## Troubleshooting

| Symptom                                  | Cause                          | Fix                                                  |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| `MongoNetworkError`                      | Cannot reach MongoDB           | Check connection string, network, firewall          |
| `Authentication failed` (code 18)        | Bad credentials / `authSource` | Verify user, password, and `authSource` in URI      |
| `not authorized` (code 13)               | Insufficient privileges        | Grant `dbAdmin` or `clusterMonitor`                 |
| Empty slow queries                       | Profiler disabled              | `pnpm profiler:enable` and wait for traffic         |
| Some metrics missing on sharded clusters | Limited support                | Run against a config server or each shard separately|

---

## Architecture

```
db-analyzer-mongo/
├── index.ts                         # Entry point + CLI
├── package.json
├── src/
│   ├── types.ts                     # Shared types
│   ├── interactive.ts               # Interactive CLI
│   ├── config/thresholds.ts         # Tunable thresholds
│   ├── utils/{formatting,health,errors}.ts
│   ├── analyzers/
│   │   ├── collection-analyzer.ts
│   │   ├── index-analyzer.ts
│   │   ├── query-analyzer.ts
│   │   └── schema-analyzer.ts
│   ├── collectors/stats-collector.ts
│   └── reporters/report-generator.ts
├── .github/copilot-instructions.md  # AI agent workflow
├── .env.example
└── reports/                         # Generated reports (gitignored)
```

| Class                | Responsibility                                       |
| -------------------- | ---------------------------------------------------- |
| `CollectionAnalyzer` | Stats, fragmentation, compaction                     |
| `IndexAnalyzer`      | Unused / missing / duplicate indexes                 |
| `QueryAnalyzer`      | Slow queries, anti-patterns, ops                     |
| `SchemaAnalyzer`     | Document structure and field types                   |
| `StatsCollector`     | Metrics, replica set, sharding, WiredTiger, oplog    |
| `ReportGenerator`    | Markdown + JSON report output                        |

## Contributing

Bug reports, feature requests, and pull requests are welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

MIT — see [LICENSE](LICENSE).
