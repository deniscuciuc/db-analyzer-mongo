# GitHub Copilot Instructions — MongoDB Analyzer

You are operating inside the **MongoDB Analyzer** repository. This file is your authoritative guide: follow it before searching the codebase.

## What this tool does

A CLI that analyzes MongoDB databases and emits **JSON to stdout** (with `-j`) or **Markdown reports** to `./reports/`. Use it to find unused indexes, slow queries, fragmentation, schema issues, and overall health.

## Prerequisites checklist

Before running any command, verify:

1. `.env` exists at the repo root. If missing: copy `.env.example` and ask the user for connection details — never invent credentials.
2. `node_modules/` exists. If missing, run `pnpm install`.
3. `MONGODB_CONNECTION_STRING` (or legacy `MONGO_*` vars) is set in `.env`.

## Standard workflow

Always start with the health check, then drill down only if the score is below 90.

```bash
# 1. Health check (always first)
pnpm analyze:health

# 2. If healthScore < 90, drill into specifics in parallel
pnpm analyze:indexes      # unused indexes
pnpm analyze:queries      # slow queries
pnpm compact:check        # fragmented collections

# 3. For deeper investigation, use direct CLI
npx ts-node index.ts -j -c <command>
```

## All commands

| Command              | When to use                                          |
| -------------------- | ---------------------------------------------------- |
| `health`             | First check, overall score                           |
| `unused-indexes`     | Find indexes to drop                                 |
| `missing-indexes`    | Patterns from profiler that need indexes             |
| `duplicate-indexes`  | Redundant / overlapping indexes                      |
| `slow-queries`       | Queries to optimize (requires profiler)              |
| `query-stats`        | Aggregated query metrics                             |
| `query-antipatterns` | `$where`, unanchored `$regex`, COLLSCAN, etc.        |
| `current-ops`        | What is running right now                            |
| `long-running`       | Operations > 1 minute                                |
| `blocking`           | Operations waiting on locks                          |
| `collections`        | Collection-level statistics                          |
| `largest-collections`| Top collections by size                              |
| `compact-needed`     | Fragmentation > 30%                                  |
| `run-compact`        | Execute compact (requires confirmation)              |
| `auto-compact`       | Compact all fragmented collections                   |
| `schema`             | Schema overview                                      |
| `schema-issues`      | Mixed types, sparse fields, oversize values         |
| `connections`        | Connection statistics                                |
| `config`             | Server configuration                                 |
| `server-info`        | MongoDB version and server info                      |
| `replica-set`        | Replica-set status, replication lag                  |
| `sharding`           | Sharding / balancer status                           |
| `wiredtiger`         | WiredTiger cache statistics                          |
| `oplog`              | Oplog ops/sec                                        |
| `enable-profiler`    | Enable profiler (level 1, slow ops)                  |
| `disable-profiler`   | Disable profiler                                     |
| `profiler-status`    | Current profiler status                              |

## JSON output contracts

All JSON is emitted to **stdout** with the `-j` flag. Pipe to `jq` for filtering.

### `health`

```json
{
  "healthScore": 85,
  "totalSize": 1073741824,
  "documentCount": 1000000,
  "indexCount": 25,
  "cacheHitRatio": 0.95,
  "connectionsCurrent": 50,
  "connectionsAvailable": 51150,
  "issues": ["High number of slow queries detected"],
  "recommendations": ["Consider adding indexes for frequently queried fields"]
}
```

### `unused-indexes`

```json
{
  "indexUsageSummary": {
    "totalIndexes": 25,
    "unusedIndexes": 5,
    "totalUnusedSizeMB": 125.5,
    "indexes": [
      {
        "collection": "users",
        "indexName": "old_email_idx",
        "accessCount": 0,
        "sizeMB": 125.5,
        "recommendation": "Consider removing - 0 accesses since server start"
      }
    ]
  }
}
```

Action rules:
- `accessCount = 0` → safe to drop (after confirming with user).
- `accessCount < 50` → review necessity.
- Large `sizeMB` → priority for removal.

### `slow-queries`

```json
{
  "slowQueries": [
    {
      "collection": "orders",
      "operation": "find",
      "query": { "status": "pending" },
      "executionTimeMs": 2500,
      "docsExamined": 1500000,
      "docsReturned": 150,
      "planSummary": "COLLSCAN",
      "recommendation": "Create compound index on {status: 1, createdAt: -1}"
    }
  ],
  "totalSlowQueries": 45,
  "avgExecutionTime": 850
}
```

Red flags:
- `planSummary = "COLLSCAN"` → missing index.
- `docsExamined >> docsReturned` → inefficient query / index.
- `executionTimeMs > 1000` → critical.

### `compact-needed`

```json
{
  "fragmentedCollections": [
    {
      "collection": "logs",
      "dataSize": 5368709120,
      "storageSize": 8053063680,
      "fragmentationPercent": 33.3,
      "recommendation": "Run compact to reclaim ~2.5 GB"
    }
  ]
}
```

Fragmentation thresholds: `< 20%` normal, `20–30%` monitor, `> 30%` recommend compact.

## Score interpretation

| Score   | Status    | Action                  |
| ------- | --------- | ----------------------- |
| 90–100  | Excellent | Monitor only            |
| 70–89   | Good      | Plan optimization       |
| 50–69   | Warning   | Needs attention         |
| 0–49    | Critical  | Immediate action needed |

| Cache Hit Ratio | Quality                        |
| --------------- | ------------------------------ |
| > 0.95          | Excellent                      |
| 0.90 – 0.95     | Good                           |
| 0.80 – 0.90     | Needs attention                |
| < 0.80          | Increase RAM or fix hot queries|

| Replication lag | Status   |
| --------------- | -------- |
| < 1 s           | Normal   |
| 1 – 10 s        | Watch    |
| > 10 s          | Critical |

## Reporting back to the user

When summarizing, follow this structure:

````markdown
## MongoDB Analysis Results

### Health Score: X/100

### Key Metrics

| Metric            | Value |
| ----------------- | ----- |
| Database Size     | …     |
| Cache Hit Ratio   | …     |
| Read/Write Ratio  | …     |
| Operations/sec    | …     |

### Findings

1. …
2. …

### Replica-Set (if present)

| Node | State | Lag |
| ---- | ----- | --- |
| …    | …     | …   |

### Recommendations

- **Critical:** …
- **Important:** …
- **Consider:** …

### Suggested commands

```javascript
db.collection.dropIndex("index_name")
db.collection.createIndex({ field1: 1, field2: -1 }, { background: true })
db.runCommand({ compact: "collection_name" })
```
````

## Operational rules for the agent

- **Always reply in English.** Do not use Russian or Ukrainian.
- **Never run destructive commands without explicit user confirmation:** `run-compact`, `auto-compact`, `dropIndex`, `enable-profiler`/`disable-profiler` (alters server state).
- **Use `-j` for parsing.** Markdown output is for humans only.
- **Profiler must be enabled** for slow-query analysis. If empty, advise enabling and waiting for traffic.
- **Use `clusterMonitor` or `dbAdmin` role** if commands fail with code 13 (`not authorized`).
- **Do not invent credentials or hostnames.** Ask the user.
- **Do not commit `.env`** or any file containing secrets.

## Error reference

| Error                                         | Likely cause                  | Suggested fix                                |
| --------------------------------------------- | ----------------------------- | -------------------------------------------- |
| `MongoNetworkError`                           | Cannot reach MongoDB          | Verify connection string and network         |
| `Authentication failed` (code 18)             | Bad credentials / authSource  | Check user, password, `authSource` in URI    |
| `not authorized` (code 13)                    | Insufficient privileges       | Grant `dbAdmin` or `clusterMonitor`          |
| Empty slow queries                            | Profiler off                  | `pnpm profiler:enable`                       |

## File layout (for navigation)

```
index.ts                                  # CLI entry, bootstrap only
src/cli/{options,runner}.ts               # CLI parsing and command execution
src/config/{loader,thresholds}.ts         # Config loading and tunable thresholds
src/constants.ts                          # Commands, defaults, watch rules
src/interactive/{index,display,menus}.ts  # Interactive UI
src/analyzers/{collection,index,query,schema}-analyzer.ts
src/collectors/stats-collector.ts         # Database metrics
src/reporters/report-generator.ts         # Markdown + JSON output
src/utils/{format,formatting,health,errors,print}.ts
src/watch/runner.ts                       # Watch mode loop
```
