import type { Db } from "mongodb";
import { getFragmentationSeverity, THRESHOLDS } from "../config/thresholds";
import type {
	AnalyzerOptions,
	CollectionStats,
	CompactResult,
	CompactSummary,
	FragmentedCollection,
} from "../types";
import { ErrorCollector } from "../utils/errors";
import { formatBytes } from "../utils/formatting";

export class CollectionAnalyzer {
	private errorCollector = new ErrorCollector();

	constructor(
		private db: Db,
		private options: AnalyzerOptions = {},
	) {}

	async getCollectionStats(): Promise<CollectionStats[]> {
		const collections = await this.getCollections();
		const stats: CollectionStats[] = [];

		for (const collName of collections) {
			try {
				const collStats = await this.db.command({ collStats: collName });

				stats.push({
					namespace: `${this.db.databaseName}.${collName}`,
					collection: collName,
					documentCount: collStats.count ?? 0,
					totalSize: formatBytes(collStats.size ?? 0),
					totalSizeBytes: collStats.size ?? 0,
					storageSize: formatBytes(collStats.storageSize ?? 0),
					storageSizeBytes: collStats.storageSize ?? 0,
					indexSize: formatBytes(collStats.totalIndexSize ?? 0),
					indexSizeBytes: collStats.totalIndexSize ?? 0,
					avgDocSize: collStats.avgObjSize ?? 0,
					indexCount: collStats.nindexes ?? 0,
					capped: collStats.capped ?? false,
					compressionRatio: this.calculateCompressionRatio(collStats),
				});
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "collStats",
				});
				if (this.options.verbose) {
					console.warn(`Could not get stats for ${collName}:`, error);
				}
			}
		}

		return stats.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes);
	}

	async getFragmentedCollections(): Promise<FragmentedCollection[]> {
		const fragmented: FragmentedCollection[] = [];
		const collections = await this.getCollections();

		for (const collName of collections) {
			try {
				const collStats = await this.db.command({ collStats: collName });

				const storageSize = collStats.storageSize ?? 0;
				const dataSize = collStats.size ?? 0;

				if (storageSize > 0 && dataSize > 0) {
					const fragmentationRatio =
						((storageSize - dataSize) / storageSize) * 100;

					if (fragmentationRatio > THRESHOLDS.fragmentation.minor) {
						const severity = getFragmentationSeverity(fragmentationRatio);
						fragmented.push({
							collection: collName,
							storageSize: formatBytes(storageSize),
							storageSizeBytes: storageSize,
							dataSize: formatBytes(dataSize),
							dataSizeBytes: dataSize,
							fragmentationRatio: Math.round(fragmentationRatio * 100) / 100,
							recommendation: this.generateFragmentationRecommendation(
								fragmentationRatio,
								storageSize,
							),
							severity,
						});
					}
				}
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "getFragmentation",
				});
			}
		}

		return fragmented.sort(
			(a, b) => b.fragmentationRatio - a.fragmentationRatio,
		);
	}

	async getCollectionsNeedingCompact(): Promise<FragmentedCollection[]> {
		const fragmented = await this.getFragmentedCollections();
		return fragmented.filter(
			(f) => f.fragmentationRatio > THRESHOLDS.fragmentation.moderate,
		);
	}

	async getLargestCollections(limit = 20): Promise<
		{
			collection: string;
			totalSize: string;
			totalSizeBytes: number;
			storageSize: string;
			indexSize: string;
			documentCount: number;
			avgDocSize: number;
		}[]
	> {
		const stats = await this.getCollectionStats();

		return stats.slice(0, limit).map((s) => ({
			collection: s.collection,
			totalSize: s.totalSize,
			totalSizeBytes: s.totalSizeBytes,
			storageSize: s.storageSize,
			indexSize: s.indexSize,
			documentCount: s.documentCount,
			avgDocSize: Math.round(s.avgDocSize),
		}));
	}

	async getCollectionsWithHighIndexRatio(): Promise<
		{
			collection: string;
			dataSize: string;
			dataSizeBytes: number;
			indexSize: string;
			indexSizeBytes: number;
			indexToDataRatio: number;
			indexCount: number;
			recommendation: string;
		}[]
	> {
		const stats = await this.getCollectionStats();

		return stats
			.filter(
				(s) => s.totalSizeBytes > THRESHOLDS.collections.minSizeForAnalysis,
			)
			.map((s) => {
				const dataSize = s.totalSizeBytes - s.indexSizeBytes;
				const indexToDataRatio =
					dataSize > 0 ? (s.indexSizeBytes / dataSize) * 100 : 0;

				return {
					collection: s.collection,
					dataSize: formatBytes(dataSize),
					dataSizeBytes: dataSize,
					indexSize: s.indexSize,
					indexSizeBytes: s.indexSizeBytes,
					indexToDataRatio: Math.round(indexToDataRatio * 100) / 100,
					indexCount: s.indexCount,
					recommendation: this.generateIndexRatioRecommendation(
						indexToDataRatio,
						s.indexCount,
					),
				};
			})
			.filter((s) => s.indexToDataRatio > THRESHOLDS.indexes.highIndexRatio)
			.sort((a, b) => b.indexToDataRatio - a.indexToDataRatio);
	}

	async getCappedCollections(): Promise<
		{
			collection: string;
			size: string;
			sizeBytes: number;
			maxSize: string;
			maxSizeBytes: number;
			documentCount: number;
			maxDocuments: number | null;
			usagePercent: number;
		}[]
	> {
		const collections = await this.getCollections();
		const capped: {
			collection: string;
			size: string;
			sizeBytes: number;
			maxSize: string;
			maxSizeBytes: number;
			documentCount: number;
			maxDocuments: number | null;
			usagePercent: number;
		}[] = [];

		for (const collName of collections) {
			try {
				const collStats = await this.db.command({ collStats: collName });

				if (collStats.capped) {
					const maxSize = collStats.maxSize ?? 0;
					const currentSize = collStats.size ?? 0;
					const usagePercent = maxSize > 0 ? (currentSize / maxSize) * 100 : 0;

					capped.push({
						collection: collName,
						size: formatBytes(currentSize),
						sizeBytes: currentSize,
						maxSize: formatBytes(maxSize),
						maxSizeBytes: maxSize,
						documentCount: collStats.count ?? 0,
						maxDocuments: collStats.max ?? null,
						usagePercent: Math.round(usagePercent * 100) / 100,
					});
				}
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "getCapped",
				});
			}
		}

		return capped.sort((a, b) => b.usagePercent - a.usagePercent);
	}

	async compactCollection(collection: string): Promise<CompactResult> {
		const startTime = Date.now();

		try {
			// Get size before compact
			const beforeStats = await this.db.command({ collStats: collection });
			const sizeBefore = beforeStats.storageSize ?? 0;

			// Run compact
			await this.db.command({ compact: collection });

			// Get size after compact
			const afterStats = await this.db.command({ collStats: collection });
			const sizeAfter = afterStats.storageSize ?? 0;

			const bytesFreed = Math.max(0, sizeBefore - sizeAfter);

			return {
				collection,
				success: true,
				duration: Date.now() - startTime,
				bytesFreed,
				bytesFreedFormatted: formatBytes(bytesFreed),
			};
		} catch (error) {
			return {
				collection,
				success: false,
				duration: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async compactCollections(
		targets: { collection: string }[],
		options?: {
			onProgress?: (
				result: CompactResult,
				index: number,
				total: number,
			) => void;
		},
	): Promise<CompactSummary> {
		const results: CompactResult[] = [];
		const startTime = Date.now();
		let totalBytesFreed = 0;

		for (let i = 0; i < targets.length; i++) {
			const { collection } = targets[i];
			const result = await this.compactCollection(collection);
			results.push(result);
			totalBytesFreed += result.bytesFreed ?? 0;

			if (options?.onProgress) {
				options.onProgress(result, i + 1, targets.length);
			}
		}

		return {
			totalCollections: targets.length,
			successful: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
			totalDuration: Date.now() - startTime,
			totalBytesFreed,
			totalBytesFreedFormatted: formatBytes(totalBytesFreed),
			results,
		};
	}

	async autoCompact(options?: {
		onProgress?: (result: CompactResult, index: number, total: number) => void;
	}): Promise<CompactSummary> {
		const needsCompact = await this.getCollectionsNeedingCompact();
		const targets = needsCompact.map((c) => ({
			collection: c.collection,
		}));

		return this.compactCollections(targets, options);
	}

	/**
	 * Get storage efficiency metrics for all collections
	 */
	async getStorageEfficiency(): Promise<{
		totalDataSize: number;
		totalStorageSize: number;
		overallEfficiency: number;
		collections: {
			collection: string;
			efficiency: number;
			wastedSpace: number;
		}[];
	}> {
		const stats = await this.getCollectionStats();

		let totalDataSize = 0;
		let totalStorageSize = 0;
		const collections: {
			collection: string;
			efficiency: number;
			wastedSpace: number;
		}[] = [];

		for (const s of stats) {
			const dataSize = s.totalSizeBytes;
			const storageSize = s.storageSizeBytes;
			totalDataSize += dataSize;
			totalStorageSize += storageSize;

			const efficiency = storageSize > 0 ? (dataSize / storageSize) * 100 : 100;
			const wastedSpace = Math.max(0, storageSize - dataSize);

			collections.push({
				collection: s.collection,
				efficiency: Math.round(efficiency * 100) / 100,
				wastedSpace,
			});
		}

		const overallEfficiency =
			totalStorageSize > 0 ? (totalDataSize / totalStorageSize) * 100 : 100;

		return {
			totalDataSize,
			totalStorageSize,
			overallEfficiency: Math.round(overallEfficiency * 100) / 100,
			collections: collections.sort((a, b) => a.efficiency - b.efficiency),
		};
	}

	/**
	 * Get errors collected during analysis
	 */
	getErrors() {
		return this.errorCollector.getErrors();
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

	private calculateCompressionRatio(collStats: any): number | undefined {
		// WiredTiger specific compression info
		const wt = collStats.wiredTiger;
		if (!wt) return undefined;

		const blockManager = wt["block-manager"];
		if (!blockManager) return undefined;

		const bytesWritten = blockManager["file bytes available for reuse"] ?? 0;
		const totalBytes = blockManager["file size in bytes"] ?? 0;

		if (totalBytes === 0) return undefined;

		return Math.round(((totalBytes - bytesWritten) / totalBytes) * 10000) / 100;
	}

	private generateFragmentationRecommendation(
		ratio: number,
		_storageSize: number,
	): string {
		if (ratio > THRESHOLDS.fragmentation.critical) {
			return "Critical fragmentation. Run compact command immediately to reclaim space.";
		}
		if (ratio > THRESHOLDS.fragmentation.high) {
			return "High fragmentation. Schedule compact during maintenance window.";
		}
		if (ratio > THRESHOLDS.fragmentation.moderate) {
			return "Moderate fragmentation. Consider running compact.";
		}
		return "Minor fragmentation. Monitor and compact if storage becomes an issue.";
	}

	private generateIndexRatioRecommendation(
		ratio: number,
		indexCount: number,
	): string {
		if (ratio > THRESHOLDS.indexes.criticalIndexRatio) {
			return `Index size exceeds data size. Review ${indexCount} indexes for unused or redundant indexes.`;
		}
		if (ratio > 75) {
			return `High index-to-data ratio (${ratio.toFixed(1)}%). Consider removing unused indexes.`;
		}
		return `Index ratio is ${ratio.toFixed(1)}%. May be acceptable depending on query patterns.`;
	}

	generateCollectionReport(stats: CollectionStats[]): {
		totalCollections: number;
		totalDataSize: number;
		totalIndexSize: number;
		totalDocuments: number;
		collectionsWithHighFragmentation: number;
		cappedCollections: number;
		avgDocSize: number;
	} {
		const totalDataSize = stats.reduce((acc, s) => acc + s.totalSizeBytes, 0);
		const totalIndexSize = stats.reduce((acc, s) => acc + s.indexSizeBytes, 0);
		const totalDocuments = stats.reduce((acc, s) => acc + s.documentCount, 0);
		const cappedCollections = stats.filter((s) => s.capped).length;
		const avgDocSize =
			totalDocuments > 0
				? stats.reduce((acc, s) => acc + s.avgDocSize * s.documentCount, 0) /
					totalDocuments
				: 0;

		return {
			totalCollections: stats.length,
			totalDataSize,
			totalIndexSize,
			totalDocuments,
			collectionsWithHighFragmentation: 0, // Will be calculated by getFragmentedCollections
			cappedCollections,
			avgDocSize: Math.round(avgDocSize),
		};
	}
}
