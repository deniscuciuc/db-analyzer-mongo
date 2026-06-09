import { checkbox, confirm, select } from "@inquirer/prompts";
import type { Db, MongoClient } from "mongodb";
import { CollectionAnalyzer } from "./analyzers/collection-analyzer";
import { IndexAnalyzer } from "./analyzers/index-analyzer";
import { QueryAnalyzer } from "./analyzers/query-analyzer";
import { SchemaAnalyzer } from "./analyzers/schema-analyzer";
import { StatsCollector } from "./collectors/stats-collector";
import { ReportGenerator } from "./reporters/report-generator";
import type { AnalyzerOptions } from "./types";
import { formatBytes } from "./utils/formatting";
import { calculateHealthScore } from "./utils/health";

interface AnalysisModule {
	name: string;
	value: string;
	description: string;
}

const ANALYSIS_MODULES: AnalysisModule[] = [
	{
		name: "Health Score",
		value: "health",
		description: "Database health metrics and score",
	},
	{
		name: "Unused Indexes",
		value: "unused-indexes",
		description: "Indexes that are rarely or never used",
	},
	{
		name: "Missing Indexes",
		value: "missing-indexes",
		description: "Query patterns that may need indexes",
	},
	{
		name: "Duplicate Indexes",
		value: "duplicate-indexes",
		description: "Overlapping or duplicate indexes",
	},
	{
		name: "Slow Queries",
		value: "slow-queries",
		description: "Queries with high execution time",
	},
	{
		name: "Query Anti-Patterns",
		value: "query-antipatterns",
		description: "Detect inefficient query patterns",
	},
	{
		name: "Schema Overview",
		value: "schema",
		description: "Field usage and schema variance",
	},
	{
		name: "Schema Issues",
		value: "schema-issues",
		description: "Inconsistent fields and schema risks",
	},
	{
		name: "Current Operations",
		value: "current-ops",
		description: "Currently running operations",
	},
	{
		name: "Long Running Queries",
		value: "long-running",
		description: "Operations running for >1 minute",
	},
	{
		name: "Collection Statistics",
		value: "collections",
		description: "Largest collections and their stats",
	},
	{
		name: "Fragmentation",
		value: "fragmentation",
		description: "Collections with high fragmentation",
	},
	{
		name: "Connection Stats",
		value: "connections",
		description: "Database connection statistics",
	},
	{
		name: "Server Info",
		value: "server-info",
		description: "MongoDB server information",
	},
	{
		name: "Replica Set Status",
		value: "replica-set",
		description: "Replica set member status",
	},
	{
		name: "Configuration",
		value: "config",
		description: "Important configuration settings",
	},
	{
		name: "Run Compact",
		value: "run-compact",
		description: "Execute compact on fragmented collections",
	},
	{
		name: "Enable Profiler",
		value: "enable-profiler",
		description: "Enable database profiler for query analysis",
	},
	{
		name: "Disable Profiler",
		value: "disable-profiler",
		description: "Disable database profiler",
	},
];

export class InteractiveCLI {
	private indexAnalyzer: IndexAnalyzer;
	private queryAnalyzer: QueryAnalyzer;
	private schemaAnalyzer: SchemaAnalyzer;
	private collectionAnalyzer: CollectionAnalyzer;
	private statsCollector: StatsCollector;
	private reportGenerator: ReportGenerator;
	private options: AnalyzerOptions;

	constructor(
		client: MongoClient,
		private db: Db,
		options: AnalyzerOptions = {},
	) {
		this.options = options;
		this.indexAnalyzer = new IndexAnalyzer(db, options);
		this.queryAnalyzer = new QueryAnalyzer(db, options);
		this.schemaAnalyzer = new SchemaAnalyzer(db, options);
		this.collectionAnalyzer = new CollectionAnalyzer(db, options);
		this.statsCollector = new StatsCollector(client, db, options);
		this.reportGenerator = new ReportGenerator(
			options.outputDir ?? "./reports",
		);
	}

	async start(): Promise<void> {
		console.clear();
		console.log(
			"╔════════════════════════════════════════════════════════════╗",
		);
		console.log(
			"║           MongoDB Database Analyzer - Interactive          ║",
		);
		console.log(
			"╚════════════════════════════════════════════════════════════╝\n",
		);

		// Get database info
		const serverInfo = await this.statsCollector.getServerInfo();
		console.log(
			`Connected to: ${this.db.databaseName} (MongoDB ${serverInfo.version})\n`,
		);

		let continueLoop = true;

		while (continueLoop) {
			const action = await select({
				message: "What would you like to do?",
				choices: [
					{ name: "Quick Analysis (select modules)", value: "quick" },
					{ name: "Full Analysis (all modules)", value: "full" },
					{ name: "Health Check Only", value: "health" },
					{ name: "Run Compact", value: "compact" },
					{ name: "Single Module Analysis", value: "single" },
					{ name: "Generate Report", value: "report" },
					{ name: "Exit", value: "exit" },
				],
			});

			switch (action) {
				case "quick":
					await this.runQuickAnalysis();
					break;
				case "full":
					await this.runFullAnalysis();
					break;
				case "health":
					await this.runHealthCheck();
					break;
				case "compact":
					await this.runCompactFromMenu();
					break;
				case "single":
					await this.runSingleModule();
					break;
				case "report":
					await this.generateFullReport();
					break;
				case "exit":
					continueLoop = false;
					break;
			}

			if (continueLoop && action !== "exit") {
				continueLoop = await confirm({
					message: "Would you like to continue?",
					default: true,
				});
			}
		}

		console.log("\nGoodbye!\n");
	}

	private async runQuickAnalysis(): Promise<void> {
		const selected = await checkbox({
			message: "Select analysis modules:",
			choices: ANALYSIS_MODULES.map((m) => ({
				name: `${m.name} - ${m.description}`,
				value: m.value,
			})),
		});

		if (selected.length === 0) {
			console.log("\nNo modules selected.\n");
			return;
		}

		console.log("\n");
		for (const module of selected) {
			await this.runModule(module);
			console.log("");
		}
	}

	private async runFullAnalysis(): Promise<void> {
		console.log("\n Running full analysis...\n");

		const modules = [
			"health",
			"unused-indexes",
			"missing-indexes",
			"slow-queries",
			"query-antipatterns",
			"schema-issues",
			"collections",
			"fragmentation",
		];
		for (const module of modules) {
			await this.runModule(module);
			console.log("");
		}
	}

	private async runHealthCheck(): Promise<void> {
		console.log("\n Running health check...\n");
		await this.runModule("health");
	}

	private async runCompactFromMenu(): Promise<void> {
		console.log("\n Running Compact...\n");
		await this.runModule("run-compact");
	}

	private async runSingleModule(): Promise<void> {
		const module = await select({
			message: "Select analysis module:",
			choices: ANALYSIS_MODULES.map((m) => ({
				name: `${m.name} - ${m.description}`,
				value: m.value,
			})),
		});

		console.log("\n");
		await this.runModule(module);
	}

	private async runModule(module: string): Promise<void> {
		const moduleName =
			ANALYSIS_MODULES.find((m) => m.value === module)?.name ?? module;
		console.log(`--- ${moduleName} ---`);

		try {
			switch (module) {
				case "health":
					await this.showHealth();
					break;
				case "unused-indexes":
					await this.showUnusedIndexes();
					break;
				case "missing-indexes":
					await this.showMissingIndexes();
					break;
				case "duplicate-indexes":
					await this.showDuplicateIndexes();
					break;
				case "slow-queries":
					await this.showSlowQueries();
					break;
				case "query-antipatterns":
					await this.showQueryAntiPatterns();
					break;
				case "schema":
					await this.showSchemaOverview();
					break;
				case "schema-issues":
					await this.showSchemaIssues();
					break;
				case "current-ops":
					await this.showCurrentOps();
					break;
				case "long-running":
					await this.showLongRunning();
					break;
				case "collections":
					await this.showCollectionStats();
					break;
				case "fragmentation":
					await this.showFragmentation();
					break;
				case "connections":
					await this.showConnections();
					break;
				case "server-info":
					await this.showServerInfo();
					break;
				case "replica-set":
					await this.showReplicaSet();
					break;
				case "config":
					await this.showConfig();
					break;
				case "run-compact":
					await this.runCompact();
					break;
				case "enable-profiler":
					await this.enableProfiler();
					break;
				case "disable-profiler":
					await this.disableProfiler();
					break;
			}
		} catch (error) {
			console.log(`  Error: ${error}`);
		}
	}

	private async showHealth(): Promise<void> {
		const [
			metrics,
			unusedIndexes,
			missingIndexes,
			slowQueries,
			fragmentedCollections,
		] = await Promise.all([
			this.statsCollector.getDatabaseMetrics(),
			this.indexAnalyzer.getUnusedIndexes(),
			this.indexAnalyzer.getMissingIndexes(),
			this.queryAnalyzer.getSlowQueries(),
			this.collectionAnalyzer.getFragmentedCollections(),
		]);

		const health = calculateHealthScore({
			metrics,
			unusedIndexesCount: unusedIndexes.length,
			missingIndexesCount: missingIndexes.length,
			slowQueriesCount: slowQueries.length,
			fragmentedCollectionsCount: fragmentedCollections.length,
		});

		const statusLabel =
			health.status === "excellent"
				? "Excellent"
				: health.status === "good"
					? "Good"
					: health.status === "fair"
						? "Fair"
						: health.status === "poor"
							? "Warning"
							: "Critical";

		console.log(`  Health Score: ${health.score}/100 ${statusLabel}`);
		console.log(`  Database Size: ${metrics.databaseSize}`);
		console.log(`  Storage Size: ${metrics.storageSize}`);
		console.log(`  Index Size: ${metrics.indexSize}`);
		console.log(`  Cache Hit Ratio: ${metrics.cacheHitRatio}%`);
		console.log(`  Collections: ${metrics.collections}`);
		console.log(`  Documents: ${metrics.documents.toLocaleString()}`);
		console.log(
			`  Connections: ${metrics.currentConnections} / ${metrics.availableConnections + metrics.currentConnections}`,
		);
	}

	private async showUnusedIndexes(): Promise<void> {
		const indexes = await this.indexAnalyzer.getUnusedIndexes();
		if (indexes.length === 0) {
			console.log("  No unused indexes found");
			return;
		}

		console.log(`  Found ${indexes.length} unused indexes:`);
		const totalSize = indexes.reduce((acc, idx) => acc + idx.sizeBytes, 0);
		console.log(`  Total wasted space: ${formatBytes(totalSize)}`);
		console.log("");

		for (const idx of indexes.slice(0, 10)) {
			console.log(`  - ${idx.collection}.${idx.name} (${idx.size})`);
			console.log(`    Keys: ${idx.keyPattern}, Accesses: ${idx.accesses}`);
		}

		if (indexes.length > 10) {
			console.log(`  ... and ${indexes.length - 10} more`);
		}
	}

	private async showMissingIndexes(): Promise<void> {
		const missing = await this.indexAnalyzer.getMissingIndexes();
		if (missing.length === 0) {
			console.log(
				"  No missing indexes detected (enable profiler for more data)",
			);
			return;
		}

		console.log(
			`  Found ${missing.length} query patterns that may need indexes:`,
		);
		console.log("");

		for (const m of missing.slice(0, 10)) {
			console.log(`  - ${m.collection}`);
			console.log(
				`    Frequency: ${m.frequency}, Avg: ${m.avgExecutionTime}ms`,
			);
			console.log(`    Suggested: ${m.suggestedIndex}`);
		}

		if (missing.length > 10) {
			console.log(`  ... and ${missing.length - 10} more`);
		}
	}

	private async showDuplicateIndexes(): Promise<void> {
		const duplicates = await this.indexAnalyzer.getDuplicateIndexes();
		if (duplicates.length === 0) {
			console.log("  No duplicate indexes found");
			return;
		}

		console.log(
			`  Found ${duplicates.length} duplicate/overlapping index pairs:`,
		);
		console.log("");

		for (const dup of duplicates.slice(0, 5)) {
			console.log(`  - ${dup.collection}`);
			console.log(`    ${dup.index1} vs ${dup.index2}`);
			console.log(`    ${dup.recommendation}`);
		}
	}

	private async showSlowQueries(): Promise<void> {
		const queries = await this.queryAnalyzer.getAllQueryStats(5, 10);
		if (queries.length === 0) {
			console.log(
				"  No query statistics available (profiler may not be enabled)",
			);
			return;
		}

		console.log(`  Top ${queries.length} queries by total time:`);
		console.log("");

		for (let i = 0; i < queries.length; i++) {
			const q = queries[i];
			console.log(`  ${i + 1}. ${q.operation.toUpperCase()} on ${q.namespace}`);
			console.log(
				`     Count: ${q.executionCount}, Total: ${q.totalExecutionTime}ms, Avg: ${q.avgExecutionTime}ms`,
			);
		}
	}

	private async showQueryAntiPatterns(): Promise<void> {
		const patterns = await this.queryAnalyzer.detectQueryAntiPatterns();
		if (patterns.length === 0) {
			console.log("  No query anti-patterns detected");
			return;
		}

		console.log(`  Found ${patterns.length} anti-pattern(s):`);
		console.log("");

		for (const p of patterns) {
			console.log(`  - ${p.pattern} (${p.severity})`);
			console.log(`    Count: ${p.count}`);
			console.log(`    ${p.description}`);
			console.log(`    Recommendation: ${p.recommendation}`);
		}
	}

	private async showSchemaOverview(): Promise<void> {
		const schemas = await this.schemaAnalyzer.analyzeAllSchemas(
			this.options.schemaSampleSize ?? 1000,
		);

		if (schemas.length === 0) {
			console.log("  No schema data available");
			return;
		}

		console.log(`  Schema overview for ${schemas.length} collections:`);
		console.log("");

		for (const schema of schemas.slice(0, 10)) {
			console.log(`  - ${schema.collection}`);
			console.log(
				`    Variance: ${schema.schemaVariance}%, Fields: ${schema.fields.length}, Avg Doc Size: ${schema.estimatedDocumentSizeFormatted}`,
			);
		}

		if (schemas.length > 10) {
			console.log(`  ... and ${schemas.length - 10} more`);
		}
	}

	private async showSchemaIssues(): Promise<void> {
		const issues = await this.schemaAnalyzer.findSchemaIssues(
			this.options.schemaSampleSize ?? 1000,
		);

		if (issues.length === 0) {
			console.log("  No schema issues detected");
			return;
		}

		console.log(`  Found ${issues.length} schema issue(s):`);
		console.log("");

		for (const issue of issues.slice(0, 10)) {
			console.log(`  - ${issue.collection}.${issue.field} (${issue.severity})`);
			console.log(`    ${issue.issue}`);
			console.log(`    Recommendation: ${issue.recommendation}`);
		}

		if (issues.length > 10) {
			console.log(`  ... and ${issues.length - 10} more`);
		}
	}

	private async showCurrentOps(): Promise<void> {
		const ops = await this.queryAnalyzer.getCurrentOperations();
		if (ops.length === 0) {
			console.log("  No active operations");
			return;
		}

		console.log(`  Found ${ops.length} active operations:`);
		console.log("");

		for (const op of ops.slice(0, 10)) {
			console.log(`  - OpId ${op.opId}: ${op.operation} on ${op.namespace}`);
			console.log(`    Running: ${op.runningTime}ms`);
		}
	}

	private async showLongRunning(): Promise<void> {
		const queries = await this.queryAnalyzer.getLongRunningQueries();
		if (queries.length === 0) {
			console.log("  No long-running queries");
			return;
		}

		console.log(`  Found ${queries.length} long-running queries:`);
		console.log("");

		for (const q of queries) {
			console.log(`  - OpId ${q.opId}: ${q.runningTimeFormatted}`);
			console.log(`    ${q.operation} on ${q.namespace}`);
		}
	}

	private async showCollectionStats(): Promise<void> {
		const collections = await this.collectionAnalyzer.getLargestCollections(10);
		console.log(`  Top ${collections.length} largest collections:`);
		console.log("");

		for (const c of collections) {
			console.log(`  - ${c.collection}: ${c.totalSize}`);
			console.log(
				`    Docs: ${c.documentCount.toLocaleString()}, Storage: ${c.storageSize}, Index: ${c.indexSize}`,
			);
		}
	}

	private async showFragmentation(): Promise<void> {
		const fragmented = await this.collectionAnalyzer.getFragmentedCollections();
		if (fragmented.length === 0) {
			console.log("  No significant fragmentation detected");
			return;
		}

		console.log(`  Found ${fragmented.length} fragmented collections:`);
		console.log("");

		for (const f of fragmented.slice(0, 10)) {
			console.log(`  - ${f.collection}`);
			console.log(`    Fragmentation: ${f.fragmentationRatio}%`);
		}
	}

	private async showConnections(): Promise<void> {
		const stats = await this.statsCollector.getConnectionStats();
		console.log(`  Current: ${stats.current}`);
		console.log(`  Available: ${stats.available}`);
		console.log(`  Active: ${stats.active}`);
		console.log(`  Total Created: ${stats.totalCreated}`);
	}

	private async showServerInfo(): Promise<void> {
		const info = await this.statsCollector.getServerInfo();
		console.log(`  Version: ${info.version}`);
		console.log(`  Storage Engine: ${info.currentStorageEngine}`);
		console.log(`  JS Engine: ${info.javascriptEngine}`);
		console.log(`  Modules: ${info.modules.join(", ") || "none"}`);
	}

	private async showReplicaSet(): Promise<void> {
		const status = await this.statsCollector.getReplicaSetStatus();
		if (!status) {
			console.log("  Not a replica set");
			return;
		}

		console.log(`  Replica Set: ${status.set}`);
		console.log(`  Members: ${status.members.length}`);
		console.log("");

		for (const m of status.members) {
			console.log(`  - ${m.name}: ${m.stateStr} (health: ${m.health})`);
		}
	}

	private async showConfig(): Promise<void> {
		const config = await this.statsCollector.getConfigurationSettings();
		console.log("  Important settings:");
		console.log("");

		for (const c of config) {
			console.log(`  - ${c.name}: ${c.value}`);
		}
	}

	private async enableProfiler(): Promise<void> {
		const profilerStatus = await this.queryAnalyzer.checkProfilerEnabled();

		if (profilerStatus.level > 0) {
			console.log(
				`  Profiler already enabled at level ${profilerStatus.level} with slowms=${profilerStatus.slowMs}`,
			);
			return;
		}

		const shouldProceed = await confirm({
			message: "Enable profiler for slow queries (>100ms)?",
			default: true,
		});

		if (!shouldProceed) {
			console.log("  Skipped");
			return;
		}

		const result = await this.queryAnalyzer.enableProfiler(1, 100);
		console.log(`  ${result.success ? "Success" : "Error"}: ${result.message}`);
	}

	private async disableProfiler(): Promise<void> {
		const profilerStatus = await this.queryAnalyzer.checkProfilerEnabled();

		if (profilerStatus.level === 0) {
			console.log("  Profiler is already disabled");
			return;
		}

		const shouldProceed = await confirm({
			message: "Disable profiler?",
			default: false,
		});

		if (!shouldProceed) {
			console.log("  Skipped");
			return;
		}

		const result = await this.queryAnalyzer.disableProfiler();
		console.log(`  ${result.success ? "Success" : "Error"}: ${result.message}`);
	}

	private async runCompact(): Promise<void> {
		const needsCompact =
			await this.collectionAnalyzer.getCollectionsNeedingCompact();

		if (needsCompact.length === 0) {
			console.log("  No collections need compaction");
			return;
		}

		console.log(`  Found ${needsCompact.length} collections needing compact:`);
		console.log("");

		for (const c of needsCompact) {
			console.log(
				`  - ${c.collection} (${c.fragmentationRatio}% fragmentation)`,
			);
		}

		console.log("");

		const shouldProceed = await confirm({
			message: `Run compact on ${needsCompact.length} collections?`,
			default: false,
		});

		if (!shouldProceed) {
			console.log("  Skipped");
			return;
		}

		console.log("");
		console.log("  Running compact...");
		console.log("");

		const summary = await this.collectionAnalyzer.autoCompact({
			onProgress: (result, index, total) => {
				const status = result.success ? "OK" : "FAIL";
				const duration = `${result.duration}ms`;
				const freed = result.bytesFreed
					? `, freed ${formatBytes(result.bytesFreed)}`
					: "";
				console.log(
					`  [${index}/${total}] ${status} ${result.collection} (${duration}${freed})`,
				);
				if (!result.success && result.error) {
					console.log(`         Error: ${result.error}`);
				}
			},
		});

		console.log("");
		console.log(
			`  Completed: ${summary.successful}/${summary.totalCollections} collections`,
		);
		console.log(`  Total time: ${summary.totalDuration}ms`);
		console.log(`  Space freed: ${formatBytes(summary.totalBytesFreed)}`);

		if (summary.failed > 0) {
			console.log(`  Failed: ${summary.failed} collections`);
		}
	}

	private async generateFullReport(): Promise<void> {
		console.log("\n Generating full report...\n");

		const [
			metrics,
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
			collectionStats,
			slowQueries,
			fragmentedCollections,
			queryAntiPatterns,
			schemaIssues,
		] = await Promise.all([
			this.statsCollector.getDatabaseMetrics(),
			this.indexAnalyzer.getUnusedIndexes(),
			this.indexAnalyzer.getMissingIndexes(),
			this.indexAnalyzer.getDuplicateIndexes(),
			this.collectionAnalyzer.getCollectionStats(),
			this.queryAnalyzer.getSlowQueries(),
			this.collectionAnalyzer.getFragmentedCollections(),
			this.queryAnalyzer.detectQueryAntiPatterns(),
			this.schemaAnalyzer.findSchemaIssues(
				this.options.schemaSampleSize ?? 1000,
			),
		]);

		const health = calculateHealthScore({
			metrics,
			unusedIndexesCount: unusedIndexes.length,
			missingIndexesCount: missingIndexes.length,
			slowQueriesCount: slowQueries.length,
			fragmentedCollectionsCount: fragmentedCollections.length,
		});

		const indexRecommendations = this.indexAnalyzer.generateRecommendations(
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
		);
		const metricsReport = this.statsCollector.generateMetricsReport(metrics);
		const recommendations = [
			...indexRecommendations,
			...metricsReport.recommendations,
		];

		if (queryAntiPatterns.length > 0) {
			recommendations.push(
				`Detected ${queryAntiPatterns.length} query anti-pattern(s). Review and optimize flagged queries.`,
			);
		}

		if (schemaIssues.length > 0) {
			recommendations.push(
				`Detected ${schemaIssues.length} schema issue(s). Consider schema validation and cleanup.`,
			);
		}

		const report = {
			generatedAt: new Date(),
			databaseName: this.db.databaseName,
			metrics,
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
			collectionStats,
			slowQueries,
			fragmentedCollections,
			queryAntiPatterns,
			schemaIssues,
			recommendations,
			healthScore: health.score,
		};

		const [markdown, json] = await Promise.all([
			this.reportGenerator.generateFullReport(report),
			this.reportGenerator.generateJsonReport(report),
		]);

		console.log(`  Reports generated:`);
		console.log(`     Markdown: ${markdown}`);
		console.log(`     JSON: ${json}`);
	}
}
