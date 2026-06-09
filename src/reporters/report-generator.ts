import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AnalysisErrorInfo,
	AnalysisReport,
	CollectionStats,
	ConnectionStats,
	DatabaseMetrics,
	DocumentSizeDistribution,
	FragmentedCollection,
	QueryAntiPattern,
	ReplicaSetStatus,
	SchemaIssue,
	SlowQuery,
	TTLIndexInfo,
	WiredTigerStats,
} from "../types";
import { formatBytes, formatMs } from "../utils/formatting";
import { calculateHealthScore } from "../utils/health";

export class ReportGenerator {
	constructor(private outputDir: string = "./reports") {}

	async generateFullReport(
		report: AnalysisReport,
		timestamp?: string,
	): Promise<string> {
		const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `mongodb-analysis-${ts}.md`;
		const filepath = path.join(this.outputDir, filename);

		const content = this.buildMarkdownReport(report);

		await this.ensureOutputDir();
		fs.writeFileSync(filepath, content);

		return filepath;
	}

	async generateJsonReport(
		report: AnalysisReport,
		timestamp?: string,
	): Promise<string> {
		const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `mongodb-analysis-${ts}.json`;
		const filepath = path.join(this.outputDir, filename);

		await this.ensureOutputDir();
		fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

		return filepath;
	}

	private async ensureOutputDir(): Promise<void> {
		if (!fs.existsSync(this.outputDir)) {
			fs.mkdirSync(this.outputDir, { recursive: true });
		}
	}

	private buildMarkdownReport(report: AnalysisReport): string {
		const sections: string[] = [];

		sections.push(this.buildHeader(report));
		sections.push(this.buildExecutiveSummary(report));
		sections.push(this.buildMetricsSection(report.metrics));
		sections.push(this.buildOperationStatsSection(report.metrics));
		sections.push(this.buildIndexAnalysisSection(report));
		if (report.ttlIndexes && report.ttlIndexes.length > 0) {
			sections.push(this.buildTTLIndexSection(report.ttlIndexes));
		}
		sections.push(this.buildCollectionAnalysisSection(report.collectionStats));
		if (
			report.documentSizeDistribution &&
			report.documentSizeDistribution.length > 0
		) {
			sections.push(
				this.buildDocumentSizeSection(report.documentSizeDistribution),
			);
		}
		sections.push(this.buildSlowQueriesSection(report.slowQueries));
		if (report.queryAntiPatterns && report.queryAntiPatterns.length > 0) {
			sections.push(
				this.buildQueryAntiPatternsSection(report.queryAntiPatterns),
			);
		}
		if (report.schemaIssues && report.schemaIssues.length > 0) {
			sections.push(this.buildSchemaIssuesSection(report.schemaIssues));
		}
		sections.push(this.buildFragmentationSection(report.fragmentedCollections));
		if (report.wiredTigerStats) {
			sections.push(this.buildWiredTigerSection(report.wiredTigerStats));
		}
		if (report.replicaSetStatus) {
			sections.push(this.buildReplicaSetSection(report.replicaSetStatus));
		}
		if (report.connectionStats) {
			sections.push(this.buildConnectionStatsSection(report.connectionStats));
		}
		if (report.errors && report.errors.length > 0) {
			sections.push(this.buildErrorsSection(report.errors));
		}
		sections.push(this.buildRecommendationsSection(report.recommendations));

		return sections.join("\n\n");
	}

	private buildHeader(report: AnalysisReport): string {
		return `# MongoDB Analysis Report

**Database:** ${report.databaseName}
**Generated:** ${report.generatedAt.toISOString()}
**Tool:** MongoDB Database Analyzer

---`;
	}

	private buildExecutiveSummary(report: AnalysisReport): string {
		const issues: string[] = [];

		if (report.unusedIndexes.length > 0) {
			const totalSize = report.unusedIndexes.reduce(
				(acc, idx) => acc + idx.sizeBytes,
				0,
			);
			issues.push(
				`- **${report.unusedIndexes.length}** unused indexes consuming **${formatBytes(totalSize)}**`,
			);
		}

		if (report.missingIndexes.length > 0) {
			issues.push(
				`- **${report.missingIndexes.length}** query patterns that may benefit from indexes`,
			);
		}

		if (report.duplicateIndexes.length > 0) {
			issues.push(
				`- **${report.duplicateIndexes.length}** duplicate/overlapping index pairs`,
			);
		}

		if (report.slowQueries.length > 0) {
			issues.push(`- **${report.slowQueries.length}** slow queries identified`);
		}

		if (report.queryAntiPatterns && report.queryAntiPatterns.length > 0) {
			issues.push(
				`- **${report.queryAntiPatterns.length}** query anti-patterns detected`,
			);
		}

		if (report.fragmentedCollections.length > 0) {
			issues.push(
				`- **${report.fragmentedCollections.length}** collections with significant fragmentation`,
			);
		}

		if (report.schemaIssues && report.schemaIssues.length > 0) {
			issues.push(`- **${report.schemaIssues.length}** schema issues detected`);
		}

		if (report.errors && report.errors.length > 0) {
			issues.push(
				`- **${report.errors.length}** errors occurred during analysis`,
			);
		}

		const healthIndicators = this.calculateHealthIndicators(report);

		return `## Executive Summary

### Health Score: ${healthIndicators.score}/100 ${this.getHealthEmoji(healthIndicators.score)}

### Key Findings
${issues.length > 0 ? issues.join("\n") : "- No critical issues found"}

### Quick Stats
| Metric | Value |
|--------|-------|
| Database Size | ${report.metrics.databaseSize} |
| Storage Size | ${report.metrics.storageSize} |
| Index Size | ${report.metrics.indexSize} |
| Collections | ${report.metrics.collections} |
| Documents | ${report.metrics.documents.toLocaleString()} |
| Cache Hit Ratio | ${report.metrics.cacheHitRatio}% |`;
	}

	private buildMetricsSection(metrics: DatabaseMetrics): string {
		return `## Database Metrics

### Performance Metrics
| Metric | Value | Status |
|--------|-------|--------|
| Cache Hit Ratio | ${metrics.cacheHitRatio}% | ${this.getStatusBadge(metrics.cacheHitRatio, 95, 90)} |

### Storage Statistics
| Metric | Value |
|--------|-------|
| Database Size | ${metrics.databaseSize} |
| Storage Size | ${metrics.storageSize} |
| Index Size | ${metrics.indexSize} |
| Collections | ${metrics.collections} |
| Documents | ${metrics.documents.toLocaleString()} |
| Indexes | ${metrics.indexes} |

### Connection Statistics
| Metric | Value |
|--------|-------|
| Current Connections | ${metrics.currentConnections} |
| Available Connections | ${metrics.availableConnections} |
| Active Connections | ${metrics.activeConnections} |`;
	}

	private buildIndexAnalysisSection(report: AnalysisReport): string {
		let content = `## Index Analysis\n\n`;

		// Unused Indexes
		content += `### Unused Indexes (${report.unusedIndexes.length})\n\n`;
		if (report.unusedIndexes.length > 0) {
			content += `These indexes have very few or no accesses and may be candidates for removal:\n\n`;
			content += `| Collection | Index | Keys | Size | Accesses | Status |\n`;
			content += `|------------|-------|------|------|----------|--------|\n`;

			for (const idx of report.unusedIndexes.slice(0, 20)) {
				content += `| ${idx.collection} | ${idx.name} | ${idx.keyPattern} | ${idx.size} | ${idx.accesses} | ${idx.usageStatus} |\n`;
			}

			if (report.unusedIndexes.length > 20) {
				content += `\n*... and ${report.unusedIndexes.length - 20} more unused indexes*\n`;
			}

			const totalSize = report.unusedIndexes.reduce(
				(acc, idx) => acc + idx.sizeBytes,
				0,
			);
			content += `\n**Total space used by unused indexes:** ${formatBytes(totalSize)}\n`;
		} else {
			content += `No unused indexes found.\n`;
		}

		// Missing Indexes
		content += `\n### Query Patterns Needing Indexes (${report.missingIndexes.length})\n\n`;
		if (report.missingIndexes.length > 0) {
			content += `These query patterns may benefit from additional indexes:\n\n`;
			content += `| Collection | Frequency | Avg Time | Benefit | Suggested Index |\n`;
			content += `|------------|-----------|----------|---------|----------------|\n`;

			for (const idx of report.missingIndexes.slice(0, 20)) {
				content += `| ${idx.collection} | ${idx.frequency} | ${idx.avgExecutionTime}ms | ${idx.estimatedBenefit} | ${idx.suggestedIndex.substring(0, 50)}... |\n`;
			}

			if (report.missingIndexes.length > 20) {
				content += `\n*... and ${report.missingIndexes.length - 20} more patterns*\n`;
			}
		} else {
			content += `No missing indexes detected. Enable the profiler to capture query patterns.\n`;
		}

		// Duplicate Indexes
		content += `\n### Duplicate/Overlapping Indexes (${report.duplicateIndexes.length})\n\n`;
		if (report.duplicateIndexes.length > 0) {
			content += `These index pairs have overlapping keys and may be consolidated:\n\n`;
			content += `| Collection | Index 1 | Index 2 | Recommendation |\n`;
			content += `|------------|---------|---------|----------------|\n`;

			for (const dup of report.duplicateIndexes) {
				content += `| ${dup.collection} | ${dup.index1} | ${dup.index2} | ${dup.recommendation} |\n`;
			}
		} else {
			content += `No duplicate indexes found.\n`;
		}

		return content;
	}

	private buildCollectionAnalysisSection(
		collectionStats: CollectionStats[],
	): string {
		let content = `## Collection Analysis\n\n`;

		// Largest Collections
		const largestCollections = [...collectionStats]
			.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
			.slice(0, 15);

		content += `### Largest Collections\n\n`;
		content += `| Collection | Total Size | Storage Size | Index Size | Documents |\n`;
		content += `|------------|------------|--------------|------------|----------|\n`;

		for (const c of largestCollections) {
			content += `| ${c.collection} | ${c.totalSize} | ${c.storageSize} | ${c.indexSize} | ${c.documentCount.toLocaleString()} |\n`;
		}

		// Collections with high index-to-data ratio
		const highIndexRatio = collectionStats
			.filter((c) => {
				const dataSize = c.totalSizeBytes - c.indexSizeBytes;
				return dataSize > 0 && c.indexSizeBytes / dataSize > 0.5;
			})
			.slice(0, 10);

		if (highIndexRatio.length > 0) {
			content += `\n### Collections with High Index-to-Data Ratio\n\n`;
			content += `| Collection | Data Size | Index Size | Index Count | Ratio |\n`;
			content += `|------------|-----------|------------|-------------|-------|\n`;

			for (const c of highIndexRatio) {
				const dataSize = c.totalSizeBytes - c.indexSizeBytes;
				const ratio = ((c.indexSizeBytes / dataSize) * 100).toFixed(1);
				content += `| ${c.collection} | ${formatBytes(dataSize)} | ${c.indexSize} | ${c.indexCount} | ${ratio}% |\n`;
			}
		}

		return content;
	}

	private buildSlowQueriesSection(slowQueries: SlowQuery[]): string {
		let content = `## Slow Queries Analysis\n\n`;

		if (slowQueries.length === 0) {
			content += `No slow queries captured. Ensure the MongoDB profiler is enabled.\n`;
			content += `\n### To enable the profiler:\n`;
			content += "```javascript\n";
			content += "// Enable profiling for slow queries (>100ms)\n";
			content += "db.setProfilingLevel(1, { slowms: 100 })\n\n";
			content += "// Enable profiling for all queries (use with caution)\n";
			content += "db.setProfilingLevel(2)\n";
			content += "```\n";
			return content;
		}

		// Top by total time
		content += `### Top Queries by Total Execution Time\n\n`;
		const topByTime = [...slowQueries]
			.sort((a, b) => b.totalExecutionTime - a.totalExecutionTime)
			.slice(0, 10);

		for (let i = 0; i < topByTime.length; i++) {
			const q = topByTime[i];
			content += `#### ${i + 1}. ${q.operation.toUpperCase()} on ${q.namespace}\n\n`;
			content += `**Total: ${formatMs(q.totalExecutionTime)}, Avg: ${formatMs(q.avgExecutionTime)}, Count: ${q.executionCount}**\n\n`;
			content += "```javascript\n";
			content += `${q.queryShape}\n`;
			content += "```\n\n";

			if (q.recommendations.length > 0) {
				content += `**Recommendations:**\n`;
				for (const rec of q.recommendations) {
					content += `- ${rec}\n`;
				}
				content += "\n";
			}

			content += `| Metric | Value |\n`;
			content += `|--------|-------|\n`;
			content += `| Plan Summary | ${q.planSummary} |\n`;
			content += `| Docs Examined | ${q.docsExamined.toLocaleString()} |\n`;
			content += `| Docs Returned | ${q.docsReturned.toLocaleString()} |\n`;
			content += `| Keys Examined | ${q.keysExamined.toLocaleString()} |\n\n`;
		}

		return content;
	}

	private buildQueryAntiPatternsSection(patterns: QueryAntiPattern[]): string {
		let content = `## Query Anti-Patterns\n\n`;

		content += `Detected ${patterns.length} query anti-pattern(s):\n\n`;
		content += `| Pattern | Severity | Count | Recommendation |\n`;
		content += `|---------|----------|-------|----------------|\n`;

		for (const pattern of patterns) {
			content += `| ${pattern.pattern} | ${pattern.severity} | ${pattern.count} | ${pattern.recommendation} |\n`;
		}

		return content;
	}

	private buildSchemaIssuesSection(issues: SchemaIssue[]): string {
		let content = `## Schema Issues\n\n`;

		content += `Detected ${issues.length} schema issue(s):\n\n`;
		content += `| Collection | Field | Severity | Issue | Recommendation |\n`;
		content += `|------------|-------|----------|-------|----------------|\n`;

		for (const issue of issues) {
			content += `| ${issue.collection} | ${issue.field} | ${issue.severity} | ${issue.issue} | ${issue.recommendation} |\n`;
		}

		return content;
	}

	private buildFragmentationSection(
		fragmentedCollections: FragmentedCollection[],
	): string {
		let content = `## Collection Fragmentation Analysis\n\n`;

		if (fragmentedCollections.length === 0) {
			content += `No significant collection fragmentation detected.\n`;
			return content;
		}

		content += `The following collections have significant fragmentation and may benefit from compaction:\n\n`;
		content += `| Collection | Storage Size | Data Size | Fragmentation | Recommendation |\n`;
		content += `|------------|--------------|-----------|---------------|----------------|\n`;

		for (const c of fragmentedCollections) {
			content += `| ${c.collection} | ${c.storageSize} | ${c.dataSize} | ${c.fragmentationRatio}% | ${c.recommendation} |\n`;
		}

		content += `\n### How to reduce fragmentation:\n`;
		content += "```javascript\n";
		content += "// Run compact on a collection (requires exclusive lock)\n";
		content += "db.runCommand({ compact: 'collection_name' })\n\n";
		content += "// For WiredTiger, compact reclaims disk space\n";
		content += "// Schedule during maintenance window\n";
		content += "```\n";

		return content;
	}

	private buildRecommendationsSection(recommendations: string[]): string {
		let content = `## Recommendations\n\n`;

		if (recommendations.length === 0) {
			content += `No specific recommendations at this time. Database appears healthy.\n`;
			return content;
		}

		content += `Based on the analysis, consider the following actions:\n\n`;
		for (let i = 0; i < recommendations.length; i++) {
			content += `${i + 1}. ${recommendations[i]}\n\n`;
		}

		return content;
	}

	private buildErrorsSection(errors: AnalysisErrorInfo[]): string {
		let content = `## Analysis Errors\n\n`;

		content += `Some operations encountered errors during analysis:\n\n`;
		content += `| Type | Severity | Collection | Operation | Message |\n`;
		content += `|------|----------|------------|-----------|---------|\n`;

		for (const error of errors) {
			content += `| ${error.type} | ${error.severity ?? "unknown"} | ${error.collection ?? "N/A"} | ${error.operation ?? "N/A"} | ${error.message} |\n`;
		}

		return content;
	}

	private buildOperationStatsSection(metrics: DatabaseMetrics): string {
		const ops = metrics.operationStats;
		const locks = metrics.lockStats;

		if (!ops) {
			return "";
		}

		let content = `## Operation Statistics\n\n`;

		content += `### Operations Per Second\n\n`;
		content += `| Operation | Rate/sec |\n`;
		content += `|-----------|----------|\n`;
		content += `| Queries | ${ops.queriesPerSec} |\n`;
		content += `| Inserts | ${ops.insertsPerSec} |\n`;
		content += `| Updates | ${ops.updatesPerSec} |\n`;
		content += `| Deletes | ${ops.deletesPerSec} |\n`;
		content += `| Getmore | ${ops.getmorePerSec} |\n`;
		content += `| Commands | ${ops.commandsPerSec} |\n`;
		content += `| **Total** | **${ops.totalOpsPerSec}** |\n\n`;

		content += `**Read/Write Ratio:** ${ops.readWriteRatio}\n`;

		if (locks) {
			content += `\n### Lock Statistics\n\n`;
			content += `| Metric | Value |\n`;
			content += `|--------|-------|\n`;
			content += `| Active Readers | ${locks.activeReaders} |\n`;
			content += `| Active Writers | ${locks.activeWriters} |\n`;
			content += `| Queue (Readers) | ${locks.currentQueueReaders} |\n`;
			content += `| Queue (Writers) | ${locks.currentQueueWriters} |\n`;

			if (locks.currentQueueReaders > 0 || locks.currentQueueWriters > 0) {
				content += `\n⚠️ **Warning:** Lock queue is not empty. This may indicate contention.\n`;
			}
		}

		return content;
	}

	private buildTTLIndexSection(ttlIndexes: TTLIndexInfo[]): string {
		let content = `## TTL Index Analysis\n\n`;

		content += `Found ${ttlIndexes.length} TTL index(es) for automatic document expiration:\n\n`;
		content += `| Collection | Index | Field | Expires After |\n`;
		content += `|------------|-------|-------|---------------|\n`;

		for (const ttl of ttlIndexes) {
			content += `| ${ttl.collection} | ${ttl.indexName} | ${ttl.field} | ${ttl.expireAfterFormatted} |\n`;
		}

		content += `\n### TTL Index Best Practices\n`;
		content += `- TTL indexes run every 60 seconds by default\n`;
		content += `- Deletions may lag during high load\n`;
		content += `- Monitor the TTL field for correct Date types\n`;

		return content;
	}

	private buildDocumentSizeSection(
		distributions: DocumentSizeDistribution[],
	): string {
		let content = `## Document Size Analysis\n\n`;

		for (const dist of distributions) {
			content += `### ${dist.collection}\n\n`;
			content += `| Metric | Value |\n`;
			content += `|--------|-------|\n`;
			content += `| Sample Size | ${dist.sampleSize} docs |\n`;
			content += `| Average Size | ${dist.avgDocSizeFormatted} |\n`;
			content += `| Min Size | ${formatBytes(dist.minDocSize)} |\n`;
			content += `| Max Size | ${formatBytes(dist.maxDocSize)} |\n`;
			content += `| Median Size | ${formatBytes(dist.medianDocSize)} |\n\n`;

			content += `**Size Distribution:**\n\n`;
			content += `| Bucket | Count | Percentage |\n`;
			content += `|--------|-------|------------|\n`;
			for (const bucket of dist.distribution) {
				const bar = "█".repeat(Math.ceil(bucket.percentage / 5));
				content += `| ${bucket.bucket} | ${bucket.count} | ${bar} ${bucket.percentage}% |\n`;
			}

			if (dist.oversizedCount > 0) {
				content += `\n⚠️ **Warning:** ${dist.oversizedCount} documents exceed 1 MB. Large documents can impact performance.\n`;
			}
			content += `\n`;
		}

		return content;
	}

	private buildWiredTigerSection(wt: WiredTigerStats): string {
		let content = `## WiredTiger Cache Statistics\n\n`;

		const usagePercent = (
			(wt.cacheUsedBytes / wt.cacheSizeBytes) *
			100
		).toFixed(1);
		const dirtyPercent = (
			(wt.cacheDirtyBytes / wt.cacheSizeBytes) *
			100
		).toFixed(1);

		content += `| Metric | Value | Status |\n`;
		content += `|--------|-------|--------|\n`;
		content += `| Cache Size | ${wt.cacheSize} | - |\n`;
		content += `| Cache Used | ${wt.cacheUsed} (${usagePercent}%) | ${this.getStatusBadge(100 - Number.parseFloat(usagePercent), 20, 5)} |\n`;
		content += `| Cache Dirty | ${wt.cacheDirty} (${dirtyPercent}%) | ${this.getStatusBadge(100 - Number.parseFloat(dirtyPercent), 80, 50)} |\n`;
		content += `| Cache Hit Ratio | ${wt.cacheHitRatio}% | ${this.getStatusBadge(wt.cacheHitRatio, 95, 90)} |\n`;
		content += `| Pages Read | ${wt.pagesRead.toLocaleString()} | - |\n`;
		content += `| Pages Written | ${wt.pagesWritten.toLocaleString()} | - |\n`;
		content += `| Bytes Read | ${formatBytes(wt.bytesRead)} | - |\n`;
		content += `| Bytes Written | ${formatBytes(wt.bytesWritten)} | - |\n`;

		if (wt.evictedPages !== undefined) {
			content += `| Evicted Pages | ${wt.evictedPages.toLocaleString()} | - |\n`;
		}

		if (wt.checkpointTime !== undefined) {
			content += `| Last Checkpoint | ${wt.checkpointTime}ms | - |\n`;
		}

		if (Number.parseFloat(usagePercent) > 95) {
			content += `\n⚠️ **Warning:** Cache usage is very high. Consider increasing WiredTiger cache size.\n`;
		}

		return content;
	}

	private buildReplicaSetSection(rs: ReplicaSetStatus): string {
		let content = `## Replica Set Status\n\n`;

		content += `**Set Name:** ${rs.set}\n`;
		content += `**Term:** ${rs.term ?? "N/A"}\n`;
		content += `**Heartbeat Interval:** ${rs.heartbeatIntervalMs ?? 2000}ms\n\n`;

		content += `### Members\n\n`;
		content += `| Name | State | Health | Ping | Replication Lag |\n`;
		content += `|------|-------|--------|------|------------------|\n`;

		for (const member of rs.members) {
			const health = member.health === 1 ? "✅ Healthy" : "❌ Unhealthy";
			const ping = member.pingMs !== undefined ? `${member.pingMs}ms` : "N/A";
			let lag = "N/A";

			if (member.stateStr === "PRIMARY") {
				lag = "Primary";
			} else if (member.replicationLagSeconds !== undefined) {
				if (member.replicationLagSeconds < 1) {
					lag = "< 1s ✅";
				} else if (member.replicationLagSeconds < 10) {
					lag = `${member.replicationLagSeconds.toFixed(1)}s ⚠️`;
				} else {
					lag = `${member.replicationLagSeconds.toFixed(1)}s ❌`;
				}
			}

			content += `| ${member.name} | ${member.stateStr} | ${health} | ${ping} | ${lag} |\n`;
		}

		// Check for replication issues
		const unhealthyMembers = rs.members.filter((m) => m.health !== 1);
		const laggyMembers = rs.members.filter(
			(m) =>
				m.replicationLagSeconds !== undefined && m.replicationLagSeconds > 10,
		);

		if (unhealthyMembers.length > 0) {
			content += `\n❌ **Alert:** ${unhealthyMembers.length} member(s) are unhealthy!\n`;
		}

		if (laggyMembers.length > 0) {
			content += `\n⚠️ **Warning:** ${laggyMembers.length} member(s) have high replication lag (>10s)\n`;
		}

		return content;
	}

	private buildConnectionStatsSection(conn: ConnectionStats): string {
		let content = `## Connection Analysis\n\n`;

		const usagePercent = (
			(conn.current / (conn.current + conn.available)) *
			100
		).toFixed(1);

		content += `| Metric | Value |\n`;
		content += `|--------|-------|\n`;
		content += `| Current Connections | ${conn.current} |\n`;
		content += `| Available Connections | ${conn.available} |\n`;
		content += `| Active Connections | ${conn.active} |\n`;
		content += `| Total Created | ${conn.totalCreated.toLocaleString()} |\n`;
		content += `| Usage | ${usagePercent}% |\n\n`;

		if (conn.byClient.length > 0) {
			content += `### Connections by Client\n\n`;
			content += `| Client | Count | Percentage |\n`;
			content += `|--------|-------|------------|\n`;

			const total = conn.byClient.reduce((a, b) => a + b.count, 0);
			for (const client of conn.byClient.slice(0, 10)) {
				const pct = ((client.count / total) * 100).toFixed(1);
				content += `| ${client.client.substring(0, 50)} | ${client.count} | ${pct}% |\n`;
			}

			if (conn.byClient.length > 10) {
				content += `\n*... and ${conn.byClient.length - 10} more clients*\n`;
			}
		}

		return content;
	}

	private calculateHealthIndicators(report: AnalysisReport): {
		score: number;
		issues: string[];
	} {
		const health = calculateHealthScore({
			metrics: report.metrics,
			unusedIndexesCount: report.unusedIndexes.length,
			missingIndexesCount: report.missingIndexes.length,
			slowQueriesCount: report.slowQueries.length,
			fragmentedCollectionsCount: report.fragmentedCollections.length,
		});

		return { score: health.score, issues: health.issues };
	}

	private getHealthEmoji(score: number): string {
		if (score >= 90) return "OK";
		if (score >= 70) return "GOOD";
		if (score >= 50) return "WARN";
		return "CRITICAL";
	}

	private getStatusBadge(value: number, good: number, warn: number): string {
		if (value >= good) return "Good";
		if (value >= warn) return "Warning";
		return "Critical";
	}

	printSummary(report: AnalysisReport): void {
		const health = this.calculateHealthIndicators(report);

		console.log(`\n${"=".repeat(60)}`);
		console.log("DATABASE ANALYSIS SUMMARY");
		console.log("=".repeat(60));
		console.log(`\nDatabase: ${report.databaseName}`);
		console.log(
			`Health Score: ${health.score}/100 ${this.getHealthEmoji(health.score)}`,
		);
		console.log(`\nKey Metrics:`);
		console.log(`  - Database Size: ${report.metrics.databaseSize}`);
		console.log(`  - Storage Size: ${report.metrics.storageSize}`);
		console.log(`  - Index Size: ${report.metrics.indexSize}`);
		console.log(`  - Cache Hit Ratio: ${report.metrics.cacheHitRatio}%`);
		console.log(`  - Collections: ${report.metrics.collections}`);
		console.log(`  - Documents: ${report.metrics.documents.toLocaleString()}`);

		console.log(`\nFindings:`);
		console.log(`  - Unused Indexes: ${report.unusedIndexes.length}`);
		console.log(
			`  - Query Patterns Needing Indexes: ${report.missingIndexes.length}`,
		);
		console.log(`  - Duplicate Indexes: ${report.duplicateIndexes.length}`);
		console.log(`  - Slow Queries: ${report.slowQueries.length}`);
		console.log(
			`  - Fragmented Collections: ${report.fragmentedCollections.length}`,
		);

		if (report.recommendations.length > 0) {
			console.log(`\nTop Recommendations:`);
			for (const rec of report.recommendations.slice(0, 5)) {
				console.log(`  - ${rec}`);
			}
		}

		console.log(`\n${"=".repeat(60)}`);
	}
}
