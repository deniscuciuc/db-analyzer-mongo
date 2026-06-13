import { getThresholds } from "../config/thresholds";
import type { AnalysisReport, ThresholdOverrides } from "../types";

// biome-ignore lint/complexity/noStaticOnlyClass: grouped HTML rendering helpers keep the report template readable.
export class HtmlReporter {
	static generate(
		report: AnalysisReport,
		thresholdOverrides?: ThresholdOverrides,
	): string {
		const thresholds = getThresholds(thresholdOverrides);

		return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MongoDB Analysis Report</title>
    <style>
      :root {
        --color-ok: #166534;
        --color-warn: #854d0e;
        --color-high: #9a3412;
        --color-critical: #991b1b;
        --color-bg: #f8fafc;
        --color-surface: #ffffff;
        --color-border: #cbd5e1;
        --color-text: #0f172a;
        --color-muted: #475569;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --color-bg: #020617;
          --color-surface: #0f172a;
          --color-border: #334155;
          --color-text: #e2e8f0;
          --color-muted: #94a3b8;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--color-bg);
        color: var(--color-text);
        line-height: 1.5;
      }
      header, main { width: min(1200px, calc(100% - 2rem)); margin: 0 auto; }
      header { padding: 2rem 0 1rem; }
      nav {
        position: sticky;
        top: 0;
        z-index: 20;
        background: color-mix(in srgb, var(--color-bg) 92%, transparent);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--color-border);
        margin-bottom: 1rem;
      }
      nav ul {
        width: min(1200px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 0.75rem 0;
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      nav a { color: var(--color-muted); text-decoration: none; }
      nav a:hover { color: var(--color-text); }
      .badge, .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border-radius: 999px;
        padding: 0.25rem 0.75rem;
        font-size: 0.85rem;
        font-weight: 700;
      }
      .badge-score-ok, .badge-low { background: #dcfce7; color: #166534; }
      .badge-score-warn, .badge-medium { background: #fef9c3; color: #854d0e; }
      .badge-score-high, .badge-high { background: #ffedd5; color: #9a3412; }
      .badge-score-critical, .badge-critical { background: #fee2e2; color: #991b1b; }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
        margin: 1.5rem 0;
      }
      .card, section {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 1rem;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      .card { padding: 1rem; }
      .card h3, section h2 { margin: 0 0 0.5rem; }
      .card p { margin: 0; color: var(--color-muted); }
      section { margin: 0 0 1rem; overflow: hidden; }
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--color-border);
      }
      .section-body { padding: 1.25rem; }
      .section-toggle {
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-text);
        border-radius: 999px;
        padding: 0.4rem 0.8rem;
        cursor: pointer;
      }
      .table-wrap { overflow-x: auto; }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 640px;
      }
      th, td {
        text-align: left;
        padding: 0.75rem;
        border-bottom: 1px solid var(--color-border);
        vertical-align: top;
      }
      th {
        position: sticky;
        top: 0;
        background: var(--color-surface);
        cursor: pointer;
      }
      tbody tr:nth-child(even) { background: color-mix(in srgb, var(--color-surface) 92%, var(--color-border)); }
      .muted { color: var(--color-muted); }
      .list { margin: 0; padding-left: 1.25rem; }
      .list li + li { margin-top: 0.5rem; }
      .meta { display: flex; flex-wrap: wrap; gap: 1rem; color: var(--color-muted); }
      @media (max-width: 640px) {
        header, main, nav ul { width: calc(100% - 1rem); }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="meta">
        <strong>${HtmlReporter.escapeHtml(report.databaseName)}</strong>
        <span>Generated ${HtmlReporter.escapeHtml(new Date(report.generatedAt).toISOString())}</span>
      </div>
      <h1>MongoDB Analysis Report</h1>
      <span class="badge ${HtmlReporter.getHealthBadgeClass(report.healthScore)}">Health score: ${report.healthScore}/100</span>
      <div class="summary-grid">
        ${HtmlReporter.summaryCard("Database Size", report.metrics.databaseSize)}
        ${HtmlReporter.summaryCard("Cache Hit Ratio", `${report.metrics.cacheHitRatio}%`, HtmlReporter.getCacheStatus(report.metrics.cacheHitRatio, thresholds))}
        ${HtmlReporter.summaryCard("Collections", String(report.metrics.collections))}
        ${HtmlReporter.summaryCard("Documents", report.metrics.documents.toLocaleString())}
        ${HtmlReporter.summaryCard("Indexes", String(report.metrics.indexes))}
        ${HtmlReporter.summaryCard("Active Connections", String(report.metrics.activeConnections))}
      </div>
    </header>
    <nav>
      <ul>
        <li><a href="#summary">Summary</a></li>
        <li><a href="#indexes">Indexes</a></li>
        <li><a href="#queries">Queries</a></li>
        <li><a href="#collections">Collections</a></li>
        <li><a href="#recommendations">Recommendations</a></li>
      </ul>
    </nav>
    <main>
      ${HtmlReporter.section(
				"summary",
				"Summary",
				`
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th data-sortable>Metric</th>
                  <th data-sortable>Value</th>
                  <th data-sortable>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Cache hit ratio</td><td>${report.metrics.cacheHitRatio}%</td><td>${HtmlReporter.statusBadge(HtmlReporter.getCacheStatus(report.metrics.cacheHitRatio, thresholds))}</td></tr>
                <tr><td>Current connections</td><td>${report.metrics.currentConnections}</td><td>${HtmlReporter.statusBadge("good", "Informational")}</td></tr>
                <tr><td>Unused indexes</td><td>${report.unusedIndexes.length}</td><td>${HtmlReporter.statusBadge(report.unusedIndexes.length > 10 ? "critical" : report.unusedIndexes.length > 0 ? "warning" : "good")}</td></tr>
                <tr><td>Fragmented collections</td><td>${report.fragmentedCollections.length}</td><td>${HtmlReporter.statusBadge(report.fragmentedCollections.length > 5 ? "critical" : report.fragmentedCollections.length > 0 ? "warning" : "good")}</td></tr>
              </tbody>
            </table>
          </div>
        `,
			)}
      ${HtmlReporter.section(
				"indexes",
				"Indexes",
				`
          ${HtmlReporter.tableBlock(
						`Unused indexes (${report.unusedIndexes.length})`,
						["Collection", "Index", "Keys", "Size", "Accesses", "Status"],
						report.unusedIndexes.map((index) => [
							index.collection,
							index.name,
							index.keyPattern,
							index.size,
							String(index.accesses),
							index.usageStatus,
						]),
						"No unused indexes found.",
					)}
          ${HtmlReporter.tableBlock(
						`Missing indexes (${report.missingIndexes.length})`,
						[
							"Collection",
							"Frequency",
							"Avg time",
							"Benefit",
							"Suggested index",
						],
						report.missingIndexes.map((index) => [
							index.collection,
							String(index.frequency),
							`${index.avgExecutionTime} ms`,
							index.estimatedBenefit,
							index.suggestedIndex,
						]),
						"No missing indexes detected.",
					)}
          ${HtmlReporter.tableBlock(
						`Duplicate indexes (${report.duplicateIndexes.length})`,
						["Collection", "Index 1", "Index 2", "Recommendation"],
						report.duplicateIndexes.map((index) => [
							index.collection,
							index.index1,
							index.index2,
							index.recommendation,
						]),
						"No duplicate indexes found.",
					)}
        `,
			)}
      ${HtmlReporter.section(
				"queries",
				"Queries",
				`
          ${HtmlReporter.tableBlock(
						`Slow queries (${report.slowQueries.length})`,
						["Namespace", "Operation", "Count", "Avg time", "Plan", "Severity"],
						report.slowQueries.map((query) => [
							query.namespace,
							query.operation,
							String(query.executionCount),
							`${query.avgExecutionTime} ms`,
							query.planSummary,
							query.severity,
						]),
						"No slow queries captured. Ensure the profiler is enabled.",
					)}
          ${HtmlReporter.tableBlock(
						`Query anti-patterns (${report.queryAntiPatterns?.length ?? 0})`,
						["Pattern", "Severity", "Count", "Recommendation"],
						(report.queryAntiPatterns ?? []).map((pattern) => [
							pattern.pattern,
							pattern.severity,
							String(pattern.count),
							pattern.recommendation,
						]),
						"No query anti-patterns detected.",
					)}
        `,
			)}
      ${HtmlReporter.section(
				"collections",
				"Collections",
				`
          ${HtmlReporter.tableBlock(
						`Collection stats (${report.collectionStats.length})`,
						[
							"Collection",
							"Data size",
							"Storage size",
							"Index size",
							"Documents",
						],
						report.collectionStats.map((collection) => [
							collection.collection,
							collection.totalSize,
							collection.storageSize,
							collection.indexSize,
							collection.documentCount.toLocaleString(),
						]),
						"No collection stats available.",
					)}
          ${HtmlReporter.tableBlock(
						`Fragmented collections (${report.fragmentedCollections.length})`,
						[
							"Collection",
							"Storage size",
							"Data size",
							"Fragmentation",
							"Severity",
						],
						report.fragmentedCollections.map((collection) => [
							collection.collection,
							collection.storageSize,
							collection.dataSize,
							`${collection.fragmentationRatio}%`,
							collection.severity,
						]),
						"No fragmented collections found.",
					)}
          ${HtmlReporter.tableBlock(
						`Schema issues (${report.schemaIssues?.length ?? 0})`,
						["Collection", "Field", "Severity", "Issue"],
						(report.schemaIssues ?? []).map((issue) => [
							issue.collection,
							issue.field,
							issue.severity,
							issue.issue,
						]),
						"No schema issues detected.",
					)}
        `,
			)}
      ${HtmlReporter.section(
				"recommendations",
				"Recommendations",
				report.recommendations.length > 0
					? `<ol class="list">${report.recommendations
							.map(
								(recommendation) =>
									`<li>${HtmlReporter.statusBadge(HtmlReporter.inferRecommendationSeverity(recommendation))} ${HtmlReporter.escapeHtml(recommendation)}</li>`,
							)
							.join("")}</ol>`
					: '<p class="muted">No recommendations. Database appears healthy.</p>',
			)}
    </main>
    <script>
      document.querySelectorAll('.section-toggle').forEach((button) => {
        button.addEventListener('click', () => {
          const body = button.closest('section').querySelector('.section-body');
          body.hidden = !body.hidden;
          button.textContent = body.hidden ? '▶️ Show' : '▼ Hide';
        });
      });

      document.querySelectorAll('th[data-sortable]').forEach((header) => {
        header.addEventListener('click', () => {
          const table = header.closest('table');
          const tbody = table.querySelector('tbody');
          const rows = Array.from(tbody.querySelectorAll('tr'));
          const index = Array.from(header.parentElement.children).indexOf(header);
          const direction = header.dataset.direction === 'asc' ? 'desc' : 'asc';
          header.dataset.direction = direction;

          rows.sort((left, right) => {
            const leftValue = left.children[index].innerText.trim();
            const rightValue = right.children[index].innerText.trim();
            const leftNumber = Number.parseFloat(leftValue.replace(/[^0-9.-]/g, ''));
            const rightNumber = Number.parseFloat(rightValue.replace(/[^0-9.-]/g, ''));
            const useNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
            const comparison = useNumeric
              ? leftNumber - rightNumber
              : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' });
            return direction === 'asc' ? comparison : -comparison;
          });

          tbody.replaceChildren(...rows);
        });
      });
    </script>
  </body>
</html>`;
	}

	private static section(id: string, title: string, body: string): string {
		return `<section id="${id}">
      <div class="section-header">
        <h2>${HtmlReporter.escapeHtml(title)}</h2>
        <button class="section-toggle" type="button">▼ Hide</button>
      </div>
      <div class="section-body">${body}</div>
    </section>`;
	}

	private static summaryCard(
		label: string,
		value: string,
		status?: "good" | "warning" | "critical",
	): string {
		return `<div class="card">
      <h3>${HtmlReporter.escapeHtml(label)}</h3>
      <p>${HtmlReporter.escapeHtml(value)}</p>
      ${status ? HtmlReporter.statusBadge(status) : ""}
    </div>`;
	}

	private static tableBlock(
		title: string,
		headers: string[],
		rows: string[][],
		emptyMessage: string,
	): string {
		if (rows.length === 0) {
			return `<h3>${HtmlReporter.escapeHtml(title)}</h3><p class="muted">${HtmlReporter.escapeHtml(emptyMessage)}</p>`;
		}

		return `<h3>${HtmlReporter.escapeHtml(title)}</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${headers
							.map(
								(header) =>
									`<th data-sortable>${HtmlReporter.escapeHtml(header)}</th>`,
							)
							.join("")}</tr>
          </thead>
          <tbody>
            ${rows
							.map(
								(row) =>
									`<tr>${row
										.map(
											(value) => `<td>${HtmlReporter.escapeHtml(value)}</td>`,
										)
										.join("")}</tr>`,
							)
							.join("")}
          </tbody>
        </table>
      </div>`;
	}

	private static getHealthBadgeClass(score: number): string {
		if (score >= 90) return "badge-score-ok";
		if (score >= 70) return "badge-score-warn";
		if (score >= 50) return "badge-score-high";
		return "badge-score-critical";
	}

	private static getCacheStatus(
		value: number,
		thresholds: ReturnType<typeof getThresholds>,
	): "good" | "warning" | "critical" {
		if (value >= thresholds.cache.optimal) return "good";
		if (value >= thresholds.cache.acceptable) return "warning";
		return "critical";
	}

	private static statusBadge(
		status: "good" | "warning" | "critical",
		label?: string,
	): string {
		const className =
			status === "good"
				? "badge-low"
				: status === "warning"
					? "badge-medium"
					: "badge-critical";
		const text =
			label ??
			(status === "good"
				? "Good"
				: status === "warning"
					? "Warning"
					: "Critical");

		return `<span class="status-badge ${className}">${HtmlReporter.escapeHtml(text)}</span>`;
	}

	private static inferRecommendationSeverity(
		recommendation: string,
	): "good" | "warning" | "critical" {
		const lowerCaseRecommendation = recommendation.toLowerCase();
		if (
			lowerCaseRecommendation.includes("critical") ||
			lowerCaseRecommendation.includes("immediately")
		) {
			return "critical";
		}
		if (
			lowerCaseRecommendation.includes("high") ||
			lowerCaseRecommendation.includes("consider")
		) {
			return "warning";
		}
		return "good";
	}

	private static escapeHtml(value: string): string {
		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;");
	}
}
