import { THRESHOLDS } from "../config/thresholds";
import type { DatabaseMetrics } from "../types";

export type HealthStatus = "excellent" | "good" | "fair" | "poor" | "critical";

export interface HealthScoreInput {
	metrics: DatabaseMetrics;
	unusedIndexesCount?: number;
	missingIndexesCount?: number;
	slowQueriesCount?: number;
	fragmentedCollectionsCount?: number;
}

export interface HealthScoreResult {
	score: number;
	status: HealthStatus;
	issues: string[];
}

export function calculateHealthScore(
	input: HealthScoreInput,
): HealthScoreResult {
	let score = 100;
	const issues: string[] = [];

	const metrics = input.metrics;
	const unusedIndexesCount = input.unusedIndexesCount ?? 0;
	const missingIndexesCount = input.missingIndexesCount ?? 0;
	const slowQueriesCount = input.slowQueriesCount ?? 0;
	const fragmentedCollectionsCount = input.fragmentedCollectionsCount ?? 0;

	// Cache hit ratio (-1 means data unavailable, skip penalty)
	if (metrics.cacheHitRatio < 0) {
		issues.push("Cache hit ratio unavailable (insufficient permissions)");
	} else if (metrics.cacheHitRatio < THRESHOLDS.cache.poor) {
		score -= THRESHOLDS.healthScore.lowCacheHitPenalty;
		issues.push("Very low cache hit ratio");
	} else if (metrics.cacheHitRatio < THRESHOLDS.cache.acceptable) {
		score -= THRESHOLDS.healthScore.lowCacheHitPenalty;
		issues.push("Low cache hit ratio");
	} else if (metrics.cacheHitRatio < THRESHOLDS.cache.optimal) {
		score -= THRESHOLDS.healthScore.suboptimalCachePenalty;
		issues.push("Suboptimal cache hit ratio");
	}

	// Connection usage
	const totalConnections =
		metrics.currentConnections + metrics.availableConnections;
	const connectionUsage =
		totalConnections > 0
			? (metrics.currentConnections / totalConnections) * 100
			: 0;

	if (connectionUsage > THRESHOLDS.connections.criticalUsage) {
		score -= THRESHOLDS.healthScore.highConnectionPenalty;
		issues.push("Critical connection usage");
	} else if (connectionUsage > THRESHOLDS.connections.highUsage) {
		score -= THRESHOLDS.healthScore.highConnectionPenalty;
		issues.push("High connection usage");
	}

	// Index size ratio
	const indexRatio =
		metrics.databaseSizeBytes > 0
			? (metrics.indexSizeBytes / metrics.databaseSizeBytes) * 100
			: 0;

	if (indexRatio > THRESHOLDS.indexes.criticalIndexRatio) {
		score -= THRESHOLDS.healthScore.highIndexRatioPenalty;
		issues.push("Index size exceeds data size");
	} else if (indexRatio > THRESHOLDS.indexes.highIndexRatio) {
		score -= Math.round(THRESHOLDS.healthScore.highIndexRatioPenalty / 2);
		issues.push("High index-to-data ratio");
	}

	// Unused indexes
	if (unusedIndexesCount > THRESHOLDS.healthScore.unusedIndexesCountThreshold) {
		score -= THRESHOLDS.healthScore.unusedIndexesPenalty;
		issues.push("Many unused indexes");
	}

	// Missing indexes
	if (
		missingIndexesCount > THRESHOLDS.healthScore.missingIndexesCountThreshold
	) {
		score -= THRESHOLDS.healthScore.missingIndexesPenalty;
		issues.push("Query patterns needing indexes");
	}

	// Slow queries
	if (slowQueriesCount > THRESHOLDS.healthScore.slowQueriesCountThreshold) {
		score -= THRESHOLDS.healthScore.slowQueriesPenalty;
		issues.push("Many slow queries");
	}

	// Fragmentation
	if (
		fragmentedCollectionsCount >
		THRESHOLDS.healthScore.fragmentedCollectionsCountThreshold
	) {
		score -= THRESHOLDS.healthScore.fragmentationPenalty;
		issues.push("Collection fragmentation");
	}

	const finalScore = Math.max(0, score);
	const status: HealthStatus =
		finalScore >= 90
			? "excellent"
			: finalScore >= 75
				? "good"
				: finalScore >= 60
					? "fair"
					: finalScore >= 40
						? "poor"
						: "critical";

	return { score: finalScore, status, issues };
}
