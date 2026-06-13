import type {
	BlockingOperation,
	ConfigurationSetting,
	ConnectionStats,
	CurrentOperation,
	FragmentedCollection,
	MissingIndex,
	OplogStats,
	QueryAntiPattern,
	QueryStats,
	ReplicaSetStatus,
	SchemaAnalysis,
	SchemaIssue,
	ServerInfo,
	ShardingStatus,
	SlowQuery,
	UnusedIndex,
	WiredTigerStats,
} from "../types";
import { formatBytes, formatNumber, formatPercent } from "../utils/format";
import type { HealthScoreResult } from "../utils/health";
import {
	printBullet,
	printRow,
	printSection,
	printSeparator,
	printSubBullet,
} from "../utils/print";

type HealthMetrics = {
	databaseSize: string;
	storageSize: string;
	indexSize: string;
	cacheHitRatio: number;
	collections: number;
	documents: number;
	currentConnections: number;
	availableConnections: number;
};

type CollectionSummary = {
	collection: string;
	totalSize: string;
	storageSize: string;
	indexSize: string;
	documentCount: number;
};

export function showHealth(
	metrics: HealthMetrics,
	health: HealthScoreResult,
): void {
	printRow("Health score", `${health.score}/100 ${health.status}`);
	printRow("Database size", metrics.databaseSize);
	printRow("Storage size", metrics.storageSize);
	printRow("Index size", metrics.indexSize);
	printRow("Cache hit ratio", formatPercent(metrics.cacheHitRatio));
	printRow("Collections", metrics.collections);
	printRow("Documents", formatNumber(metrics.documents));
	printRow(
		"Connections",
		`${metrics.currentConnections} / ${metrics.availableConnections + metrics.currentConnections}`,
	);
	if (health.issues.length > 0) {
		printSection("Issues");
		for (const issue of health.issues) {
			printBullet(issue);
		}
	}
}

export function showUnusedIndexes(indexes: UnusedIndex[]): void {
	if (indexes.length === 0) {
		console.log("  ✅ No unused indexes found");
		return;
	}

	const totalSize = indexes.reduce(
		(accumulator, index) => accumulator + index.sizeBytes,
		0,
	);
	console.log(
		`  Found ${indexes.length} unused indexes — ${formatBytes(totalSize)} wasted`,
	);
	printSeparator();

	for (const index of indexes.slice(0, 10)) {
		printBullet(`${index.collection}.${index.name} (${index.size})`);
		printSubBullet(`Keys: ${index.keyPattern} | Accesses: ${index.accesses}`);
	}

	if (indexes.length > 10) {
		console.log(`  ... and ${indexes.length - 10} more`);
	}
}

export function showMissingIndexes(indexes: MissingIndex[]): void {
	if (indexes.length === 0) {
		console.log("  ✅ No missing indexes detected");
		return;
	}

	console.log(
		`  Found ${indexes.length} query patterns that may need indexes:`,
	);
	printSeparator();

	for (const index of indexes.slice(0, 10)) {
		printBullet(index.collection);
		printSubBullet(
			`Frequency: ${formatNumber(index.frequency)} | Avg: ${index.avgExecutionTime}ms | Benefit: ${index.estimatedBenefit}`,
		);
		printSubBullet(`Suggested: ${index.suggestedIndex}`);
	}
}

export function showDuplicateIndexes(indexes: DuplicateIndex[]): void {
	if (indexes.length === 0) {
		console.log("  ✅ No duplicate indexes found");
		return;
	}

	console.log(`  Found ${indexes.length} duplicate/overlapping pairs:`);
	printSeparator();

	for (const index of indexes.slice(0, 10)) {
		printBullet(index.collection);
		printSubBullet(`${index.index1} vs ${index.index2}`);
		printSubBullet(index.recommendation);
	}
}

type DuplicateIndex = {
	collection: string;
	index1: string;
	index2: string;
	recommendation: string;
};

export function showSlowQueries(queries: SlowQuery[]): void {
	if (queries.length === 0) {
		console.log("  ⚠️  No slow queries available (profiler may be disabled)");
		return;
	}

	console.log(`  Found ${queries.length} slow queries:`);
	printSeparator();

	for (const query of queries.slice(0, 10)) {
		printBullet(`${query.operation.toUpperCase()} on ${query.namespace}`);
		printSubBullet(
			`Total: ${query.totalExecutionTime}ms | Avg: ${query.avgExecutionTime}ms | Count: ${query.executionCount}`,
		);
		printSubBullet(
			`Docs examined: ${formatNumber(query.docsExamined)} | Docs returned: ${formatNumber(query.docsReturned)}`,
		);
		printSubBullet(`Plan: ${query.planSummary}`);
	}
}

export function showQueryStats(queries: QueryStats[]): void {
	if (queries.length === 0) {
		console.log("  ⚠️  No query statistics available");
		return;
	}

	console.log(`  Top ${queries.length} queries by total time:`);
	printSeparator();

	for (const query of queries.slice(0, 10)) {
		printBullet(`${query.operation.toUpperCase()} on ${query.namespace}`);
		printSubBullet(
			`Total: ${query.totalExecutionTime}ms | Avg: ${query.avgExecutionTime}ms | Count: ${query.executionCount}`,
		);
	}
}

export function showQueryAntiPatterns(patterns: QueryAntiPattern[]): void {
	if (patterns.length === 0) {
		console.log("  ✅ No query anti-patterns detected");
		return;
	}

	console.log(`  Found ${patterns.length} anti-pattern(s):`);
	printSeparator();

	for (const pattern of patterns.slice(0, 10)) {
		printBullet(`${pattern.pattern} (${pattern.severity})`);
		printSubBullet(`Count: ${pattern.count}`);
		printSubBullet(pattern.description);
		printSubBullet(`Recommendation: ${pattern.recommendation}`);
	}
}

export function showSchemaOverview(schemas: SchemaAnalysis[]): void {
	if (schemas.length === 0) {
		console.log("  ⚠️  No schema data available");
		return;
	}

	console.log(`  Schema overview for ${schemas.length} collections:`);
	printSeparator();

	for (const schema of schemas.slice(0, 10)) {
		printBullet(schema.collection);
		printSubBullet(
			`Variance: ${schema.schemaVariance}% | Fields: ${schema.fields.length} | Avg doc size: ${schema.estimatedDocumentSizeFormatted}`,
		);
	}
}

export function showSchemaIssues(issues: SchemaIssue[]): void {
	if (issues.length === 0) {
		console.log("  ✅ No schema issues detected");
		return;
	}

	console.log(`  Found ${issues.length} schema issue(s):`);
	printSeparator();

	for (const issue of issues.slice(0, 10)) {
		printBullet(`${issue.collection}.${issue.field} (${issue.severity})`);
		printSubBullet(issue.issue);
		printSubBullet(`Recommendation: ${issue.recommendation}`);
	}
}

export function showCurrentOperations(operations: CurrentOperation[]): void {
	if (operations.length === 0) {
		console.log("  ✅ No active operations");
		return;
	}

	console.log(`  Found ${operations.length} active operations:`);
	printSeparator();

	for (const operation of operations.slice(0, 10)) {
		printBullet(
			`OpId ${operation.opId}: ${operation.operation} on ${operation.namespace}`,
		);
		printSubBullet(`Running: ${operation.runningTimeFormatted}`);
		if (operation.waitingForLock) {
			printSubBullet(`Waiting for lock: ${operation.lockType ?? "unknown"}`);
		}
	}
}

export function showLongRunning(operations: CurrentOperation[]): void {
	if (operations.length === 0) {
		console.log("  ✅ No long-running operations");
		return;
	}

	console.log(`  Found ${operations.length} long-running operations:`);
	printSeparator();

	for (const operation of operations) {
		printBullet(`OpId ${operation.opId}: ${operation.runningTimeFormatted}`);
		printSubBullet(`${operation.operation} on ${operation.namespace}`);
	}
}

export function showBlocking(operations: BlockingOperation[]): void {
	if (operations.length === 0) {
		console.log("  ✅ No blocking operations");
		return;
	}

	console.log(`  Found ${operations.length} blocking operations:`);
	printSeparator();

	for (const operation of operations) {
		printBullet(
			`OpId ${operation.blockedOpId} waiting on ${operation.blockingOpId ?? "unknown"}`,
		);
		printSubBullet(`Namespace: ${operation.blockedNamespace}`);
		printSubBullet(`Wait: ${operation.waitingTimeFormatted}`);
	}
}

export function showCollectionStats(collections: CollectionSummary[]): void {
	console.log(`  Collections (${collections.length}):`);
	printSeparator();

	for (const collection of collections.slice(0, 10)) {
		printBullet(`${collection.collection}: ${collection.totalSize}`);
		printSubBullet(
			`Docs: ${formatNumber(collection.documentCount)} | Storage: ${collection.storageSize} | Index: ${collection.indexSize}`,
		);
	}
}

export function showCompactNeeded(collections: FragmentedCollection[]): void {
	if (collections.length === 0) {
		console.log("  ✅ No significant fragmentation detected");
		return;
	}

	console.log(`  Found ${collections.length} fragmented collections:`);
	printSeparator();

	for (const collection of collections.slice(0, 10)) {
		printBullet(`${collection.collection} (${collection.severity})`);
		printSubBullet(
			`Fragmentation: ${formatPercent(collection.fragmentationRatio, 1)} | Storage: ${collection.storageSize} | Data: ${collection.dataSize}`,
		);
		printSubBullet(collection.recommendation);
	}
}

export function showConnections(stats: ConnectionStats): void {
	printRow("Current", stats.current);
	printRow("Available", stats.available);
	printRow("Active", stats.active);
	printRow("Total created", stats.totalCreated);

	if (stats.byClient.length > 0) {
		printSection("By client");
		for (const entry of stats.byClient.slice(0, 5)) {
			printBullet(`${entry.client}: ${entry.count}`);
		}
	}
}

export function showServerInfo(info: ServerInfo): void {
	printRow("Version", info.version);
	printRow("Storage engine", info.currentStorageEngine);
	printRow("JavaScript engine", info.javascriptEngine);
	printRow("Modules", info.modules.join(", ") || "none");
}

export function showReplicaSet(status: ReplicaSetStatus | null): void {
	if (!status) {
		console.log("  ℹ️  Not a replica set");
		return;
	}

	printRow("Replica set", status.set);
	printRow("Members", status.members.length);
	printSeparator();

	for (const member of status.members) {
		printBullet(`${member.name}: ${member.stateStr}`);
		printSubBullet(`Health: ${member.health}`);
		if (member.replicationLagSeconds !== undefined) {
			printSubBullet(`Lag: ${member.replicationLagSeconds.toFixed(1)}s`);
		}
	}
}

export function showSharding(status: ShardingStatus | null): void {
	if (!status) {
		console.log("  ℹ️  Sharding is not enabled");
		return;
	}

	printRow("Shards", status.shards.length);
	printRow("Databases", status.databases.length);
	printRow("Sharded collections", status.shardedCollections.length);
	if (status.balancerStatus) {
		printRow("Balancer", status.balancerStatus.mode);
	}
}

export function showWiredTiger(stats: WiredTigerStats | null): void {
	if (!stats) {
		console.log("  ℹ️  WiredTiger statistics unavailable");
		return;
	}

	printRow("Cache size", stats.cacheSize);
	printRow("Cache used", stats.cacheUsed);
	printRow("Cache dirty", stats.cacheDirty);
	printRow("Cache hit ratio", formatPercent(stats.cacheHitRatio));
	printRow("Pages read", formatNumber(stats.pagesRead));
	printRow("Pages written", formatNumber(stats.pagesWritten));
}

export function showOplog(stats: OplogStats | null): void {
	if (!stats) {
		console.log("  ℹ️  Oplog statistics unavailable");
		return;
	}

	printRow("Size", stats.size);
	printRow("Used", stats.usedSize);
	printRow("Window", `${stats.timeDiffHours.toFixed(1)}h`);
	printRow(
		"Ops/sec",
		stats.opsPerSecond !== undefined ? stats.opsPerSecond.toFixed(2) : "N/A",
	);
	if (stats.firstEntry) {
		printRow("First entry", stats.firstEntry.toISOString());
	}
	if (stats.lastEntry) {
		printRow("Last entry", stats.lastEntry.toISOString());
	}
}

export function showConfig(settings: ConfigurationSetting[]): void {
	if (settings.length === 0) {
		console.log("  ℹ️  No configuration settings available");
		return;
	}

	console.log("  Important settings:");
	printSeparator();

	for (const setting of settings.slice(0, 15)) {
		printBullet(`${setting.name}: ${setting.value}`);
		printSubBullet(setting.description);
	}
}

export function showProfilerStatus(status: {
	level: number;
	slowMs: number;
}): void {
	printRow("Profiler level", status.level);
	printRow("Slow ms", status.slowMs);
}

export function showCurrentSettings(
	profile: string | undefined,
	collections: string[] | undefined,
): void {
	printRow("Active profile", profile ?? "(none — using env / flags)");
	printRow("Collection filter", collections?.join(", ") ?? "(all collections)");
}
