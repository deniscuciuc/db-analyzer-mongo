import { existsSync, readFileSync } from "node:fs";
import type { Db, MongoClient } from "mongodb";

import { CollectionAnalyzer } from "../analyzers/collection-analyzer";
import { IndexAnalyzer } from "../analyzers/index-analyzer";
import { QueryAnalyzer } from "../analyzers/query-analyzer";
import { SchemaAnalyzer } from "../analyzers/schema-analyzer";
import { StatsCollector } from "../collectors/stats-collector";
import { DiffReporter } from "../reporters/diff-reporter";
import { ReportGenerator } from "../reporters/report-generator";
import type { AnalysisReport, AnalyzerOptions, FullReport } from "../types";
import { calculateHealthScore } from "../utils/health";
import type { ParsedOptions } from "./options";
import { toAnalyzerOptions } from "./options";

interface AnalyzerServices {
	indexes: IndexAnalyzer;
	queries: QueryAnalyzer;
	schema: SchemaAnalyzer;
	collections: CollectionAnalyzer;
	stats: StatsCollector;
	reporter: ReportGenerator;
}

function createServices(
	client: MongoClient,
	db: Db,
	options: AnalyzerOptions,
): AnalyzerServices {
	return {
		indexes: new IndexAnalyzer(db, options),
		queries: new QueryAnalyzer(db, options),
		schema: new SchemaAnalyzer(db, options),
		collections: new CollectionAnalyzer(db, options),
		stats: new StatsCollector(client, db, options),
		reporter: new ReportGenerator(options.outputDir ?? "./reports", options),
	};
}

export async function buildFullReport(
	client: MongoClient,
	db: Db,
	options: AnalyzerOptions,
): Promise<AnalysisReport> {
	const services = createServices(client, db, options);

	const metrics = await services.stats.getDatabaseMetrics();
	const [unusedIndexes, missingIndexes, duplicateIndexes, ttlIndexes] =
		await Promise.all([
			services.indexes.getUnusedIndexes(),
			services.indexes.getMissingIndexes(),
			services.indexes.getDuplicateIndexes(),
			services.stats.getTTLIndexes(),
		]);
	const [
		collectionStats,
		fragmentedCollections,
		slowQueries,
		queryAntiPatterns,
	] = await Promise.all([
		services.collections.getCollectionStats(),
		services.collections.getFragmentedCollections(),
		services.queries.getSlowQueries(),
		services.queries.detectQueryAntiPatterns(),
	]);
	const schemaIssues = await services.schema.findSchemaIssues(
		options.schemaSampleSize,
	);
	const [wiredTigerStats, replicaSetStatus, connectionStats] =
		await Promise.all([
			services.stats.getWiredTigerStats(),
			services.stats.getReplicaSetStatus(),
			services.stats.getConnectionStats(),
		]);

	const largestCollections = [...collectionStats]
		.sort((left, right) => right.documentCount - left.documentCount)
		.slice(0, 3);
	const documentSizeDistribution = (
		await Promise.all(
			largestCollections.map((collection) =>
				services.stats.getDocumentSizeDistribution(collection.collection, 500),
			),
		)
	).filter((distribution) => distribution !== null);

	const recommendations = [
		...services.indexes.generateRecommendations(
			unusedIndexes,
			missingIndexes,
			duplicateIndexes,
		),
		...services.stats.generateMetricsReport(metrics).recommendations,
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
			(member) =>
				member.replicationLagSeconds !== undefined &&
				member.replicationLagSeconds > 10,
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
		options.thresholds,
	);

	const errors = [
		...services.indexes.getErrors(),
		...services.queries.getErrors(),
		...services.collections.getErrors(),
		...services.stats.getErrors(),
		...services.schema.getErrors(),
	];
	const errorDetails =
		errors.length > 0 ? errors.map((error) => error.toJSON()) : undefined;

	return {
		generatedAt: new Date(),
		databaseName: db.databaseName,
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
}

export async function buildHealthSnapshot(
	client: MongoClient,
	db: Db,
	options: AnalyzerOptions,
): Promise<{
	healthScore: number;
	metrics: AnalysisReport["metrics"];
	issues: string[];
	recommendations: string[];
}> {
	const services = createServices(client, db, options);
	const [metrics, unusedIndexes, missingIndexes, slowQueries, fragmented] =
		await Promise.all([
			services.stats.getDatabaseMetrics(),
			services.indexes.getUnusedIndexes(),
			services.indexes.getMissingIndexes(),
			services.queries.getSlowQueries(),
			services.collections.getFragmentedCollections(),
		]);

	const health = calculateHealthScore(
		{
			metrics,
			unusedIndexesCount: unusedIndexes.length,
			missingIndexesCount: missingIndexes.length,
			slowQueriesCount: slowQueries.length,
			fragmentedCollectionsCount: fragmented.length,
		},
		options.thresholds,
	);

	return {
		healthScore: health.score,
		metrics,
		issues: health.issues,
		recommendations: health.issues,
	};
}

export async function executeCommand(
	client: MongoClient,
	db: Db,
	options: ParsedOptions,
): Promise<void> {
	const log = options.quiet || options.json ? () => {} : console.log;
	const analyzerOptions = toAnalyzerOptions(options);
	const services = createServices(client, db, analyzerOptions);

	if (options.command !== "full") {
		const result = await runCommand(client, db, services, options, log);
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const report = await buildFullReport(client, db, analyzerOptions);

	if (options.compare) {
		const previous = loadPreviousReport(options.compare);
		DiffReporter.print(
			DiffReporter.diff(report, previous),
			options.json ? console.error : console.log,
		);
	}

	if (options.json) {
		console.log(
			JSON.stringify(
				{
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
				},
				null,
				2,
			),
		);
		return;
	}

	services.reporter.printSummary(report);

	log("\nGenerating reports...");
	const [markdown, json, html] = await Promise.all([
		services.reporter.generateFullReport(report),
		services.reporter.generateJsonReport(report),
		options.html ? services.reporter.generateHtmlReport(report) : undefined,
	]);

	log("\nReports generated:");
	log(`  - Markdown: ${markdown}`);
	log(`  - JSON: ${json}`);
	if (html) {
		log(`  - HTML: ${html}`);
	}

	log("\n--- Additional Information ---\n");

	const longRunning = await services.queries.getLongRunningQueries();
	if (longRunning.length > 0) {
		log(`Long running queries: ${longRunning.length}`);
		for (const query of longRunning.slice(0, 3)) {
			log(
				`  - OpId ${query.opId}: ${query.runningTimeFormatted} - ${query.operation} on ${query.namespace}`,
			);
		}
	}

	const blocking = await services.queries.getBlockingOperations();
	if (blocking.length > 0) {
		log(`\nBlocking operations detected: ${blocking.length}`);
		for (const operation of blocking) {
			log(`  - OpId ${operation.blockedOpId} waiting for lock`);
		}
	}

	log("\nAnalysis complete!");
}

async function runCommand(
	client: MongoClient,
	db: Db,
	services: AnalyzerServices,
	options: ParsedOptions,
	log: (...args: unknown[]) => void,
): Promise<unknown> {
	const analyzerOptions = toAnalyzerOptions(options);

	switch (options.command) {
		case "unused-indexes":
			return {
				indexUsageSummary: await services.indexes.getIndexUsageSummary(),
			};
		case "missing-indexes": {
			const report = await buildFullReport(client, db, analyzerOptions);
			return { missingIndexes: report.missingIndexes };
		}
		case "slow-queries":
			return { slowQueries: await services.queries.getSlowQueries() };
		case "query-stats": {
			const queryStats = await services.queries.getAllQueryStats(5, 50);
			return {
				queryStats,
				summary: {
					totalQueries: queryStats.length,
					totalExecutionTime: queryStats.reduce(
						(accumulator, query) => accumulator + query.totalExecutionTime,
						0,
					),
					topByTotalTime: queryStats.slice(0, 10).map((query) => ({
						namespace: query.namespace,
						operation: query.operation,
						count: query.executionCount,
						totalMs: query.totalExecutionTime,
						avgMs: query.avgExecutionTime,
					})),
				},
			};
		}
		case "query-antipatterns":
			return {
				queryAntiPatterns: await services.queries.detectQueryAntiPatterns(),
			};
		case "schema":
			return {
				schemaAnalysis: await services.schema.analyzeAllSchemas(
					analyzerOptions.schemaSampleSize,
				),
			};
		case "schema-issues":
			return {
				schemaIssues: await services.schema.findSchemaIssues(
					analyzerOptions.schemaSampleSize,
				),
			};
		case "current-ops":
			return {
				currentOperations: await services.queries.getCurrentOperations(),
			};
		case "long-running":
			return {
				longRunningQueries: await services.queries.getLongRunningQueries(),
			};
		case "blocking":
			return {
				blockingOperations: await services.queries.getBlockingOperations(),
			};
		case "collections":
			return { collections: await services.collections.getCollectionStats() };
		case "largest-collections":
			return {
				largestCollections: await services.collections.getLargestCollections(),
			};
		case "compact-needed":
			return {
				collectionsNeedingCompact:
					await services.collections.getCollectionsNeedingCompact(),
			};
		case "connections":
			return { connectionStats: await services.stats.getConnectionStats() };
		case "config":
			return {
				configurationSettings: await services.stats.getConfigurationSettings(),
			};
		case "server-info":
			return { serverInfo: await services.stats.getServerInfo() };
		case "replica-set":
			return { replicaSetStatus: await services.stats.getReplicaSetStatus() };
		case "sharding":
			return { shardingStatus: await services.stats.getShardingStatus() };
		case "wiredtiger":
			return { wiredTigerStats: await services.stats.getWiredTigerStats() };
		case "oplog":
			return { oplogStats: await services.stats.getOplogStats() };
		case "health":
			return buildHealthSnapshot(client, db, analyzerOptions);
		case "run-compact":
		case "auto-compact": {
			log("Running compact on collections that need it...\n");
			const summary = await services.collections.autoCompact({
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
		case "enable-profiler":
			return services.queries.enableProfiler(1, 100);
		case "disable-profiler":
			return services.queries.disableProfiler();
		case "profiler-status":
			return services.queries.checkProfilerEnabled();
		default:
			return buildFullReport(client, db, analyzerOptions);
	}
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
