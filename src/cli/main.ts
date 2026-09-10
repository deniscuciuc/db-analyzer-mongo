import { type Db, MongoClient } from "mongodb";
import { loadConfig, resolveProfile } from "../config/loader";
import {
	buildConnectionUri,
	parseDatabaseFromConnectionString,
} from "../connection";
import { DEFAULTS } from "../constants";
import { InteractiveCLI } from "../interactive";
import { runWatchLoop } from "../watch/runner";
import { parseOptions } from "./options";
import { executeCommand } from "./runner";
import { assertConfirmedIfDestructive, assertKnownCommand } from "./validate";

function resolveValue<T>(
	cliValue: T | undefined,
	envValue: T | undefined,
	profileValue: T | undefined,
	fallbackValue: T,
	preferProfile: boolean,
): T {
	if (cliValue !== undefined && cliValue !== fallbackValue) {
		return cliValue;
	}

	if (preferProfile) {
		return profileValue ?? envValue ?? cliValue ?? fallbackValue;
	}

	return envValue ?? profileValue ?? cliValue ?? fallbackValue;
}

async function main(): Promise<void> {
	const options = parseOptions();
	const config = loadConfig(options.config);
	const profile = resolveProfile(config, options.profile);
	const preferProfile = Boolean(options.profile);

	if (options.watch !== undefined && options.json) {
		throw new Error("--watch cannot be combined with --json.");
	}

	// Validate before opening a connection so a typo fails immediately rather
	// than after a connection timeout.
	assertKnownCommand(options.command);
	assertConfirmedIfDestructive(options);

	const envConnectionString =
		process.env.MONGODB_CONNECTION_STRING ?? process.env.MONGO_URI;
	const connectionString = resolveValue(
		options.uri,
		envConnectionString,
		profile.uri,
		undefined,
		preferProfile,
	);

	const runtimeOptions = {
		...options,
		database: resolveValue(
			options.database,
			process.env.MONGO_DB,
			profile.database,
			parseDatabaseFromConnectionString(connectionString ?? "") ??
				DEFAULTS.database,
			preferProfile,
		),
		authSource: resolveValue(
			options.authSource,
			process.env.MONGO_AUTH_DB,
			profile.authSource,
			DEFAULTS.authSource,
			preferProfile,
		),
		outputDir: resolveValue(
			options.outputDir,
			undefined,
			config.output,
			DEFAULTS.output,
			false,
		),
		slowQueryThreshold: resolveValue(
			options.slowQueryThreshold,
			undefined,
			config.slowQueryThreshold,
			DEFAULTS.slowQueryThreshold,
			false,
		),
		minIndexAccesses: resolveValue(
			options.minIndexAccesses,
			undefined,
			config.minIndexAccesses,
			DEFAULTS.minIndexAccesses,
			false,
		),
		thresholds: config.thresholds,
	};

	const client = new MongoClient(
		buildConnectionUri({
			uri: connectionString,
			host: resolveValue(
				options.host,
				process.env.MONGO_HOST,
				profile.host,
				DEFAULTS.host,
				preferProfile,
			),
			port: resolveValue(
				options.port,
				process.env.MONGO_PORT
					? Number.parseInt(process.env.MONGO_PORT, 10)
					: undefined,
				profile.port,
				DEFAULTS.port,
				preferProfile,
			),
			database: runtimeOptions.database,
			user: resolveValue(
				options.user,
				process.env.MONGO_USER,
				profile.user,
				undefined,
				preferProfile,
			),
			password: resolveValue(
				options.password,
				process.env.MONGO_PASSWORD,
				profile.password,
				undefined,
				preferProfile,
			),
			authSource: runtimeOptions.authSource,
		}),
	);

	// The driver emits 'error' on topology failures; without a listener those
	// surface as unhandled error events, which is near-certain in watch mode.
	client.on("error", (error: Error) => {
		console.warn(`MongoDB connection error: ${error.message}`);
	});

	// connect() must be inside the try/finally: on failure the client may already
	// have started topology monitors, and close() is what tears them down.
	try {
		try {
			await client.connect();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Cannot connect to MongoDB: ${message}`);
		}

		const db: Db = client.db(runtimeOptions.database);

		if (runtimeOptions.interactive) {
			const cli = new InteractiveCLI(client, db, {
				...runtimeOptions,
				slowQueryThresholdMs: runtimeOptions.slowQueryThreshold,
			});
			await cli.start();
			return;
		}

		if (runtimeOptions.watch !== undefined) {
			await runWatchLoop({
				intervalSeconds: runtimeOptions.watch,
				command: runtimeOptions.command,
				runCommand: () => executeCommand(client, db, runtimeOptions),
			});
			return;
		}

		await executeCommand(client, db, runtimeOptions);
	} finally {
		await client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith("Cannot connect to MongoDB")) {
		console.error("Connection failed:", message);
	} else {
		console.error("Error during analysis:", message);
	}
	// Set exitCode rather than calling process.exit, which can truncate buffered
	// stdout — e.g. a large --json report being piped to a file.
	process.exitCode = 1;
});
