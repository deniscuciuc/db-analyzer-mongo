import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions, toAnalyzerOptions } from "../src/cli/options";
import {
	assertConfirmedIfDestructive,
	assertKnownCommand,
} from "../src/cli/validate";
import {
	buildConnectionUri,
	parseDatabaseFromConnectionString,
} from "../src/connection";
import { DEFAULTS } from "../src/constants";

test("parseOptions returns the documented defaults", () => {
	const options = parseOptions([]);

	assert.equal(options.host, DEFAULTS.host);
	assert.equal(options.port, DEFAULTS.port);
	assert.equal(options.database, DEFAULTS.database);
	assert.equal(options.authSource, DEFAULTS.authSource);
	assert.equal(options.command, "full");
	assert.equal(options.yes, false);
	assert.equal(options.dryRun, false);
});

test("parseOptions reads connection flags", () => {
	const options = parseOptions([
		"--host",
		"mongo.example.com",
		"--port",
		"27018",
		"--database",
		"app",
		"--user",
		"reader",
		"--password",
		"secret",
		"--authSource",
		"app",
	]);

	assert.equal(options.host, "mongo.example.com");
	assert.equal(options.port, 27018);
	assert.equal(options.database, "app");
	assert.equal(options.user, "reader");
	assert.equal(options.password, "secret");
	assert.equal(options.authSource, "app");
});

test("--schema-sample-size is settable", () => {
	// DEFAULTS advertised this and toAnalyzerOptions forwarded it, but no flag could set it.
	assert.equal(
		parseOptions(["--schema-sample-size", "500"]).schemaSampleSize,
		500,
	);
});

test("--watch defaults its interval, accepts one, and rejects a bad one", () => {
	assert.equal(parseOptions(["--watch"]).watch, DEFAULTS.watchInterval);
	assert.equal(parseOptions(["--watch", "5"]).watch, 5);
	assert.equal(
		parseOptions(["--watch", "--json"]).watch,
		DEFAULTS.watchInterval,
	);
	assert.throws(() => parseOptions(["--watch", "0"]), /Invalid watch interval/);
	// A negative value used to be mistaken for a flag and silently replaced by the default.
	assert.throws(
		() => parseOptions(["--watch", "-1"]),
		/Invalid watch interval/,
	);
});

test("a non-numeric flag value is rejected with the flag named", () => {
	assert.throws(
		() => parseOptions(["--port", "abc"]),
		/--port must be a positive number/,
	);
	assert.throws(
		() => parseOptions(["--slow-query-threshold", "slow"]),
		/--slow-query-threshold must be a positive number/,
	);
});

test("a flag at the end of argv is rejected rather than storing undefined", () => {
	assert.throws(() => parseOptions(["--host"]), /--host requires a value/);
	assert.throws(
		() => parseOptions(["--authSource"]),
		/--authSource requires a value/,
	);
	assert.throws(() => parseOptions(["--port"]), /--port requires a value/);
});

test("an unknown flag is rejected rather than ignored", () => {
	assert.throws(() => parseOptions(["--jsno"]), /Unknown option: --jsno/);
});

test("list flags are split and trimmed", () => {
	assert.deepEqual(
		parseOptions(["--collections", "users, orders ,"]).collections,
		["users", "orders"],
	);
});

test("toAnalyzerOptions maps the threshold name the analyzers read", () => {
	const analyzerOptions = toAnalyzerOptions(
		parseOptions([
			"--slow-query-threshold",
			"250",
			"--min-index-accesses",
			"7",
		]),
	);

	// The CLI field is slowQueryThreshold; the analyzers read slowQueryThresholdMs.
	assert.equal(analyzerOptions.slowQueryThresholdMs, 250);
	assert.equal(analyzerOptions.minIndexAccesses, 7);
});

test("assertKnownCommand rejects an unrecognised command", () => {
	assert.throws(() => assertKnownCommand("helth"), /Unknown command: helth/);
	assert.doesNotThrow(() => assertKnownCommand("health"));
});

test("compact and the profiler toggles need --yes or --dry-run", () => {
	for (const command of [
		"run-compact",
		"auto-compact",
		"enable-profiler",
		"disable-profiler",
	]) {
		const options = parseOptions(["-c", command]);

		assert.throws(
			() => assertConfirmedIfDestructive(options),
			new RegExp(`${command} changes server state`),
		);
		assert.doesNotThrow(() =>
			assertConfirmedIfDestructive({ ...options, yes: true }),
		);
		assert.doesNotThrow(() =>
			assertConfirmedIfDestructive({ ...options, dryRun: true }),
		);
	}
});

test("a read-only command needs no confirmation", () => {
	assert.doesNotThrow(() =>
		assertConfirmedIfDestructive(parseOptions(["-c", "health"])),
	);
});

test("buildConnectionUri returns a supplied uri unchanged", () => {
	const uri =
		"mongodb+srv://user:pass@cluster.example.com/app?retryWrites=true";

	assert.equal(
		buildConnectionUri({
			uri,
			host: "ignored",
			port: 1,
			database: "ignored",
			authSource: "admin",
		}),
		uri,
	);
});

test("buildConnectionUri omits credentials when there are none", () => {
	assert.equal(
		buildConnectionUri({
			host: "localhost",
			port: 27017,
			database: "app",
			authSource: "admin",
		}),
		"mongodb://localhost:27017/app",
	);
});

test("buildConnectionUri percent-encodes credentials", () => {
	// An unencoded @ or / in a password would break the URI and, worse, could redirect the
	// connection to a different host.
	const uri = buildConnectionUri({
		host: "localhost",
		port: 27017,
		database: "app",
		user: "user@corp",
		password: "p@ss/word:1",
		authSource: "admin",
	});

	assert.ok(uri.includes("user%40corp"), uri);
	assert.ok(uri.includes("p%40ss%2Fword%3A1"), uri);
	assert.ok(!uri.includes("p@ss"), uri);
});

test("parseDatabaseFromConnectionString reads the database from a uri", () => {
	assert.equal(
		parseDatabaseFromConnectionString("mongodb://localhost:27017/mydb"),
		"mydb",
	);
	assert.equal(
		parseDatabaseFromConnectionString(
			"mongodb+srv://user:pass@cluster.example.com/mydb?retryWrites=true",
		),
		"mydb",
	);
});

test("parseDatabaseFromConnectionString returns undefined when there is no database", () => {
	assert.equal(
		parseDatabaseFromConnectionString("mongodb://localhost:27017"),
		undefined,
	);
	assert.equal(
		parseDatabaseFromConnectionString("mongodb://localhost:27017/"),
		undefined,
	);
});
