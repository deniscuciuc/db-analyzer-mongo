import { type Db, MongoClient } from "mongodb";

import { parseOptions } from "./src/cli/options";
import { executeCommand } from "./src/cli/runner";
import { loadConfig, resolveProfile } from "./src/config/loader";
import { DEFAULTS } from "./src/constants";
import { InteractiveCLI } from "./src/interactive";
import { runWatchLoop } from "./src/watch/runner";

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

function buildConnectionUri(config: {
	uri?: string;
	host: string;
	port: number;
	database: string;
	user?: string;
	password?: string;
	authSource: string;
}): string {
	if (config.uri) {
		return config.uri;
	}

	if (config.user && config.password) {
		return `mongodb://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?authSource=${config.authSource}`;
	}

	return `mongodb://${config.host}:${config.port}/${config.database}`;
}

function parseDatabaseFromConnectionString(
	connectionString: string,
): string | undefined {
	try {
		const normalized = connectionString.replace("mongodb+srv://", "mongodb://");
		const url = new URL(normalized);
		if (url.pathname.length > 1) {
			return url.pathname.substring(1);
		}
		return undefined;
	} catch {
		return connectionString.match(/\/([^/?]+)(?:\?|$)/)?.[1];
	}
}

async function main(): Promise<void> {
	const options = parseOptions();
	const config = loadConfig(options.config);
	const profile = resolveProfile(config, options.profile);
	const preferProfile = Boolean(options.profile);

	if (options.watch !== undefined && options.json) {
		throw new Error("--watch cannot be combined with --json.");
	}

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

	await client.connect();
	const db: Db = client.db(runtimeOptions.database);

	try {
		if (runtimeOptions.interactive) {
			const cli = new InteractiveCLI(client, db, runtimeOptions);
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
	if (message.startsWith("Mongo")) {
		console.error("Connection failed:", message);
	} else {
		console.error("Error during analysis:", message);
	}
	process.exit(1);
});
