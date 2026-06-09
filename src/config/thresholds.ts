/**
 * Configurable thresholds for MongoDB analysis
 * All thresholds can be overridden via AnalyzerOptions
 */

export const THRESHOLDS = {
	/**
	 * Fragmentation thresholds (percentage)
	 */
	fragmentation: {
		/** Minor fragmentation - just monitor */
		minor: 20,
		/** Moderate fragmentation - consider compacting */
		moderate: 30,
		/** High fragmentation - schedule compact */
		high: 40,
		/** Critical fragmentation - compact immediately */
		critical: 50,
	},

	/**
	 * Cache hit ratio thresholds (percentage)
	 */
	cache: {
		/** Excellent cache performance */
		excellent: 98,
		/** Optimal cache performance */
		optimal: 95,
		/** Acceptable cache performance */
		acceptable: 90,
		/** Poor cache performance - needs attention */
		poor: 80,
	},

	/**
	 * Index-related thresholds
	 */
	indexes: {
		/** Minimum accesses to consider index as "used" */
		minAccessesForUsed: 50,
		/** Index-to-data ratio threshold (percentage) */
		highIndexRatio: 50,
		/** Critical index-to-data ratio (percentage) */
		criticalIndexRatio: 100,
	},

	/**
	 * Query performance thresholds
	 */
	queries: {
		/** Slow query threshold (milliseconds) */
		slowMs: 100,
		/** Very slow query threshold (milliseconds) */
		verySlowMs: 1000,
		/** Critical query time (milliseconds) */
		criticalMs: 5000,
		/** Docs examined to docs returned ratio for inefficient queries */
		inefficientDocsRatio: 100,
		/** Minimum docs examined to flag as potential issue */
		minDocsExaminedForFlag: 100,
		/** Frequency threshold for high-impact queries */
		highFrequencyCount: 100,
	},

	/**
	 * Connection thresholds
	 */
	connections: {
		/** High connection usage (percentage of available) */
		highUsage: 80,
		/** Critical connection usage (percentage) */
		criticalUsage: 95,
	},

	/**
	 * Collection size thresholds
	 */
	collections: {
		/** Minimum collection size for analysis (bytes) - 1MB */
		minSizeForAnalysis: 1024 * 1024,
		/** Large collection threshold (bytes) - 1GB */
		largeCollection: 1024 * 1024 * 1024,
	},

	/**
	 * Health score weights
	 */
	healthScore: {
		/** Weight reduction for low cache hit ratio */
		lowCacheHitPenalty: 20,
		/** Weight reduction for suboptimal cache */
		suboptimalCachePenalty: 10,
		/** Weight reduction for high connection usage */
		highConnectionPenalty: 15,
		/** Weight reduction for high index ratio */
		highIndexRatioPenalty: 10,
		/** Weight reduction for unused indexes */
		unusedIndexesPenalty: 5,
		/** Weight reduction for missing indexes */
		missingIndexesPenalty: 10,
		/** Weight reduction for slow queries */
		slowQueriesPenalty: 10,
		/** Weight reduction for fragmented collections */
		fragmentationPenalty: 10,
		/** Thresholds for count-based penalties */
		unusedIndexesCountThreshold: 10,
		missingIndexesCountThreshold: 5,
		slowQueriesCountThreshold: 10,
		fragmentedCollectionsCountThreshold: 5,
	},

	/**
	 * Benefit calculation thresholds for missing index suggestions
	 */
	indexBenefit: {
		/** Very high benefit threshold (frequency * avgTime) */
		veryHigh: 100000,
		/** High benefit threshold */
		high: 10000,
		/** Medium benefit threshold */
		medium: 1000,
	},

	/**
	 * Long-running operation thresholds
	 */
	operations: {
		/** Long-running query threshold (milliseconds) - 1 minute */
		longRunningMs: 60000,
		/** Critical long-running threshold (milliseconds) - 5 minutes */
		criticalLongRunningMs: 300000,
	},
} as const;

/**
 * Severity levels for recommendations
 */
export type Severity = "critical" | "high" | "medium" | "low";

/**
 * Get severity based on fragmentation ratio
 */
export function getFragmentationSeverity(ratio: number): Severity {
	if (ratio >= THRESHOLDS.fragmentation.critical) return "critical";
	if (ratio >= THRESHOLDS.fragmentation.high) return "high";
	if (ratio >= THRESHOLDS.fragmentation.moderate) return "medium";
	return "low";
}

/**
 * Get severity based on cache hit ratio
 */
export function getCacheHitSeverity(ratio: number): Severity {
	if (ratio < THRESHOLDS.cache.poor) return "critical";
	if (ratio < THRESHOLDS.cache.acceptable) return "high";
	if (ratio < THRESHOLDS.cache.optimal) return "medium";
	return "low";
}

/**
 * Get severity based on query execution time
 */
export function getQueryTimeSeverity(ms: number): Severity {
	if (ms >= THRESHOLDS.queries.criticalMs) return "critical";
	if (ms >= THRESHOLDS.queries.verySlowMs) return "high";
	if (ms >= THRESHOLDS.queries.slowMs) return "medium";
	return "low";
}

/**
 * Calculate index benefit level
 */
export function calculateBenefitLevel(
	frequency: number,
	avgTime: number,
): "Very High" | "High" | "Medium" | "Low" {
	const impact = frequency * avgTime;
	if (impact > THRESHOLDS.indexBenefit.veryHigh) return "Very High";
	if (impact > THRESHOLDS.indexBenefit.high) return "High";
	if (impact > THRESHOLDS.indexBenefit.medium) return "Medium";
	return "Low";
}
