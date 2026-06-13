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

export function formatDuration(ms: number): string {
	if (ms < 0) return "0ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}min`;
	if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
	return `${(ms / 86_400_000).toFixed(1)}d`;
}

export function formatMs(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatNumber(value: number): string {
	return value.toLocaleString("en-US");
}

export function formatPercent(value: number, decimals = 2): string {
	return `${value.toFixed(decimals)}%`;
}

export function formatDate(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.substring(0, maxLength - 3)}...`;
}

export function formatKeyPattern(key: Record<string, unknown>): string {
	return Object.entries(key)
		.map(([name, part]) => `${name}: ${part}`)
		.join(", ");
}

export function formatRatio(
	numerator: number,
	denominator: number,
	decimals = 2,
): string {
	if (denominator === 0) return "N/A";
	return `${((numerator / denominator) * 100).toFixed(decimals)}%`;
}
