import { existsSync, readFileSync } from "node:fs";
import { type Db, MongoClient } from "mongodb";
import { CollectionAnalyzer } from "./src/analyzers/collection-analyzer";
import { IndexAnalyzer } from "./src/analyzers/index-analyzer";
import { QueryAnalyzer } from "./src/analyzers/query-analyzer";
import { SchemaAnalyzer } from "./src/analyzers/schema-analyzer";
import { StatsCollector } from "./src/collectors/stats-collector";
import { loadConfig, resolveProfile } from "./src/config";
import { InteractiveCLI } from "./src/interactive";
import { DiffReporter } from "./src/reporters/diff-reporter";
import { ReportGenerator } from "./src/reporters/report-generator";
import type {
	AnalysisReport,
	AnalyzerOptions,
	CompactSummary,
	CompactTarget,
	DatabaseConfig,
	FullReport,
} from "./src/types";
import { calculateHealthScore } from "./src/utils/health";
import { runWatchLoop } from "./src/watch";

class MongoDBAnalyzer {
	private client: MongoClient;
	private db: Db;
	private options: AnalyzerOptions;
	private indexAnalyzer: IndexAnalyzer;
	private queryAnalyzer: QueryAnalyzer;
	private schemaAnalyzer: SchemaAnalyzer;
	private collectionAnalyzer: CollectionAnalyzer;
	private statsCollector: StatsCollector;
	private reportGenerator: ReportGenerator;

	constructor(client: MongoClient, db: Db, options: AnalyzerOptions = {}) {
		this.client = client;
		this.db = db;
		this.options = options;

		this.indexAnalyzer = new IndexAnalyzer(db, options);
		this.queryAnalyzer = new QueryAnalyzer(db, options);
		this.schemaAnalyzer = new SchemaAnalyzer(db, options);
		this.collectionAnalyzer = new CollectionAnalyzer(db, options);
		this.statsCollector = new StatsCollector(client, db, options);
		this.reportGenerator = new ReportGenerator(
			options.outputDir ?? "./reports",
			options,
		);
	}

	static async connect(
		config: DatabaseConfig,
		options: AnalyzerOptions = {},
	): Promise<MongoDBAnalyzer> {
		const uri = config.uri ?? buildConnectionUri(config);
		const client = new MongoClient(uri, {
			connectTimeoutMS: config.connectTimeoutMs ?? 10_000,
			socketTimeoutMS: config.socketTimeoutMs ?? 30_000,
			serverSelectionTimeoutMS: config.connectTimeoutMs ?? 10_000,
		});
		await client.connect();
		const db = client.db(config.database);
		return new MongoDBAnalyzer(client, db, options);
	}

	async analyze(): Promise<AnalysisReport> {
		const log = this.options.log ?? console.log;

		log("Starting database analysis...\n");

		log("Collecting database metrics...");
		const metrics = await this.statsCollector.getDatabaseMetrics();

		log("Analyzing indexes...");
		const [unusedIndexes, missingIndexes, duplicateIndexes, ttlIndexes] =
			await Promise.all([
				this.indexAnalyzer.getUnusedIndexes(),
				this.indexAnalyzer.getMissingIndexes(),
				this.indexAnalyzer.getDuplicateIndexes(),
				this.statsCollector.getTTLIndexes(),
			]);

		log("Analyzing collections...");
		const [collectionStats, fragmentedCollections] = await Promise.all([
			this.collectionAnalyzer.getCollectionStats(),
			this.collectionAnalyzer.getFragmentedCollections(),
		]);

		log("Analyzing queries...");
		const [slowQueries, queryAntiPatterns] = await Promise.all([
			this.queryAnalyzer.getSlowQueries(),
			this.queryAnalyzer.detectQueryAntiPatterns(),
		]);

		log("Analyzing schema...");
		const schemaIssues = await this.schemaAnalyzer.findSchemaIssues(
			this.options.schemaSampleSize,
		);

		log("Collecting system stats...");
		const [wiredTigerStats, replicaSetStatus, connectionStats] =
			await Promise.all([
				this.statsCollector.getWiredTigerStats(),
				this.statsCollector.getReplicaSetStatus(),
				this.statsCollector.getConnectionStats(),
			]);

		log("Analyzing document sizes...");
		const largestCollections = [...collectionStats]
			.sort((a, b) => b.documentCount - a.documentCount)
			.slice(0, 3);

		const documentSizeDistribution = (
			await Promise.all(
				largestCollections.map((c) =>
					this.statsCollector.getDocumentSizeDistribution(c.collection, 500),
				),
			)
		).filter((d) => d !== null);

		log("Generating recommendations...");
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

		if (replicaSetStatus) {
			const laggyMembers = replicaSetStatus.members.filter(
				(m) =>
					m.replicationLagSeconds !== undefined && m.replicationLagSeconds > 10,
			);
			if (laggyMembers.length > 0) {
				recommendations.push(
					`Replication lag detected on ${laggyMembers.length} member(s). Check network and disk I/O.`,
				);
			}
		}

		const health = calculateHealthScore(
			{
				metrics,
				unusedIndexesCount: unusedIndexes.length,
				missingIndexesCount: missingIndexes.length,
				slowQueriesCount: slowQueries.length,
				fragmentedCollectionsCount: fragmentedCollections.length,
			},
			this.options.thresholds,
		);

		const errors = [
			...this.indexAnalyzer.getErrors(),
			...this.queryAnalyzer.getErrors(),
			...this.collectionAnalyzer.getErrors(),
			...this.statsCollector.getErrors(),
			...this.schemaAnalyzer.getErrors(),
		];
		const errorDetails =
			errors.length > 0 ? errors.map((error) => error.toJSON()) : undefined;

		const report: AnalysisReport = {
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
			errors: errorDetails,
			ttlIndexes,
			wiredTigerStats: wiredTigerStats ?? undefined,
			documentSizeDistribution,
			replicaSetStatus: replicaSetStatus ?? undefined,
			connectionStats,
		};

		return report;
	}

	async generateReport(
		report: AnalysisReport,
		options: { html?: boolean } = {},
	): Promise<{
		markdown: string;
		json: string;
		html?: string;
	}> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const [markdown, json, html] = await Promise.all([
			this.reportGenerator.generateFullReport(report, timestamp),
			this.reportGenerator.generateJsonReport(report, timestamp),
			options.html
				? this.reportGenerator.generateHtmlReport(report, timestamp)
				: Promise.resolve(undefined),
		]);

		return { markdown, json, html };
	}

	printSummary(report: AnalysisReport): void {
		this.reportGenerator.printSummary(report);
	}

	async close(): Promise<void> {
		await this.client.close();
	}

	async getIndexUsageSummary() {
		return this.indexAnalyzer.getIndexUsageSummary();
	}

	async getLongRunningQueries() {
		return this.queryAnalyzer.getLongRunningQueries();
	}

	async getBlockingOperations() {
		return this.queryAnalyzer.getBlockingOperations();
	}

	async getSlowQueries() {
		return this.queryAnalyzer.getSlowQueries();
	}

	async getCollectionStats() {
		return this.collectionAnalyzer.getCollectionStats();
	}

	async getCurrentOperations() {
		return this.queryAnalyzer.getCurrentOperations();
	}

	async getConnectionStats() {
		return this.statsCollector.getConnectionStats();
	}

	async getConfigurationSettings() {
		return this.statsCollector.getConfigurationSettings();
	}

	async getServerInfo() {
		return this.statsCollector.getServerInfo();
	}

	async getReplicaSetStatus() {
		return this.statsCollector.getReplicaSetStatus();
	}

	async getShardingStatus() {
		return this.statsCollector.getShardingStatus();
	}

	async getWiredTigerStats() {
		return this.statsCollector.getWiredTigerStats();
	}

	async getOplogStats() {
		return this.statsCollector.getOplogStats();
	}

	async getCollectionsNeedingCompact() {
		return this.collectionAnalyzer.getCollectionsNeedingCompact();
	}

	async getLargestCollections(limit?: number) {
		return this.collectionAnalyzer.getLargestCollections(limit);
	}

	async getAllQueryStats(minCount = 5, limit = 50) {
		return this.queryAnalyzer.getAllQueryStats(minCount, limit);
	}

	async getQueryAntiPatterns() {
		return this.queryAnalyzer.detectQueryAntiPatterns();
	}

	async getSchemaAnalysis(sampleSize?: number) {
		return this.schemaAnalyzer.analyzeAllSchemas(
			sampleSize ?? this.options.schemaSampleSize,
		);
	}

	async getSchemaIssues(sampleSize?: number) {
		return this.schemaAnalyzer.findSchemaIssues(
			sampleSize ?? this.options.schemaSampleSize,
		);
	}

	async compactCollection(collection: string) {
		return this.collectionAnalyzer.compactCollection(collection);
	}

	async compactCollections(
		targets: CompactTarget[],
		options?: {
			onProgress?: (
				result: { collection: string; success: boolean },
				index: number,
				total: number,
			) => void;
		},
	): Promise<CompactSummary> {
		return this.collectionAnalyzer.compactCollections(targets, options);
	}

	async autoCompact(options?: {
		onProgress?: (
			result: { collection: string; success: boolean },
			index: number,
			total: number,
		) => void;
	}): Promise<CompactSummary> {
		return this.collectionAnalyzer.autoCompact(options);
	}

	async enableProfiler(
		level = 1,
		slowMs = 100,
	): Promise<{ success: boolean; message: string }> {
		return this.queryAnalyzer.enableProfiler(level, slowMs);
	}

	async disableProfiler(): Promise<{ success: boolean; message: string }> {
		return this.queryAnalyzer.disableProfiler();
	}

	async checkProfilerEnabled(): Promise<{ level: number; slowMs: number }> {
		return this.queryAnalyzer.checkProfilerEnabled();
	}

	async getHealthSnapshot(): Promise<{
		healthScore: number;
		metrics: AnalysisReport["metrics"];
		issues: string[];
		recommendations: string[];
	}> {
		const [metrics, unusedIndexes, missingIndexes, slowQueries, fragmented] =
			await Promise.all([
				this.statsCollector.getDatabaseMetrics(),
				this.indexAnalyzer.getUnusedIndexes(),
				this.indexAnalyzer.getMissingIndexes(),
				this.queryAnalyzer.getSlowQueries(),
				this.collectionAnalyzer.getFragmentedCollections(),
			]);

		const health = calculateHealthScore(
			{
				metrics,
				unusedIndexesCount: unusedIndexes.length,
				missingIndexesCount: missingIndexes.length,
				slowQueriesCount: slowQueries.length,
				fragmentedCollectionsCount: fragmented.length,
			},
			this.options.thresholds,
		);

		return {
			healthScore: health.score,
			metrics,
			issues: health.issues,
			recommendations: health.issues,
		};
	}
}

function buildConnectionUri(config: DatabaseConfig): string {
	const host = config.host ?? "localhost";
	const port = config.port ?? 27017;

	if (config.user && config.password) {
		const authSource = config.authSource ?? "admin";
		return `mongodb://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}:${port}/${config.database}?authSource=${authSource}`;
	}

	return `mongodb://${host}:${port}/${config.database}`;
}

/**
 * Parse database name from MongoDB connection string
 * Supports both mongodb:// and mongodb+srv:// protocols
 */
function parseDatabaseFromConnectionString(
	connectionString: string,
): string | undefined {
	try {
		// Handle mongodb+srv:// by replacing with mongodb:// for URL parsing
		const normalizedUri = connectionString.replace(
			"mongodb+srv://",
			"mongodb://",
		);
		const url = new URL(normalizedUri);

		// Extract database from pathname (e.g., /mydb -> mydb)
		const pathname = url.pathname;
		if (pathname && pathname.length > 1) {
			return pathname.substring(1); // Remove leading /
		}

		return undefined;
	} catch {
		// Fallback: try regex parsing
		const match = connectionString.match(/\/([^/?]+)(?:\?|$)/);
		return match?.[1];
	}
}

async function main() {
	const args = process.argv.slice(2);

	const options: {
		uri?: string;
		host?: string;
		port?: number;
		database?: string;
		user?: string;
		password?: string;
		authSource?: string;
		output?: string;
		slowQueryThreshold?: number;
		minIndexAccesses?: number;
		help?: boolean;
		json?: boolean;
		quiet?: boolean;
		command?: string;
		interactive?: boolean;
		profile?: string;
		configPath?: string;
		collections?: string;
		compare?: string;
		html?: boolean;
		watch?: boolean | string;
	} = {};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--uri":
				options.uri = args[++i];
				break;
			case "--host":
			case "-h":
				options.host = args[++i];
				break;
			case "--port":
			case "-p":
				options.port = Number.parseInt(args[++i], 10);
				break;
			case "--database":
			case "-d":
				options.database = args[++i];
				break;
			case "--user":
			case "-U":
				options.user = args[++i];
				break;
			case "--password":
			case "-W":
				options.password = args[++i];
				break;
			case "--authSource":
				options.authSource = args[++i];
				break;
			case "--output":
			case "-o":
				options.output = args[++i];
				break;
			case "--profile":
				options.profile = args[++i];
				break;
			case "--config":
				options.configPath = args[++i];
				break;
			case "--collections":
				options.collections = args[++i];
				break;
			case "--compare":
				options.compare = args[++i];
				break;
			case "--html":
				options.html = true;
				break;
			case "--watch": {
				const nextValue = args[i + 1];
				if (nextValue && !nextValue.startsWith("-")) {
					options.watch = nextValue;
					i++;
				} else {
					options.watch = true;
				}
				break;
			}
			case "--slow-query-threshold":
				options.slowQueryThreshold = Number.parseInt(args[++i], 10);
				break;
			case "--min-index-accesses":
				options.minIndexAccesses = Number.parseInt(args[++i], 10);
				break;
			case "--help":
				options.help = true;
				break;
			case "--json":
			case "-j":
				options.json = true;
				break;
			case "--quiet":
			case "-q":
				options.quiet = true;
				break;
			case "--command":
			case "-c":
				options.command = args[++i];
				break;
			case "--interactive":
			case "-i":
			case "start":
				options.interactive = true;
				break;
		}
	}

	if (options.help) {
		printHelp();
		process.exit(0);
	}

	try {
		const configFile = loadConfig(options.configPath);
		const profile = resolveProfile(configFile, options.profile);
		const preferProfile = Boolean(options.profile);
		const watchInterval = parseWatchInterval(options.watch);
		if (watchInterval !== undefined && options.json) {
			throw new Error("--watch cannot be combined with --json.");
		}

		const envConnectionString =
			process.env.MONGODB_CONNECTION_STRING ?? process.env.MONGO_URI;
		const envPort = process.env.MONGO_PORT;
		const connectionString = resolveValue(
			options.uri,
			envConnectionString,
			profile.uri,
			undefined,
			preferProfile,
		);

		const database = resolveValue(
			options.database,
			process.env.MONGO_DB,
			profile.database,
			parseDatabaseFromConnectionString(connectionString ?? "") ?? "test",
			preferProfile,
		);

		const config: DatabaseConfig = {
			uri: connectionString,
			host: resolveValue(
				options.host,
				process.env.MONGO_HOST,
				profile.host,
				"localhost",
				preferProfile,
			),
			port: resolveValue(
				options.port,
				envPort ? Number.parseInt(envPort, 10) : undefined,
				profile.port,
				27017,
				preferProfile,
			),
			database,
			user: resolveValue(
				options.user,
				process.env.MONGO_USER,
				profile.user,
				undefined,
				preferProfile,
			),
			password: resolveValue(
				options.password,
				process.env.MONGO_PASSWORD,
				profile.password,
				undefined,
				preferProfile,
			),
			authSource: resolveValue(
				options.authSource,
				process.env.MONGO_AUTH_DB,
				profile.authSource,
				"admin",
				preferProfile,
			),
		};

		const analyzerOptions: AnalyzerOptions = {
			slowQueryThresholdMs:
				options.slowQueryThreshold ?? configFile.slowQueryThreshold ?? 100,
			minIndexAccesses:
				options.minIndexAccesses ?? configFile.minIndexAccesses ?? 50,
			topQueriesLimit: 50,
			outputDir: options.output ?? configFile.output ?? "./reports",
			collections: parseListOption(options.collections),
			thresholds: configFile.thresholds,
		};

		if (options.interactive) {
			const uri = config.uri ?? buildConnectionUri(config);
			const client = new MongoClient(uri, {
				connectTimeoutMS: config.connectTimeoutMs ?? 10_000,
				socketTimeoutMS: config.socketTimeoutMs ?? 30_000,
				serverSelectionTimeoutMS: config.connectTimeoutMs ?? 10_000,
			});

			try {
				await client.connect();
				const db = client.db(config.database);
				const interactive = new InteractiveCLI(client, db, analyzerOptions);
				await interactive.start();
			} finally {
				await client.close();
			}
			return;
		}

		const log = options.quiet || options.json ? () => {} : console.log;
		analyzerOptions.log = log;

		if (config.uri) {
			const safeUri = config.uri.replace(/:\/\/[^@]+@/, "://***@");
			log(`\nConnecting to MongoDB: ${safeUri}`);
		} else {
			log(
				`\nConnecting to MongoDB at ${config.host}:${config.port}/${config.database}...`,
			);
		}

		const analyzer = await MongoDBAnalyzer.connect(config, analyzerOptions);

		try {
			if (watchInterval !== undefined) {
				await runWatchLoop({
					intervalSeconds: watchInterval,
					command: options.command ?? "full",
					runCommand: () => executeAnalyzerCommand(analyzer, options, log),
				});
				return;
			}

			await executeAnalyzerCommand(analyzer, options, log);
		} finally {
			await analyzer.close();
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.json) {
			console.log(JSON.stringify({ success: false, error: message }));
		} else if (message.startsWith("Mongo")) {
			console.error("Connection failed:", message);
		} else {
			console.error("Error during analysis:", message);
		}
		process.exitCode = 1;
	}
}

async function executeAnalyzerCommand(
	analyzer: MongoDBAnalyzer,
	options: {
		json?: boolean;
		command?: string;
		compare?: string;
		html?: boolean;
	},
	log: (...args: unknown[]) => void,
): Promise<void> {
	if (options.command && options.command !== "full") {
		const result = await runCommand(analyzer, options.command, log);
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const report = await analyzer.analyze();

	if (options.compare) {
		const previous = loadPreviousReport(options.compare);
		DiffReporter.print(
			DiffReporter.diff(report, previous),
			options.json ? console.error : console.log,
		);
	}

	if (options.json) {
		const output = {
			success: true,
			report,
			summary: {
				healthScore: report.healthScore,
				databaseSize: report.metrics.databaseSize,
				cacheHitRatio: report.metrics.cacheHitRatio,
				unusedIndexesCount: report.unusedIndexes.length,
				missingIndexesCount: report.missingIndexes.length,
				duplicateIndexesCount: report.duplicateIndexes.length,
				slowQueriesCount: report.slowQueries.length,
				fragmentedCollectionsCount: report.fragmentedCollections.length,
			},
			recommendations: report.recommendations,
		};
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	analyzer.printSummary(report);

	log("\nGenerating reports...");
	const { markdown, json, html } = await analyzer.generateReport(report, {
		html: options.html,
	});

	log("\nReports generated:");
	log(`  - Markdown: ${markdown}`);
	log(`  - JSON: ${json}`);
	if (html) {
		log(`  - HTML: ${html}`);
	}

	log("\n--- Additional Information ---\n");

	const longRunning = await analyzer.getLongRunningQueries();
	if (longRunning.length > 0) {
		log(`Long running queries: ${longRunning.length}`);
		for (const query of longRunning.slice(0, 3)) {
			log(
				`  - OpId ${query.opId}: ${query.runningTimeFormatted} - ${query.operation} on ${query.namespace}`,
			);
		}
	}

	const blocking = await analyzer.getBlockingOperations();
	if (blocking.length > 0) {
		log(`\nBlocking operations detected: ${blocking.length}`);
		for (const operation of blocking) {
			log(`  - OpId ${operation.blockedOpId} waiting for lock`);
		}
	}

	log("\nAnalysis complete!");
}

function loadPreviousReport(comparePath: string): FullReport {
	if (!existsSync(comparePath)) {
		throw new Error(`Compare report not found: ${comparePath}`);
	}

	try {
		const parsed = JSON.parse(readFileSync(comparePath, "utf-8")) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"report" in parsed &&
			parsed.report
		) {
			return parsed.report as FullReport;
		}

		return parsed as FullReport;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not parse compare report at ${comparePath}: ${message}`,
		);
	}
}

function parseListOption(value?: string): string[] | undefined {
	const entries = value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	return entries && entries.length > 0 ? entries : undefined;
}

function resolveValue<T>(
	cliValue: T | undefined,
	envValue: T | undefined,
	profileValue: T | undefined,
	fallbackValue: T,
	preferProfile: boolean,
): T {
	if (cliValue !== undefined) {
		return cliValue;
	}

	if (preferProfile) {
		return profileValue ?? envValue ?? fallbackValue;
	}

	return envValue ?? profileValue ?? fallbackValue;
}

function parseWatchInterval(watch?: boolean | string): number | undefined {
	if (watch === undefined) {
		return undefined;
	}

	const intervalSeconds =
		watch === true ? 30 : Number.parseInt(String(watch), 10);

	if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
		throw new Error(`Invalid watch interval: ${watch}`);
	}

	return intervalSeconds;
}

async function runCommand(
	analyzer: MongoDBAnalyzer,
	command: string,
	log: (...args: unknown[]) => void = console.log,
): Promise<unknown> {
	switch (command) {
		case "indexes":
		case "unused-indexes":
			return { indexUsageSummary: await analyzer.getIndexUsageSummary() };

		case "missing-indexes": {
			const report = await analyzer.analyze();
			return { missingIndexes: report.missingIndexes };
		}

		case "slow-queries":
			return { slowQueries: await analyzer.getSlowQueries() };

		case "query-stats": {
			const queryStats = await analyzer.getAllQueryStats(5, 50);
			return {
				queryStats,
				summary: {
					totalQueries: queryStats.length,
					totalExecutionTime: queryStats.reduce(
						(acc, q) => acc + q.totalExecutionTime,
						0,
					),
					topByTotalTime: queryStats.slice(0, 10).map((q) => ({
						namespace: q.namespace,
						operation: q.operation,
						count: q.executionCount,
						totalMs: q.totalExecutionTime,
						avgMs: q.avgExecutionTime,
					})),
				},
			};
		}

		case "query-antipatterns":
			return { queryAntiPatterns: await analyzer.getQueryAntiPatterns() };

		case "schema":
			return { schemaAnalysis: await analyzer.getSchemaAnalysis() };

		case "schema-issues":
			return { schemaIssues: await analyzer.getSchemaIssues() };

		case "current-ops":
			return { currentOperations: await analyzer.getCurrentOperations() };

		case "long-running":
			return { longRunningQueries: await analyzer.getLongRunningQueries() };

		case "blocking":
			return { blockingOperations: await analyzer.getBlockingOperations() };

		case "collections":
			return { collections: await analyzer.getCollectionStats() };

		case "largest-collections":
			return { largestCollections: await analyzer.getLargestCollections() };

		case "compact-needed":
			return {
				collectionsNeedingCompact:
					await analyzer.getCollectionsNeedingCompact(),
			};

		case "connections":
			return { connectionStats: await analyzer.getConnectionStats() };

		case "config":
			return {
				configurationSettings: await analyzer.getConfigurationSettings(),
			};

		case "server-info":
			return { serverInfo: await analyzer.getServerInfo() };

		case "replica-set":
			return { replicaSetStatus: await analyzer.getReplicaSetStatus() };

		case "sharding":
			return { shardingStatus: await analyzer.getShardingStatus() };

		case "wiredtiger":
			return { wiredTigerStats: await analyzer.getWiredTigerStats() };

		case "oplog":
			return { oplogStats: await analyzer.getOplogStats() };

		case "health": {
			const healthReport = await analyzer.getHealthSnapshot();
			return {
				healthScore: healthReport.healthScore,
				metrics: healthReport.metrics,
				issues: healthReport.issues,
			};
		}

		case "run-compact":
		case "auto-compact": {
			log("Running compact on collections that need it...\n");
			const summary = await analyzer.autoCompact({
				onProgress: (result, index, total) => {
					const status = result.success ? "OK" : "FAIL";
					log(`  [${index}/${total}] ${status} ${result.collection}`);
				},
			});
			return {
				compactSummary: summary,
				message:
					summary.totalCollections === 0
						? "No collections need compact"
						: `Compacted ${summary.successful}/${summary.totalCollections} collections in ${summary.totalDuration}ms`,
			};
		}

		case "enable-profiler": {
			return await analyzer.enableProfiler(1, 100);
		}

		case "disable-profiler": {
			return await analyzer.disableProfiler();
		}

		case "profiler-status": {
			return await analyzer.checkProfilerEnabled();
		}

		default:
			return await analyzer.analyze();
	}
}

function printHelp() {
	console.log(`
MongoDB Database Analyzer (AI-friendly)
===========================================

Analyzes MongoDB databases to identify:
- Unused indexes that can be removed
- Query patterns that may need indexes
- Duplicate/overlapping indexes
- Slow queries
- Collection fragmentation
- Database health metrics

Usage:
  npx ts-node index.ts [options]

Connection Options:
  --uri <uri>              MongoDB connection URI
                           (env: MONGODB_CONNECTION_STRING or MONGO_URI)
  -h, --host <host>        Database host (env: MONGO_HOST)
  -p, --port <port>        Database port (env: MONGO_PORT)
  -d, --database <name>    Database name (extracted from URI or env: MONGO_DB)
  -U, --user <user>        Database user (env: MONGO_USER)
  -W, --password <pass>    Database password (env: MONGO_PASSWORD)
  --authSource <db>        Authentication database (env: MONGO_AUTH_DB)
  --profile <name>         Use named profile from .analyzerrc.json
  --config <path>          Use a custom config file path

Environment Variables (in priority order):
  MONGODB_CONNECTION_STRING  Full connection string (recommended)
                             Example: mongodb+srv://user:pass@host/db?options
  MONGO_URI                  Legacy URI format
  MONGO_DB                   Database name (if not in URI)

Analysis Options:
  --slow-query-threshold <ms>  Slow query threshold in ms (default: 100)
  --min-index-accesses <n>     Min accesses to consider index "used" (default: 50)
  --collections <list>         Comma-separated collections to analyze
  --compare <path>             Compare against a previous JSON report
  --watch [seconds]            Watch mode (default interval: 30s)

Output Options:
  -o, --output <dir>       Output directory for reports (default: ./reports)
  -j, --json               Output JSON to stdout (for AI/programmatic use)
  --html                   Also generate an HTML report
  -q, --quiet              Suppress non-essential output
  -i, --interactive        Interactive mode with menu
  start                    Alias for --interactive

AI/Programmatic Commands:
  -c, --command <cmd>      Run specific analysis command

Available Commands:
  full                Full analysis (default)
  health              Health score and metrics only
  indexes             Index usage summary
  unused-indexes      Unused indexes
  missing-indexes     Query patterns needing indexes
  slow-queries        Query statistics from profiler (alias: query-stats)
  query-antipatterns  Detect query anti-patterns
  current-ops         Currently running operations
  long-running        Long-running queries
  blocking            Blocking operations
  collections         Largest collections
  compact-needed      Collections needing compact
  run-compact         Run compact on collections that need it (auto-compact)
  connections         Connection statistics
  config              Configuration settings
  server-info         Server information
  replica-set         Replica set status
  sharding            Sharding status
  wiredtiger          WiredTiger cache statistics
  oplog               Oplog statistics
  schema              Schema analysis for all collections
  schema-issues       Schema issues and inconsistencies
  enable-profiler     Enable MongoDB profiler
  disable-profiler    Disable MongoDB profiler
  profiler-status     Check profiler status

Note: slow-queries requires the MongoDB profiler to be enabled.
      Use enable-profiler command or db.setProfilingLevel(1) to enable it.

Examples:

  # Full analysis with human-readable output
  pnpm analyze

  # Full analysis with JSON output (for AI)
  npx ts-node index.ts --json

  # Specific command with JSON (for AI)
  npx ts-node index.ts -j -c health
  npx ts-node index.ts -j -c unused-indexes
  npx ts-node index.ts -j -c slow-queries

  # Interactive mode
  npx ts-node index.ts start

  # Enable profiler
  npx ts-node index.ts -c enable-profiler

  # Generate HTML output
  npx ts-node index.ts --html -c full

  # Compare with a previous JSON snapshot
  npx ts-node index.ts --compare ./reports/mongodb-analysis-previous.json

  # Watch health output
  npx ts-node index.ts -c health --watch 10

AI Integration:
  Use --json flag for structured output that AI can parse.
  Use --command for specific analyses to reduce output size.
  Output is always valid JSON when --json is specified.
`);
}

// Export for programmatic use
export { MongoDBAnalyzer };
export type { AnalysisReport, AnalyzerOptions, DatabaseConfig };

// Run only if called directly (not when imported as a module)
if (require.main === module) {
	main().catch(console.error);
}
