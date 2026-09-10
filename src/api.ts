import { type Db, MongoClient } from "mongodb";
import { buildFullReport } from "./cli/runner";
import {
	buildConnectionUri,
	parseDatabaseFromConnectionString,
} from "./connection";
import { DEFAULTS } from "./constants";
import { ReportGenerator } from "./reporters/report-generator";
import type {
	AnalysisReport,
	AnalyzerOptions,
	CompactSummary,
	ThresholdOverrides,
} from "./types";
import type { HealthScoreResult } from "./utils/health";
import { calculateHealthScore } from "./utils/health";

/** Connection and analysis settings for {@link MongoAnalyzer}. */
export interface MongoAnalyzerOptions {
	/** A full `mongodb://` or `mongodb+srv://` URI, taking precedence over the fields below. */
	uri?: string;
	/** Host name. Defaults to `localhost`. */
	host?: string;
	/** Port. Defaults to `27017`. */
	port?: number;
	/** Database name. Inferred from {@link uri} when it carries one; otherwise `test`. */
	database?: string;
	/** User name, if the deployment requires authentication. */
	user?: string;
	/** Password, if the deployment requires authentication. */
	password?: string;
	/** Authentication database. Defaults to `admin`. */
	authSource?: string;
	/** Restrict analysis to these collections. */
	collections?: string[];
	/** Directory that {@link MongoAnalyzer.generateReport} writes into. Defaults to `./reports`. */
	outputDir?: string;
	/** Operations slower than this many milliseconds are reported. Defaults to `100`. */
	slowQueryThresholdMs?: number;
	/** Below this many accesses an index is considered unused. Defaults to `50`. */
	minIndexAccesses?: number;
	/** Documents to sample per collection when inferring a schema. Defaults to `1000`. */
	schemaSampleSize?: number;
	/** Override the built-in health thresholds. */
	thresholds?: ThresholdOverrides;
	/**
	 * Use this client instead of creating one. The caller keeps ownership: `close()` will
	 * not disconnect a client it did not create.
	 */
	client?: MongoClient;
}

/**
 * Programmatic entry point for the MongoDB analyzer.
 *
 * Importing this module has no side effects — unlike the CLI entry point, which connects and
 * runs an analysis on import. Always `close()` when finished, ideally in a `finally`.
 *
 * ```ts
 * import { MongoAnalyzer } from "@deniscuciuc/mongo-analyzer";
 *
 * const analyzer = new MongoAnalyzer({ uri: process.env.MONGO_URI, database: "app" });
 * try {
 *   const report = await analyzer.analyze();
 *   console.log(analyzer.healthScore(report));
 * } finally {
 *   await analyzer.close();
 * }
 * ```
 */
export class MongoAnalyzer {
	private readonly uri: string;
	private readonly databaseName: string;
	private readonly analyzerOptions: AnalyzerOptions;
	private readonly ownsClient: boolean;
	private client: MongoClient | undefined;
	private db: Db | undefined;

	constructor(options: MongoAnalyzerOptions = {}) {
		this.databaseName =
			options.database ??
			(options.uri
				? parseDatabaseFromConnectionString(options.uri)
				: undefined) ??
			DEFAULTS.database;

		this.uri = buildConnectionUri({
			uri: options.uri,
			host: options.host ?? DEFAULTS.host,
			port: options.port ?? DEFAULTS.port,
			database: this.databaseName,
			user: options.user,
			password: options.password,
			authSource: options.authSource ?? DEFAULTS.authSource,
		});

		this.analyzerOptions = {
			slowQueryThresholdMs:
				options.slowQueryThresholdMs ?? DEFAULTS.slowQueryThreshold,
			minIndexAccesses: options.minIndexAccesses ?? DEFAULTS.minIndexAccesses,
			schemaSampleSize: options.schemaSampleSize ?? DEFAULTS.schemaSampleSize,
			outputDir: options.outputDir ?? DEFAULTS.output,
			collections: options.collections,
			thresholds: options.thresholds,
		};

		this.client = options.client;
		this.ownsClient = options.client === undefined;
	}

	/**
	 * Connects to MongoDB. Called automatically by {@link analyze}; call it directly to
	 * surface a connection failure before doing any work.
	 */
	async connect(): Promise<void> {
		if (this.db) {
			return;
		}

		if (!this.client) {
			this.client = new MongoClient(this.uri);
			// The driver emits 'error' on topology failures; with no listener Node treats it
			// as an unhandled error event and terminates the process.
			this.client.on("error", () => {});
		}

		try {
			await this.client.connect();
			this.db = this.client.db(this.databaseName);
			await this.db.command({ ping: 1 });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Cannot connect to MongoDB: ${message}`);
		}
	}

	/** Runs a full analysis and returns the report. */
	async analyze(): Promise<AnalysisReport> {
		await this.connect();

		return buildFullReport(
			this.requireClient(),
			this.requireDb(),
			this.analyzerOptions,
		);
	}

	/** Computes the health score for a report, with its status and the issues found. */
	healthScore(report: AnalysisReport): HealthScoreResult {
		return calculateHealthScore(report, this.analyzerOptions.thresholds);
	}

	/**
	 * Runs `compact` on the collections that are fragmented enough to benefit.
	 *
	 * This changes server state and, on older MongoDB versions, blocks the database — which
	 * is why it is a separate method rather than part of {@link analyze}.
	 */
	async compact(): Promise<CompactSummary> {
		await this.connect();

		const { CollectionAnalyzer } = await import(
			"./analyzers/collection-analyzer"
		);
		const collections = new CollectionAnalyzer(
			this.requireDb(),
			this.analyzerOptions,
		);

		return collections.autoCompact({});
	}

	/**
	 * Writes a report to {@link MongoAnalyzerOptions.outputDir}.
	 *
	 * @param format Output format. Defaults to `markdown`.
	 * @param report A report from {@link analyze}; one is generated if omitted.
	 * @returns The path of the file written.
	 */
	async generateReport(
		format: "markdown" | "json" | "html" = "markdown",
		report?: AnalysisReport,
	): Promise<string> {
		const resolved = report ?? (await this.analyze());
		const generator = new ReportGenerator(
			this.analyzerOptions.outputDir ?? DEFAULTS.output,
			this.analyzerOptions,
		);

		switch (format) {
			case "json":
				return generator.generateJsonReport(resolved);
			case "html":
				return generator.generateHtmlReport(resolved);
			default:
				return generator.generateFullReport(resolved);
		}
	}

	/**
	 * Closes the connection. Does nothing when the client was supplied by the caller, who
	 * retains ownership of it.
	 */
	async close(): Promise<void> {
		this.db = undefined;

		if (!this.client || !this.ownsClient) {
			return;
		}

		const client = this.client;
		this.client = undefined;
		await client.close();
	}

	private requireClient(): MongoClient {
		if (!this.client) {
			throw new Error("Not connected. Call connect() first.");
		}
		return this.client;
	}

	private requireDb(): Db {
		if (!this.db) {
			throw new Error("Not connected. Call connect() first.");
		}
		return this.db;
	}
}
