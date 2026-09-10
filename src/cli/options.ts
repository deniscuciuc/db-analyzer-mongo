import { DEFAULTS } from "../constants";
import type { AnalyzerOptions } from "../types";

export interface ParsedOptions extends AnalyzerOptions {
	uri?: string;
	host: string;
	port: number;
	database: string;
	user?: string;
	password?: string;
	authSource: string;
	profile?: string;
	config?: string;
	collections?: string[];
	compare?: string;
	html: boolean;
	watch?: number;
	command: string;
	json: boolean;
	quiet: boolean;
	outputDir: string;
	slowQueryThreshold: number;
	minIndexAccesses: number;
	interactive: boolean;
	yes: boolean;
	dryRun: boolean;
}

export function parseOptions(argv = process.argv.slice(2)): ParsedOptions {
	const options: ParsedOptions = {
		host: DEFAULTS.host,
		port: DEFAULTS.port,
		database: DEFAULTS.database,
		authSource: DEFAULTS.authSource,
		command: "full",
		json: false,
		quiet: false,
		html: false,
		outputDir: DEFAULTS.output,
		slowQueryThreshold: DEFAULTS.slowQueryThreshold,
		minIndexAccesses: DEFAULTS.minIndexAccesses,
		interactive: false,
		yes: false,
		dryRun: false,
	};

	for (let index = 0; index < argv.length; index++) {
		switch (argv[index]) {
			case "--uri":
				options.uri = requireValue("--uri", argv[++index]);
				break;
			case "--host":
			case "-h":
				options.host = requireValue("--host", argv[++index]);
				break;
			case "--port":
			case "-p":
				options.port = parseNumericFlag("--port", argv[++index]);
				break;
			case "--database":
			case "-d":
				options.database = requireValue("--database", argv[++index]);
				break;
			case "--user":
			case "-U":
				options.user = requireValue("--user", argv[++index]);
				break;
			case "--password":
			case "-W":
				options.password = requireValue("--password", argv[++index]);
				break;
			case "--authSource":
				options.authSource = requireValue("--authSource", argv[++index]);
				break;
			case "--output":
			case "-o":
				options.outputDir = requireValue("--output", argv[++index]);
				break;
			case "--profile":
				options.profile = requireValue("--profile", argv[++index]);
				break;
			case "--config":
				options.config = requireValue("--config", argv[++index]);
				break;
			case "--collections":
				options.collections = parseList(argv[++index]);
				break;
			case "--compare":
				options.compare = requireValue("--compare", argv[++index]);
				break;
			case "--yes":
			case "-y":
				options.yes = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--html":
				options.html = true;
				break;
			case "--watch": {
				const nextValue = argv[index + 1];
				// A bare "-" prefix is not enough to tell a flag from a negative number:
				// `--watch -1` used to be read as a flag and silently fall back to the
				// default instead of being rejected.
				if (nextValue !== undefined && /^-?\d+$/.test(nextValue)) {
					options.watch = Number.parseInt(nextValue, 10);
					index++;
				} else {
					options.watch = DEFAULTS.watchInterval;
				}
				break;
			}
			case "--slow-query-threshold":
				options.slowQueryThreshold = parseNumericFlag(
					"--slow-query-threshold",
					argv[++index],
				);
				break;
			case "--schema-sample-size":
				options.schemaSampleSize = parseNumericFlag(
					"--schema-sample-size",
					argv[++index],
				);
				break;
			case "--min-index-accesses":
				options.minIndexAccesses = parseNumericFlag(
					"--min-index-accesses",
					argv[++index],
				);
				break;
			case "--help":
				printHelp();
				process.exit(0);
				return options;
			case "--json":
			case "-j":
				options.json = true;
				break;
			case "--quiet":
			case "-q":
				options.quiet = true;
				break;
			case "--command":
			case "-c":
				options.command = requireValue("--command", argv[++index]);
				break;
			case "--interactive":
			case "-i":
			case "start":
				options.interactive = true;
				break;
			default: {
				// Previously ignored, so a typo like --jsno silently produced human output.
				const token = argv[index];
				if (token?.startsWith("-")) {
					throw new Error(
						`Unknown option: ${token}. Run --help for the list of options.`,
					);
				}
				break;
			}
		}
	}

	if (options.watch !== undefined) {
		if (!Number.isFinite(options.watch) || options.watch <= 0) {
			throw new Error(`Invalid watch interval: ${options.watch}`);
		}
	}

	return options;
}

export function toAnalyzerOptions(options: ParsedOptions): AnalyzerOptions {
	return {
		slowQueryThresholdMs: options.slowQueryThreshold,
		minIndexAccesses: options.minIndexAccesses,
		topQueriesLimit: 50,
		outputDir: options.outputDir,
		collections: options.collections,
		thresholds: options.thresholds,
		schemaSampleSize: options.schemaSampleSize,
	};
}

/**
 * Parses a numeric flag value, rejecting a missing or non-numeric one.
 *
 * `Number.parseInt` returns NaN for both, which used to flow into the driver and surface
 * as a confusing error far from the actual mistake.
 */
function parseNumericFlag(flag: string, value: string | undefined): number {
	if (value === undefined || value.startsWith("-")) {
		throw new Error(`${flag} requires a value.`);
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive number, got '${value}'.`);
	}

	return parsed;
}

/** Parses a string flag value, rejecting a missing one. */
function requireValue(flag: string, value: string | undefined): string {
	if (value === undefined) {
		throw new Error(`${flag} requires a value.`);
	}

	return value;
}

function parseList(value?: string): string[] | undefined {
	const entries = value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	return entries && entries.length > 0 ? entries : undefined;
}

function printHelp(): void {
	console.log(`
MongoDB Database Analyzer
=========================

Usage:
  npx ts-node index.ts [options]

Connection options:
  --uri <uri>                    MongoDB connection URI
  -h, --host <host>              Database host (env: MONGO_HOST)
  -p, --port <port>              Database port (env: MONGO_PORT)
  -d, --database <name>          Database name (env: MONGO_DB)
  -U, --user <user>              Database user (env: MONGO_USER)
  -W, --password <pass>          Database password (env: MONGO_PASSWORD)
  --authSource <db>              Authentication database (env: MONGO_AUTH_DB)
  --profile <name>               Use named profile from .analyzerrc.json
  --config <path>                Use a custom config file path

Analysis options:
  --slow-query-threshold <ms>    Slow query threshold in ms (default: ${DEFAULTS.slowQueryThreshold})
  --min-index-accesses <n>       Min accesses to consider index used (default: ${DEFAULTS.minIndexAccesses})
  --schema-sample-size <n>       Documents sampled per collection for schema analysis (default: ${DEFAULTS.schemaSampleSize})
  --collections <list>           Comma-separated collections to analyze
  --compare <path>               Compare against a previous JSON report
  --watch [seconds]              Watch mode (default interval: ${DEFAULTS.watchInterval}s)

Output options:
  -o, --output <dir>             Output directory for reports (default: ${DEFAULTS.output})
  -j, --json                     Output JSON to stdout
  --html                         Also generate an HTML report
  -q, --quiet                    Suppress non-essential output
  -i, --interactive              Interactive mode with menu
  start                          Alias for --interactive

Safety options:
  -y, --yes                      Confirm destructive commands (compact, profiler changes)
  --dry-run                      Report what a destructive command would do, without running it

Commands:
  -c, --command <cmd>            Run a specific analysis command

Available commands:
  full
  health
  unused-indexes
  missing-indexes
  duplicate-indexes
  slow-queries
  query-stats
  query-antipatterns
  current-ops
  long-running
  blocking
  collections
  largest-collections
  compact-needed
  run-compact
  auto-compact
  schema
  schema-issues
  connections
  config
  server-info
  replica-set
  sharding
  wiredtiger
  oplog
  enable-profiler
  disable-profiler
  profiler-status
`);
}
