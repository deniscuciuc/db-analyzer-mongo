import type { Db } from "mongodb";

import { calculateBenefitLevel, THRESHOLDS } from "../config/thresholds";
import type {
	AnalyzerOptions,
	DuplicateIndex,
	IndexInfo,
	IndexUsageSummary,
	MissingIndex,
	UnusedIndex,
} from "../types";
import { ErrorCollector } from "../utils/errors";
import { formatBytes, formatKeyPattern } from "../utils/formatting";

export class IndexAnalyzer {
	private errorCollector = new ErrorCollector();

	constructor(
		private db: Db,
		private options: AnalyzerOptions = {},
	) {}

	async getAllIndexes(): Promise<IndexInfo[]> {
		const collections = await this.getCollections();
		const allIndexes: IndexInfo[] = [];

		for (const collName of collections) {
			try {
				const coll = this.db.collection(collName);
				const indexes = await coll.indexes();
				const stats = await this.db
					.command({ collStats: collName })
					.catch(() => null);

				for (const idx of indexes) {
					if (idx.name === "_id_") continue;

					const indexName = idx.name ?? "unknown";
					const indexSize = stats?.indexSizes?.[indexName] ?? 0;

					allIndexes.push({
						namespace: `${this.db.databaseName}.${collName}`,
						collection: collName,
						name: indexName,
						key: idx.key as Record<string, number | string>,
						keyPattern: formatKeyPattern(idx.key),
						size: formatBytes(indexSize),
						sizeBytes: indexSize,
						isUnique: idx.unique ?? false,
						isSparse: idx.sparse ?? false,
						isTTL: idx.expireAfterSeconds !== undefined,
						isPartial: idx.partialFilterExpression !== undefined,
						isHidden: idx.hidden ?? false,
						expireAfterSeconds: idx.expireAfterSeconds,
						partialFilterExpression: idx.partialFilterExpression,
					});
				}
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "getAllIndexes",
				});
				if (this.options.verbose) {
					console.warn(`Could not get indexes for ${collName}:`, error);
				}
			}
		}

		return allIndexes.sort((a, b) => b.sizeBytes - a.sizeBytes);
	}

	async getUnusedIndexes(): Promise<UnusedIndex[]> {
		const minAccesses =
			this.options.minIndexAccesses ?? THRESHOLDS.indexes.minAccessesForUsed;
		const unusedIndexes: UnusedIndex[] = [];

		const collections = await this.getCollections();

		for (const collName of collections) {
			try {
				const coll = this.db.collection(collName);

				const indexes = await coll.indexes();
				const indexMetadata = new Map<string, any>();
				for (const idx of indexes) {
					if (idx.name) {
						indexMetadata.set(idx.name, idx);
					}
				}

				const indexStats = await coll
					.aggregate([{ $indexStats: {} }])
					.toArray();

				const stats = await this.db
					.command({ collStats: collName })
					.catch(() => null);

				for (const stat of indexStats) {
					if (stat.name === "_id_") continue;

					const accesses = stat.accesses?.ops ?? 0;
					const since = stat.accesses?.since ?? null;

					if (accesses < minAccesses) {
						const indexSize = stats?.indexSizes?.[stat.name] ?? 0;
						const metadata = indexMetadata.get(stat.name) ?? {};

						const potentialReason = this.getPotentialKeepReason(
							metadata,
							accesses,
						);

						const usageStatus: UnusedIndex["usageStatus"] =
							accesses === 0
								? "Never used"
								: accesses < 10
									? "Rarely used"
									: "Low usage";

						unusedIndexes.push({
							namespace: `${this.db.databaseName}.${collName}`,
							collection: collName,
							name: stat.name,
							key: stat.key ?? {},
							keyPattern: formatKeyPattern(stat.key ?? {}),
							size: formatBytes(indexSize),
							sizeBytes: indexSize,
							isUnique: metadata.unique ?? false,
							isSparse: metadata.sparse ?? false,
							isTTL: metadata.expireAfterSeconds !== undefined,
							isPartial: metadata.partialFilterExpression !== undefined,
							isHidden: metadata.hidden ?? false,
							expireAfterSeconds: metadata.expireAfterSeconds,
							accesses,
							since,
							usageStatus,
							potentialReason,
						});
					}
				}
			} catch (error) {
				// $indexStats may not be available on all MongoDB versions/configurations
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "getUnusedIndexes",
				});
			}
		}

		return unusedIndexes.sort((a, b) => b.sizeBytes - a.sizeBytes);
	}

	async getMissingIndexes(): Promise<MissingIndex[]> {
		const missingIndexes: MissingIndex[] = [];

		try {
			const profilerData = await this.db
				.collection("system.profile")
				.find({
					op: { $in: ["query", "find"] },
					millis: {
						$gt: this.options.slowQueryThresholdMs ?? THRESHOLDS.queries.slowMs,
					},
					planSummary: { $regex: /COLLSCAN/ },
				})
				.sort({ millis: -1 })
				.limit(100)
				.toArray();

			const queryPatterns = new Map<
				string,
				{
					collection: string;
					pattern: Record<string, unknown>;
					count: number;
					totalTime: number;
				}
			>();

			for (const entry of profilerData) {
				const ns = entry.ns as string;
				const collection = ns.split(".").slice(1).join(".");
				const query = entry.command?.filter ?? entry.query ?? {};
				const patternKey = `${collection}:${this.normalizeQueryPattern(query)}`;

				const existing = queryPatterns.get(patternKey);
				if (existing) {
					existing.count++;
					existing.totalTime += entry.millis ?? 0;
				} else {
					queryPatterns.set(patternKey, {
						collection,
						pattern: query,
						count: 1,
						totalTime: entry.millis ?? 0,
					});
				}
			}

			for (const [_key, data] of queryPatterns) {
				const avgTime = data.totalTime / data.count;
				const suggestedFields = Object.keys(data.pattern).filter(
					(k) => !k.startsWith("$"),
				);

				if (suggestedFields.length > 0) {
					missingIndexes.push({
						collection: data.collection,
						queryPattern: this.normalizeQueryPattern(data.pattern),
						frequency: data.count,
						avgExecutionTime: Math.round(avgTime),
						suggestedIndex: `db.${data.collection}.createIndex({ ${suggestedFields.map((k) => `"${k}": 1`).join(", ")} })`,
						estimatedBenefit: calculateBenefitLevel(data.count, avgTime),
						suggestedFields,
					});
				}
			}
		} catch (error) {
			// Profiler may not be enabled
			this.errorCollector.addFromUnknown(error, {
				operation: "getMissingIndexes",
			});
		}

		return missingIndexes.sort(
			(a, b) =>
				b.frequency * b.avgExecutionTime - a.frequency * a.avgExecutionTime,
		);
	}

	async getDuplicateIndexes(): Promise<DuplicateIndex[]> {
		const duplicates: DuplicateIndex[] = [];
		const collections = await this.getCollections();

		for (const collName of collections) {
			try {
				const indexes = await this.db.collection(collName).indexes();
				const indexList = indexes.filter((idx) => idx.name !== "_id_");

				for (let i = 0; i < indexList.length; i++) {
					for (let j = i + 1; j < indexList.length; j++) {
						const idx1 = indexList[i];
						const idx2 = indexList[j];

						const keys1 = Object.keys(idx1.key);
						const keys2 = Object.keys(idx2.key);

						const pattern1 = formatKeyPattern(idx1.key);
						const pattern2 = formatKeyPattern(idx2.key);

						if (pattern1 === pattern2) {
							duplicates.push({
								collection: collName,
								index1: idx1.name ?? "unknown",
								index2: idx2.name ?? "unknown",
								keys1: pattern1,
								keys2: pattern2,
								recommendation: "Exact duplicate - remove one",
								duplicateType: "exact",
							});
						} else if (
							keys2.every((k, idx) => keys1[idx] === k) &&
							keys1.length > keys2.length
						) {
							duplicates.push({
								collection: collName,
								index1: idx1.name ?? "unknown",
								index2: idx2.name ?? "unknown",
								keys1: pattern1,
								keys2: pattern2,
								recommendation: `${idx2.name} is prefix of ${idx1.name} - consider removing ${idx2.name}`,
								duplicateType: "prefix",
							});
						} else if (
							keys1.every((k, idx) => keys2[idx] === k) &&
							keys2.length > keys1.length
						) {
							duplicates.push({
								collection: collName,
								index1: idx1.name ?? "unknown",
								index2: idx2.name ?? "unknown",
								keys1: pattern1,
								keys2: pattern2,
								recommendation: `${idx1.name} is prefix of ${idx2.name} - consider removing ${idx1.name}`,
								duplicateType: "prefix",
							});
						} else if (
							keys1.length === keys2.length &&
							keys1.every((k) => keys2.includes(k))
						) {
							duplicates.push({
								collection: collName,
								index1: idx1.name ?? "unknown",
								index2: idx2.name ?? "unknown",
								keys1: pattern1,
								keys2: pattern2,
								recommendation:
									"Same fields in different order - review if both are needed",
								duplicateType: "similar",
							});
						}
					}
				}
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "getDuplicateIndexes",
				});
				if (this.options.verbose) {
					console.warn(`Could not analyze indexes for ${collName}:`, error);
				}
			}
		}

		return duplicates;
	}

	async getIndexUsageSummary(): Promise<IndexUsageSummary[]> {
		const summary: IndexUsageSummary[] = [];
		const collections = await this.getCollections();
		const minAccesses =
			this.options.minIndexAccesses ?? THRESHOLDS.indexes.minAccessesForUsed;

		for (const collName of collections) {
			try {
				const indexStats = await this.db
					.collection(collName)
					.aggregate([{ $indexStats: {} }])
					.toArray();

				const stats = await this.db
					.command({ collStats: collName })
					.catch(() => null);
				const totalIndexSize = stats?.totalIndexSize ?? 0;

				let usedCount = 0;
				let unusedCount = 0;

				for (const stat of indexStats) {
					if (stat.name === "_id_") continue;
					if ((stat.accesses?.ops ?? 0) >= minAccesses) {
						usedCount++;
					} else {
						unusedCount++;
					}
				}

				const totalIndexes = usedCount + unusedCount;
				const indexEfficiency =
					totalIndexes > 0 ? (usedCount / totalIndexes) * 100 : 100;

				summary.push({
					collection: collName,
					indexCount: indexStats.filter((s) => s.name !== "_id_").length,
					totalIndexSize: formatBytes(totalIndexSize),
					totalIndexSizeBytes: totalIndexSize,
					usedIndexes: usedCount,
					unusedIndexes: unusedCount,
					indexEfficiency: Math.round(indexEfficiency * 100) / 100,
				});
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "getIndexUsageSummary",
				});
			}
		}

		return summary.sort(
			(a, b) => b.totalIndexSizeBytes - a.totalIndexSizeBytes,
		);
	}

	/**
	 * Analyze index covering potential - queries that could use index-only scans
	 */
	async analyzeCoveringIndexes(): Promise<
		{
			collection: string;
			queryPattern: string;
			currentIndex: string;
			missingFields: string[];
			recommendation: string;
		}[]
	> {
		const recommendations: {
			collection: string;
			queryPattern: string;
			currentIndex: string;
			missingFields: string[];
			recommendation: string;
		}[] = [];

		try {
			const profilerData = await this.db
				.collection("system.profile")
				.find({
					op: { $in: ["query", "find"] },
					millis: {
						$gt: this.options.slowQueryThresholdMs ?? THRESHOLDS.queries.slowMs,
					},
					planSummary: { $regex: /IXSCAN/ },
					docsExamined: { $gt: 0 },
				})
				.sort({ millis: -1 })
				.limit(50)
				.toArray();

			for (const entry of profilerData) {
				const ns = entry.ns as string;
				const collection = ns.split(".").slice(1).join(".");
				const projection = entry.command?.projection ?? {};
				const projectedFields = Object.keys(projection).filter(
					(k) => projection[k] === 1,
				);

				if (projectedFields.length > 0) {
					const planSummary = entry.planSummary ?? "";
					const indexMatch = planSummary.match(/IXSCAN\s+{\s*([^}]+)\s*}/);

					if (indexMatch) {
						const indexFields = indexMatch[1]
							.split(",")
							.map((f: string) => f.split(":")[0].trim());
						const missingFields = projectedFields.filter(
							(f) => !indexFields.includes(f) && f !== "_id",
						);

						if (missingFields.length > 0 && missingFields.length <= 3) {
							recommendations.push({
								collection,
								queryPattern: this.normalizeQueryPattern(
									entry.command?.filter ?? {},
								),
								currentIndex: indexMatch[0],
								missingFields,
								recommendation: `Add ${missingFields.join(", ")} to index for covered query`,
							});
						}
					}
				}
			}
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "analyzeCoveringIndexes",
			});
		}

		return recommendations;
	}

	generateRecommendations(
		unusedIndexes: UnusedIndex[],
		missingIndexes: MissingIndex[],
		duplicateIndexes: DuplicateIndex[],
	): string[] {
		const recommendations: string[] = [];

		const totalUnusedSize = unusedIndexes.reduce(
			(acc, idx) => acc + idx.sizeBytes,
			0,
		);

		const safeToRemove = unusedIndexes.filter((idx) => !idx.potentialReason);

		if (safeToRemove.length > 0) {
			recommendations.push(
				`Found ${safeToRemove.length} unused indexes consuming ${formatBytes(totalUnusedSize)}. Consider removing them to improve write performance and reduce storage.`,
			);
		}

		if (duplicateIndexes.length > 0) {
			const exactDuplicates = duplicateIndexes.filter(
				(d) => d.duplicateType === "exact",
			);
			const prefixDuplicates = duplicateIndexes.filter(
				(d) => d.duplicateType === "prefix",
			);

			if (exactDuplicates.length > 0) {
				recommendations.push(
					`Found ${exactDuplicates.length} exact duplicate index pairs. Remove duplicates immediately.`,
				);
			}
			if (prefixDuplicates.length > 0) {
				recommendations.push(
					`Found ${prefixDuplicates.length} prefix-overlapping index pairs. Review and consolidate.`,
				);
			}
		}

		const highPriorityMissing = missingIndexes.filter(
			(m) =>
				m.estimatedBenefit === "Very High" || m.estimatedBenefit === "High",
		);
		if (highPriorityMissing.length > 0) {
			recommendations.push(
				`Found ${highPriorityMissing.length} high-impact query patterns without indexes. Consider adding suggested indexes.`,
			);
		}

		return recommendations;
	}

	/**
	 * Get errors collected during analysis
	 */
	getErrors() {
		return this.errorCollector.getErrors();
	}

	private getPotentialKeepReason(
		metadata: any,
		accesses: number,
	): string | undefined {
		if (metadata.unique) {
			return "Unique constraint index - may be needed for data integrity";
		}
		if (metadata.expireAfterSeconds !== undefined) {
			return "TTL index - used for automatic document expiration";
		}
		if (metadata.sparse && accesses > 0) {
			return "Sparse index - naturally has lower access count";
		}
		if (metadata.partialFilterExpression) {
			return "Partial index - naturally has lower access count";
		}
		return undefined;
	}

	private async getCollections(): Promise<string[]> {
		const collections = await this.db.listCollections().toArray();
		const excludeCollections = this.options.excludeCollections ?? [];
		const includeSystem = this.options.includeSystemCollections ?? false;

		return collections
			.map((c) => c.name)
			.filter((name) => {
				if (excludeCollections.includes(name)) return false;
				if (!includeSystem && name.startsWith("system.")) return false;
				return true;
			});
	}

	private normalizeQueryPattern(query: Record<string, unknown>): string {
		const normalized: Record<string, string> = {};
		for (const key of Object.keys(query).sort()) {
			if (!key.startsWith("$")) {
				normalized[key] = "<value>";
			}
		}
		return JSON.stringify(normalized);
	}
}
