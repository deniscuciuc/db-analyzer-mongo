/**
 * Shared formatting utilities for MongoDB Analyzer
 */

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";

	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let unitIndex = 0;
	let size = Math.abs(bytes);

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	const formatted = size.toFixed(2);
	return `${bytes < 0 ? "-" : ""}${formatted} ${units[unitIndex]}`;
}

/**
 * Format milliseconds to human-readable duration
 */
export function formatDuration(ms: number): string {
	if (ms < 0) return "0ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
	if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
	return `${(ms / 86400000).toFixed(1)}d`;
}

/**
 * Format milliseconds to short string (for tables)
 */
export function formatMs(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format number with thousand separators
 */
export function formatNumber(num: number): string {
	return num.toLocaleString("en-US");
}

/**
 * Format percentage with specified decimal places
 */
export function formatPercent(value: number, decimals = 2): string {
	return `${value.toFixed(decimals)}%`;
}

/**
 * Format date to ISO string without milliseconds
 */
export function formatDate(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return `${str.substring(0, maxLength - 3)}...`;
}

/**
 * Format index key pattern to readable string
 */
export function formatKeyPattern(key: Record<string, unknown>): string {
	return Object.entries(key)
		.map(([k, v]) => `${k}: ${v}`)
		.join(", ");
}

/**
 * Calculate and format ratio
 */
export function formatRatio(
	numerator: number,
	denominator: number,
	decimals = 2,
): string {
	if (denominator === 0) return "N/A";
	const ratio = (numerator / denominator) * 100;
	return `${ratio.toFixed(decimals)}%`;
}
