/**
 * Library entry point for `@deniscuciuc/mongo-analyzer`.
 *
 * Importing this module has no side effects. The CLI lives in `src/cli/main.ts` and is
 * reached through the `mongo-analyzer` binary — importing the package used to run an
 * analysis as a side effect of `require()`, because the CLI was the package entry point.
 */

export { CollectionAnalyzer } from "./analyzers/collection-analyzer";
export { IndexAnalyzer } from "./analyzers/index-analyzer";
export { QueryAnalyzer } from "./analyzers/query-analyzer";
export { SchemaAnalyzer } from "./analyzers/schema-analyzer";
export type { MongoAnalyzerOptions } from "./api";
export { MongoAnalyzer } from "./api";
export { StatsCollector } from "./collectors/stats-collector";
export type { MongoConnectionConfig } from "./connection";
export {
	buildConnectionUri,
	parseDatabaseFromConnectionString,
} from "./connection";
export type { Command } from "./constants";
export { COMMANDS, DEFAULTS, DESTRUCTIVE_COMMANDS } from "./constants";
export { DiffReporter } from "./reporters/diff-reporter";
export { HtmlReporter } from "./reporters/html-reporter";
export { ReportGenerator } from "./reporters/report-generator";
export type {
	AnalysisReport,
	AnalyzerOptions,
	CollectionStats,
	CompactResult,
	CompactSummary,
	CompactTarget,
	CurrentOperation,
	DatabaseConfig,
	DatabaseMetrics,
	DuplicateIndex,
	FragmentedCollection,
	FullReport,
	IndexInfo,
	IndexUsageSummary,
	LockInfo,
	MissingIndex,
	OplogStats,
	QueryStats,
	ReplicaSetStatus,
	SlowQuery,
	ThresholdOverrides,
	TTLIndexInfo,
	UnusedIndex,
	WiredTigerStats,
} from "./types";
export { AnalysisError, classifyMongoError } from "./utils/errors";
export type { HealthScoreResult, HealthStatus } from "./utils/health";
export { calculateHealthScore } from "./utils/health";
