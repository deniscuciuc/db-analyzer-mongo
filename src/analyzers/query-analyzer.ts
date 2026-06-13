import type { Db } from "mongodb";

import {
	getQueryTimeSeverity,
	getThresholds,
	THRESHOLDS,
} from "../config/thresholds";
import type {
	AnalyzerOptions,
	BlockingOperation,
	CurrentOperation,
	QueryAntiPattern,
	QueryOperation,
	QueryStats,
	SlowQuery,
} from "../types";
import {
	buildNamespaceFilter,
	getCollectionNameFromNamespace,
} from "../utils/collection-filters";
import { ErrorCollector } from "../utils/errors";
import { formatDuration } from "../utils/formatting";

/**
 * Supported query operations for analysis
 */
const QUERY_OPERATIONS: QueryOperation[] = [
	"query",
	"find",
	"update",
	"delete",
	"insert",
	"aggregate",
	"findAndModify",
	"bulkWrite",
	"mapReduce",
	"count",
	"distinct",
];

export class QueryAnalyzer {
	private errorCollector = new ErrorCollector();

	constructor(
		private db: Db,
		private options: AnalyzerOptions = {},
	) {}

	async checkProfilerEnabled(): Promise<{ level: number; slowMs: number }> {
		const thresholds = getThresholds(this.options.thresholds);
		try {
			const result = await this.db.command({ profile: -1 });
			return {
				level: result.was ?? 0,
				slowMs: result.slowms ?? thresholds.queries.slowMs,
			};
		} catch {
			return { level: 0, slowMs: thresholds.queries.slowMs };
		}
	}

	async getSlowQueries(): Promise<SlowQuery[]> {
		const profilerStatus = await this.checkProfilerEnabled();

		if (profilerStatus.level === 0) {
			if (this.options.verbose) {
				console.warn(
					"MongoDB profiler is not enabled. Slow query analysis unavailable.",
				);
				console.warn("To enable: db.setProfilingLevel(1, { slowms: 100 })");
			}
			return [];
		}

		const thresholdMs =
			this.options.slowQueryThresholdMs ??
			getThresholds(this.options.thresholds).queries.slowMs;
		const limit = this.options.topQueriesLimit ?? 50;
		const thresholds = getThresholds(this.options.thresholds);

		try {
			const slowQueries = await this.db
				.collection("system.profile")
				.find({
					millis: { $gte: thresholdMs },
					op: { $in: QUERY_OPERATIONS },
					...buildNamespaceFilter(
						this.db.databaseName,
						this.options.collections,
					),
				})
				.sort({ millis: -1 })
				.limit(limit)
				.toArray();

			const queryMap = new Map<
				string,
				{
					queries: any[];
					totalTime: number;
					count: number;
				}
			>();

			for (const q of slowQueries) {
				const hash = this.getQueryHash(q);
				const existing = queryMap.get(hash);
				if (existing) {
					existing.queries.push(q);
					existing.totalTime += q.millis ?? 0;
					existing.count++;
				} else {
					queryMap.set(hash, {
						queries: [q],
						totalTime: q.millis ?? 0,
						count: 1,
					});
				}
			}

			const aggregatedQueries: SlowQuery[] = [];

			for (const [hash, data] of queryMap) {
				const sample = data.queries[0];
				const times = data.queries.map((q) => q.millis ?? 0);
				const avgTime = data.totalTime / data.count;

				aggregatedQueries.push({
					queryHash: hash,
					queryShape: this.getQueryShape(sample),
					namespace: sample.ns ?? "",
					operation: this.normalizeOperation(sample.op),
					executionCount: data.count,
					totalExecutionTime: data.totalTime,
					avgExecutionTime: Math.round(avgTime),
					minExecutionTime: Math.min(...times),
					maxExecutionTime: Math.max(...times),
					docsExamined: sample.docsExamined ?? 0,
					docsReturned:
						sample.nreturned ?? sample.nMatched ?? sample.nModified ?? 0,
					keysExamined: sample.keysExamined ?? 0,
					planSummary: sample.planSummary ?? "N/A",
					recommendations: this.generateQueryRecommendations(sample, data),
					severity: getQueryTimeSeverity(avgTime, thresholds),
				});
			}

			return aggregatedQueries.sort(
				(a, b) => b.totalExecutionTime - a.totalExecutionTime,
			);
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getSlowQueries",
			});
			return [];
		}
	}

	async getAllQueryStats(minCount = 5, limit = 50): Promise<QueryStats[]> {
		const profilerStatus = await this.checkProfilerEnabled();

		if (profilerStatus.level === 0) {
			if (this.options.verbose) {
				console.warn("MongoDB profiler is not enabled.");
				console.warn("To enable: db.setProfilingLevel(1)");
			}
			return [];
		}

		try {
			const queries = await this.db
				.collection("system.profile")
				.find({
					op: { $in: QUERY_OPERATIONS },
					...buildNamespaceFilter(
						this.db.databaseName,
						this.options.collections,
					),
				})
				.sort({ ts: -1 })
				.limit(1000)
				.toArray();

			const queryMap = new Map<
				string,
				{
					queries: any[];
					totalTime: number;
				}
			>();

			for (const q of queries) {
				const hash = this.getQueryHash(q);
				const existing = queryMap.get(hash);
				if (existing) {
					existing.queries.push(q);
					existing.totalTime += q.millis ?? 0;
				} else {
					queryMap.set(hash, {
						queries: [q],
						totalTime: q.millis ?? 0,
					});
				}
			}

			const stats: QueryStats[] = [];

			for (const [hash, data] of queryMap) {
				if (data.queries.length < minCount) continue;

				const sample = data.queries[0];
				const times = data.queries.map((q) => q.millis ?? 0);

				stats.push({
					queryHash: hash,
					queryShape: this.getQueryShape(sample),
					namespace: sample.ns ?? "",
					operation: this.normalizeOperation(sample.op),
					executionCount: data.queries.length,
					totalExecutionTime: data.totalTime,
					avgExecutionTime: Math.round(data.totalTime / data.queries.length),
					minExecutionTime: Math.min(...times),
					maxExecutionTime: Math.max(...times),
					docsExamined: sample.docsExamined ?? 0,
					docsReturned:
						sample.nreturned ?? sample.nMatched ?? sample.nModified ?? 0,
					keysExamined: sample.keysExamined ?? 0,
					planSummary: sample.planSummary ?? "N/A",
				});
			}

			return stats
				.sort((a, b) => b.totalExecutionTime - a.totalExecutionTime)
				.slice(0, limit);
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getAllQueryStats",
			});
			return [];
		}
	}

	async getCurrentOperations(): Promise<CurrentOperation[]> {
		try {
			const result = await this.db.admin().command({ currentOp: 1 });
			const ops = result.inprog ?? [];

			return ops
				.filter(
					(op: any) =>
						op.op && op.op !== "none" && this.isSelectedNamespace(op.ns ?? ""),
				)
				.map((op: any) => {
					const runningTime = op.microsecs_running
						? Math.round(op.microsecs_running / 1000)
						: 0;
					return {
						opId: op.opid,
						operation: op.op,
						namespace: op.ns ?? "",
						runningTime,
						runningTimeFormatted: formatDuration(runningTime),
						query: op.command ?? op.query ?? {},
						client: op.client ?? "",
						waitingForLock: op.waitingForLock ?? false,
						lockType: op.lockType,
					};
				})
				.sort(
					(a: CurrentOperation, b: CurrentOperation) =>
						b.runningTime - a.runningTime,
				);
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getCurrentOperations",
			});
			return [];
		}
	}

	async getLongRunningQueries(
		thresholdMs = THRESHOLDS.operations.longRunningMs,
	): Promise<CurrentOperation[]> {
		const ops = await this.getCurrentOperations();
		return ops.filter((op) => op.runningTime > thresholdMs);
	}

	async getBlockingOperations(): Promise<BlockingOperation[]> {
		try {
			const result = await this.db.admin().command({ currentOp: 1 });
			const ops = result.inprog ?? [];

			const blocking = ops
				.filter(
					(op: any) =>
						op.waitingForLock === true && this.isSelectedNamespace(op.ns ?? ""),
				)
				.map((op: any) => {
					const waitingTime = op.microsecs_running
						? Math.round(op.microsecs_running / 1000)
						: 0;
					return {
						blockedOpId: op.opid,
						blockingOpId: op.lockStats?.waitingForLock?.opid ?? null,
						blockedNamespace: op.ns ?? "",
						blockedOperation: op.op ?? "unknown",
						waitingTime,
						waitingTimeFormatted: formatDuration(waitingTime),
					};
				});

			return blocking;
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getBlockingOperations",
			});
			return [];
		}
	}

	async enableProfiler(
		level: number = 1,
		slowMs: number = THRESHOLDS.queries.slowMs,
	): Promise<{ success: boolean; message: string }> {
		try {
			await this.db.command({
				profile: level,
				slowms: slowMs,
			});

			const status = await this.checkProfilerEnabled();
			if (status.level === level) {
				return {
					success: true,
					message: `Profiler enabled at level ${level} with slowms=${slowMs}`,
				};
			}
			return {
				success: false,
				message: `Profiler command succeeded but level is ${status.level} instead of ${level}`,
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to enable profiler: ${error}`,
			};
		}
	}

	async disableProfiler(): Promise<{ success: boolean; message: string }> {
		try {
			await this.db.command({ profile: 0 });

			const status = await this.checkProfilerEnabled();
			if (status.level === 0) {
				return {
					success: true,
					message: "Profiler disabled",
				};
			}
			return {
				success: false,
				message: `Profiler command succeeded but level is still ${status.level}`,
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to disable profiler: ${error}`,
			};
		}
	}

	/**
	 * Analyze query patterns and detect anti-patterns
	 */
	async detectQueryAntiPatterns(): Promise<QueryAntiPattern[]> {
		const antiPatterns: QueryAntiPattern[] = [];

		try {
			const profilerData = await this.db
				.collection("system.profile")
				.find({
					op: { $in: QUERY_OPERATIONS },
					...buildNamespaceFilter(
						this.db.databaseName,
						this.options.collections,
					),
				})
				.sort({ ts: -1 })
				.limit(500)
				.toArray();

			const whereQueries = profilerData.filter((q) => {
				const query = q.command?.filter ?? q.query ?? {};
				return JSON.stringify(query).includes("$where");
			});

			if (whereQueries.length > 0) {
				antiPatterns.push({
					pattern: "$where operator",
					description:
						"Using $where executes JavaScript and cannot use indexes",
					severity: "critical",
					count: whereQueries.length,
					recommendation: "Replace $where with native MongoDB operators",
				});
			}

			const regexQueries = profilerData.filter((q) => {
				const queryStr = JSON.stringify(q.command?.filter ?? q.query ?? {});
				return queryStr.includes("$regex") && !queryStr.includes("^");
			});

			if (regexQueries.length > 0) {
				antiPatterns.push({
					pattern: "Unanchored $regex",
					description: "Regex without ^ anchor cannot use index efficiently",
					severity: "high",
					count: regexQueries.length,
					recommendation: "Add ^ anchor to regex patterns when possible",
				});
			}

			const negationQueries = profilerData.filter((q) => {
				const queryStr = JSON.stringify(q.command?.filter ?? q.query ?? {});
				return (
					queryStr.includes("$ne") ||
					queryStr.includes("$nin") ||
					queryStr.includes("$not")
				);
			});

			if (negationQueries.length > 5) {
				antiPatterns.push({
					pattern: "Negation operators ($ne, $nin, $not)",
					description:
						"Negation operators often cannot use indexes efficiently",
					severity: "medium",
					count: negationQueries.length,
					recommendation: "Consider restructuring queries to avoid negation",
				});
			}

			const noProjectionQueries = profilerData.filter((q) => {
				const projection = q.command?.projection;
				return !projection || Object.keys(projection).length === 0;
			});

			if (noProjectionQueries.length > 10) {
				antiPatterns.push({
					pattern: "No projection specified",
					description: "Returning all fields when only some are needed",
					severity: "low",
					count: noProjectionQueries.length,
					recommendation: "Add projection to return only required fields",
				});
			}
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "detectQueryAntiPatterns",
			});
		}

		return antiPatterns.sort(
			(a, b) =>
				["critical", "high", "medium", "low"].indexOf(a.severity) -
				["critical", "high", "medium", "low"].indexOf(b.severity),
		);
	}

	/**
	 * Get errors collected during analysis
	 */
	getErrors() {
		return this.errorCollector.getErrors();
	}

	private normalizeOperation(op: string): QueryOperation {
		if (QUERY_OPERATIONS.includes(op as QueryOperation)) {
			return op as QueryOperation;
		}
		return "unknown";
	}

	private getQueryHash(query: any): string {
		const shape = {
			op: query.op,
			ns: query.ns,
			command: this.normalizeCommand(query.command ?? query.query ?? {}),
		};
		return JSON.stringify(shape);
	}

	private getQueryShape(query: any): string {
		const command = query.command ?? query.query ?? {};
		const normalized = this.normalizeCommand(command);
		return JSON.stringify(normalized).substring(0, 200);
	}

	private normalizeCommand(
		command: Record<string, any>,
		depth = 0,
	): Record<string, any> {
		if (depth > 10) return { "...": "too deep" };

		const normalized: Record<string, any> = {};
		for (const [key, value] of Object.entries(command)) {
			if (key === "lsid" || key === "$clusterTime" || key === "$db") continue;
			if (typeof value === "object" && value !== null) {
				if (Array.isArray(value)) {
					normalized[key] = "[...]";
				} else {
					normalized[key] = this.normalizeCommand(value, depth + 1);
				}
			} else {
				normalized[key] = "<value>";
			}
		}
		return normalized;
	}

	private generateQueryRecommendations(
		query: any,
		data: { queries: any[]; totalTime: number; count: number },
	): string[] {
		const thresholds = getThresholds(this.options.thresholds);
		const recommendations: string[] = [];
		const planSummary = query.planSummary ?? "";
		const docsExamined = query.docsExamined ?? 0;
		const docsReturned = query.nreturned ?? 0;
		const keysExamined = query.keysExamined ?? 0;
		const avgTime = data.totalTime / data.count;

		if (planSummary.includes("COLLSCAN")) {
			recommendations.push(
				"Query performs a collection scan (COLLSCAN). Consider adding an index on the queried fields.",
			);
		}

		if (
			docsReturned > 0 &&
			docsExamined / docsReturned > thresholds.queries.inefficientDocsRatio
		) {
			recommendations.push(
				`High examination ratio: ${docsExamined} docs examined for ${docsReturned} returned. Index may not be optimal.`,
			);
		}

		if (
			keysExamined === 0 &&
			docsExamined > thresholds.queries.minDocsExaminedForFlag
		) {
			recommendations.push(
				"No index keys examined. Query is likely performing a full collection scan.",
			);
		}

		if (avgTime > thresholds.queries.verySlowMs) {
			recommendations.push(
				"Query takes over 1 second on average. Review query structure and indexes.",
			);
		}

		if (
			data.count > thresholds.queries.highFrequencyCount &&
			avgTime > thresholds.queries.slowMs
		) {
			recommendations.push(
				`Query executed ${data.count} times with avg ${Math.round(avgTime)}ms. High-impact optimization candidate.`,
			);
		}

		return recommendations;
	}

	private isSelectedNamespace(namespace: string): boolean {
		if (
			!namespace ||
			!this.options.collections ||
			this.options.collections.length === 0
		) {
			return true;
		}

		const collectionName = getCollectionNameFromNamespace(
			namespace,
			this.db.databaseName,
		);
		return this.options.collections.includes(collectionName);
	}

	generateQueryReport(slowQueries: SlowQuery[]): {
		totalSlowQueries: number;
		totalExecutionTime: number;
		averageExecutionTime: number;
		queriesWithCollScan: number;
		criticalQueries: number;
		topTimeConsumers: SlowQuery[];
		topByCount: SlowQuery[];
	} {
		const totalExecutionTime = slowQueries.reduce(
			(acc, q) => acc + q.totalExecutionTime,
			0,
		);
		const averageExecutionTime =
			slowQueries.length > 0 ? totalExecutionTime / slowQueries.length : 0;
		const queriesWithCollScan = slowQueries.filter((q) =>
			q.planSummary.includes("COLLSCAN"),
		).length;
		const criticalQueries = slowQueries.filter(
			(q) => q.severity === "critical",
		).length;

		return {
			totalSlowQueries: slowQueries.length,
			totalExecutionTime,
			averageExecutionTime,
			queriesWithCollScan,
			criticalQueries,
			topTimeConsumers: [...slowQueries]
				.sort((a, b) => b.totalExecutionTime - a.totalExecutionTime)
				.slice(0, 10),
			topByCount: [...slowQueries]
				.sort((a, b) => b.executionCount - a.executionCount)
				.slice(0, 10),
		};
	}
}
