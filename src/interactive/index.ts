import { existsSync, readFileSync } from "node:fs";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type { Db, MongoClient } from "mongodb";

import { CollectionAnalyzer } from "../analyzers/collection-analyzer";
import { IndexAnalyzer } from "../analyzers/index-analyzer";
import { QueryAnalyzer } from "../analyzers/query-analyzer";
import { SchemaAnalyzer } from "../analyzers/schema-analyzer";
import { buildFullReport, buildHealthSnapshot } from "../cli/runner";
import { StatsCollector } from "../collectors/stats-collector";
import { listProfiles, loadConfig } from "../config/loader";
import { FULL_ANALYSIS_COMMANDS } from "../constants";
import { DiffReporter } from "../reporters/diff-reporter";
import { ReportGenerator } from "../reporters/report-generator";
import type { AnalyzerOptions, FullReport } from "../types";
import { runWatchLoop } from "../watch/runner";
import * as display from "./display";
import {
	ANALYSIS_MENU_CHOICES,
	MAIN_MENU_CHOICES,
	MAINTENANCE_MENU_CHOICES,
	MODULE_CHOICES,
	REPORTS_MENU_CHOICES,
	SETTINGS_MENU_CHOICES,
	WATCH_COMMAND_CHOICES,
} from "./menus";

export class InteractiveCLI {
	private readonly config = loadConfig();
	private activeProfile?: string;
	private activeCollections?: string[];
	private indexes!: IndexAnalyzer;
	private queries!: QueryAnalyzer;
	private schema!: SchemaAnalyzer;
	private collections!: CollectionAnalyzer;
	private stats!: StatsCollector;
	private reporter!: ReportGenerator;

	constructor(
		private readonly client: MongoClient,
		private readonly db: Db,
		private readonly baseOptions: AnalyzerOptions = {},
	) {
		this.rebuildAnalyzers();
	}

	async start(): Promise<void> {
		console.clear();
		const info = await this.stats.getServerInfo();
		console.log(
			`\n  MongoDB Analyzer — ${this.db.databaseName} (${info.version})\n`,
		);

		let running = true;
		while (running) {
			const action = await select({
				message: "Main menu",
				choices: MAIN_MENU_CHOICES,
			});

			switch (action) {
				case "analysis":
					await this.analysisMenu();
					break;
				case "reports":
					await this.reportsMenu();
					break;
				case "watch":
					await this.watchMenu();
					break;
				case "maintenance":
					await this.maintenanceMenu();
					break;
				case "settings":
					await this.settingsMenu();
					break;
				case "exit":
					running = false;
					break;
			}
		}

		console.log("\n  Goodbye!\n");
	}

	private rebuildAnalyzers(): void {
		const options = this.getAnalyzerOptions();
		this.indexes = new IndexAnalyzer(this.db, options);
		this.queries = new QueryAnalyzer(this.db, options);
		this.schema = new SchemaAnalyzer(this.db, options);
		this.collections = new CollectionAnalyzer(this.db, options);
		this.stats = new StatsCollector(this.client, this.db, options);
		this.reporter = new ReportGenerator(
			options.outputDir ?? "./reports",
			options,
		);
	}

	private getAnalyzerOptions(): AnalyzerOptions {
		return {
			...this.baseOptions,
			collections: this.activeCollections ?? this.baseOptions.collections,
		};
	}

	private async analysisMenu(): Promise<void> {
		const choice = await select({
			message: "Run analysis",
			choices: ANALYSIS_MENU_CHOICES,
		});

		switch (choice) {
			case "full":
				await this.runFullAnalysis();
				break;
			case "health":
				await this.runModule("health");
				break;
			case "quick":
				await this.runQuickAnalysis();
				break;
			case "single":
				await this.runSingleModule();
				break;
			case "back":
				return;
		}
	}

	private async runFullAnalysis(): Promise<void> {
		console.log("\n  Running full analysis...\n");

		for (const command of FULL_ANALYSIS_COMMANDS) {
			console.log(`  ─── ${command} ───`);
			await this.runModule(command);
			console.log("");
		}
	}

	private async runQuickAnalysis(): Promise<void> {
		const selected = await checkbox({
			message: "Select modules to run:",
			choices: MODULE_CHOICES,
		});

		if (selected.length === 0) {
			console.log("  Nothing selected.");
			return;
		}

		for (const module of selected) {
			console.log(`\n  ─── ${module} ───`);
			await this.runModule(module);
		}
	}

	private async runSingleModule(): Promise<void> {
		const module = await select({
			message: "Select module:",
			choices: MODULE_CHOICES,
		});
		console.log("");
		await this.runModule(module);
	}

	private async runModule(module: string): Promise<void> {
		try {
			switch (module) {
				case "health": {
					const snapshot = await buildHealthSnapshot(
						this.client,
						this.db,
						this.getAnalyzerOptions(),
					);
					display.showHealth(snapshot.metrics, {
						score: snapshot.healthScore,
						status:
							snapshot.healthScore >= 90
								? "excellent"
								: snapshot.healthScore >= 75
									? "good"
									: snapshot.healthScore >= 60
										? "fair"
										: snapshot.healthScore >= 40
											? "poor"
											: "critical",
						issues: snapshot.issues,
					});
					break;
				}
				case "unused-indexes":
					display.showUnusedIndexes(await this.indexes.getUnusedIndexes());
					break;
				case "missing-indexes":
					display.showMissingIndexes(await this.indexes.getMissingIndexes());
					break;
				case "duplicate-indexes":
					display.showDuplicateIndexes(
						await this.indexes.getDuplicateIndexes(),
					);
					break;
				case "slow-queries":
					display.showSlowQueries(await this.queries.getSlowQueries());
					break;
				case "query-stats":
					display.showQueryStats(await this.queries.getAllQueryStats(5, 10));
					break;
				case "query-antipatterns":
					display.showQueryAntiPatterns(
						await this.queries.detectQueryAntiPatterns(),
					);
					break;
				case "schema":
					display.showSchemaOverview(
						await this.schema.analyzeAllSchemas(
							this.getAnalyzerOptions().schemaSampleSize,
						),
					);
					break;
				case "schema-issues":
					display.showSchemaIssues(
						await this.schema.findSchemaIssues(
							this.getAnalyzerOptions().schemaSampleSize,
						),
					);
					break;
				case "current-ops":
					display.showCurrentOperations(
						await this.queries.getCurrentOperations(),
					);
					break;
				case "long-running":
					display.showLongRunning(await this.queries.getLongRunningQueries());
					break;
				case "blocking":
					display.showBlocking(await this.queries.getBlockingOperations());
					break;
				case "collections":
					display.showCollectionStats(
						await this.collections.getCollectionStats(),
					);
					break;
				case "largest-collections":
					display.showCollectionStats(
						await this.collections.getLargestCollections(10),
					);
					break;
				case "compact-needed":
					display.showCompactNeeded(
						await this.collections.getCollectionsNeedingCompact(),
					);
					break;
				case "connections":
					display.showConnections(await this.stats.getConnectionStats());
					break;
				case "server-info":
					display.showServerInfo(await this.stats.getServerInfo());
					break;
				case "replica-set":
					display.showReplicaSet(await this.stats.getReplicaSetStatus());
					break;
				case "sharding":
					display.showSharding(await this.stats.getShardingStatus());
					break;
				case "wiredtiger":
					display.showWiredTiger(await this.stats.getWiredTigerStats());
					break;
				case "oplog":
					display.showOplog(await this.stats.getOplogStats());
					break;
				case "config":
					display.showConfig(await this.stats.getConfigurationSettings());
					break;
				case "profiler-status":
					display.showProfilerStatus(await this.queries.checkProfilerEnabled());
					break;
			}
		} catch (error) {
			console.log(`  ❌ Error: ${error}`);
		}
	}

	private async reportsMenu(): Promise<void> {
		const choice = await select({
			message: "Generate report",
			choices: REPORTS_MENU_CHOICES,
		});

		if (choice === "back") {
			return;
		}

		console.log("\n  Collecting data...");
		const report = await buildFullReport(
			this.client,
			this.db,
			this.getAnalyzerOptions(),
		);

		if (choice === "markdown" || choice === "html") {
			const markdownPath = await this.reporter.generateFullReport(report);
			const jsonPath = await this.reporter.generateJsonReport(report);
			console.log(`  ✅ Markdown: ${markdownPath}`);
			console.log(`  ✅ JSON:     ${jsonPath}`);

			if (choice === "html") {
				const htmlPath = await this.reporter.generateHtmlReport(report);
				console.log(`  ✅ HTML:     ${htmlPath}`);
			}
		}

		if (choice === "diff") {
			const previousPath = await input({
				message: "Path to previous JSON report:",
				validate: (value) => (existsSync(value) ? true : "File not found"),
			});
			const previous = loadPreviousReport(previousPath);
			DiffReporter.print(DiffReporter.diff(report, previous));
		}
	}

	private async watchMenu(): Promise<void> {
		const command = await select({
			message: "Command to watch:",
			choices: WATCH_COMMAND_CHOICES,
		});
		const interval = await input({
			message: "Refresh interval in seconds:",
			default: "30",
			validate: (value) =>
				Number(value) > 0 ? true : "Must be a positive number",
		});

		console.log("  Starting watch mode. Press Ctrl+C to stop.\n");

		await runWatchLoop({
			intervalSeconds: Number(interval),
			command,
			runCommand: () => this.runModule(command),
		});
	}

	private async maintenanceMenu(): Promise<void> {
		const choice = await select({
			message: "Maintenance",
			choices: MAINTENANCE_MENU_CHOICES,
		});

		switch (choice) {
			case "run-compact":
				await this.runCompactFlow();
				break;
			case "enable-profiler":
				await this.setProfiler(true);
				break;
			case "disable-profiler":
				await this.setProfiler(false);
				break;
			case "back":
				return;
		}
	}

	private async runCompactFlow(): Promise<void> {
		const collections = await this.collections.getCollectionsNeedingCompact();
		if (collections.length === 0) {
			console.log("  ✅ No collections need compact");
			return;
		}

		display.showCompactNeeded(collections);
		const shouldProceed = await confirm({
			message: `Run compact on ${collections.length} collections?`,
			default: false,
		});
		if (!shouldProceed) {
			console.log("  Skipped.");
			return;
		}

		console.log("\n  Running compact...\n");
		const summary = await this.collections.autoCompact({
			onProgress: (result, index, total) => {
				const status = result.success ? "OK" : "FAIL";
				console.log(`  [${index}/${total}] ${status} ${result.collection}`);
				if (!result.success && result.error) {
					console.log(`    Error: ${result.error}`);
				}
			},
		});

		console.log(
			`  ✅ Done: ${summary.successful}/${summary.totalCollections} — ${summary.totalDuration}ms`,
		);
		console.log(`  Freed: ${summary.totalBytesFreedFormatted}`);
		if (summary.failed > 0) {
			console.log(`  ⚠️  Failed: ${summary.failed}`);
		}
	}

	private async setProfiler(enable: boolean): Promise<void> {
		const status = await this.queries.checkProfilerEnabled();
		if (enable && status.level > 0) {
			console.log(
				`  ✅ Profiler already enabled at level ${status.level} with slowms=${status.slowMs}`,
			);
			return;
		}
		if (!enable && status.level === 0) {
			console.log("  ✅ Profiler is already disabled");
			return;
		}

		const shouldProceed = await confirm({
			message: enable
				? "Enable profiler for slow queries (>100ms)?"
				: "Disable profiler?",
			default: enable,
		});
		if (!shouldProceed) {
			console.log("  Skipped.");
			return;
		}

		const result = enable
			? await this.queries.enableProfiler(1, 100)
			: await this.queries.disableProfiler();
		console.log(`  ${result.success ? "✅" : "❌"} ${result.message}`);
	}

	private async settingsMenu(): Promise<void> {
		const choice = await select({
			message: "Settings",
			choices: SETTINGS_MENU_CHOICES,
		});

		switch (choice) {
			case "profile": {
				const profiles = listProfiles(this.config);
				if (profiles.length === 0) {
					console.log("  ⚠️  No profiles found in .analyzerrc.json");
					break;
				}
				const selectedProfile = await select({
					message: "Select profile:",
					choices: [
						...profiles.map((profile) => ({ name: profile, value: profile })),
						{ name: "(none — use env/flags)", value: "" },
					],
				});
				this.activeProfile = selectedProfile || undefined;
				console.log(
					`  ✅ Profile set to "${this.activeProfile ?? "none"}". Restart the tool to apply connection changes.`,
				);
				break;
			}
			case "collections": {
				const value = await input({
					message: "Collection names (comma-separated, blank = all):",
					default: this.activeCollections?.join(", ") ?? "",
				});
				this.activeCollections = parseList(value);
				this.rebuildAnalyzers();
				console.log(
					`  ✅ Collection filter: ${this.activeCollections?.join(", ") ?? "(all)"}`,
				);
				break;
			}
			case "show":
				display.showCurrentSettings(this.activeProfile, this.activeCollections);
				break;
			case "back":
				return;
		}
	}
}

function parseList(value: string): string[] | undefined {
	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

	return items.length > 0 ? items : undefined;
}

function loadPreviousReport(path: string): FullReport {
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"report" in parsed &&
		parsed.report
	) {
		return parsed.report as FullReport;
	}

	return parsed as FullReport;
}
