import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MongoAnalyzer } from "../src/api";
import { loadConfig, resolveProfile } from "../src/config/loader";
import * as api from "../src/index";
import { ReportGenerator } from "../src/reporters/report-generator";
import type { AnalysisReport } from "../src/types";
import { calculateHealthScore } from "../src/utils/health";

function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
	return {
		generatedAt: new Date("2026-09-10T00:00:00Z"),
		databaseName: "analyze",
		metrics: {
			databaseSize: "250 KB",
			databaseSizeBytes: 256_000,
			storageSize: "92 KB",
			storageSizeBytes: 94_208,
			indexSize: "156 KB",
			indexSizeBytes: 159_744,
			collections: 1,
			documents: 3000,
			indexes: 3,
			currentConnections: 3,
			availableConnections: 200_000,
			activeConnections: 1,
			cacheHitRatio: 100,
			totalReads: 0,
			totalWrites: 3000,
			uptimeSeconds: 60,
		},
		unusedIndexes: [],
		missingIndexes: [],
		duplicateIndexes: [],
		collectionStats: [],
		fragmentedCollections: [],
		slowQueries: [],
		queryAntiPatterns: [],
		recommendations: [],
		healthScore: 95,
		errors: [],
		...overrides,
	} as unknown as AnalysisReport;
}

test("the library entry point exports the analyzer and helpers", () => {
	assert.equal(typeof api.MongoAnalyzer, "function");
	assert.equal(typeof api.buildConnectionUri, "function");
	assert.equal(typeof api.calculateHealthScore, "function");
	assert.equal(typeof api.ReportGenerator, "function");
	assert.equal(typeof api.SchemaAnalyzer, "function");
	assert.equal(typeof api.AnalysisError, "function");
	assert.ok(Array.isArray(api.COMMANDS));
});

test("constructing an analyzer opens no connection", () => {
	const analyzer = new MongoAnalyzer({ host: "203.0.113.1", port: 1 });
	assert.ok(analyzer instanceof MongoAnalyzer);
});

test("the database name is taken from the uri when not given explicitly", () => {
	const analyzer = new MongoAnalyzer({
		uri: "mongodb://localhost:27017/from-uri",
	});

	// Reaching into the instance is the only way to observe this without connecting.
	assert.equal(
		(analyzer as unknown as { databaseName: string }).databaseName,
		"from-uri",
	);
});

test("an explicit database wins over the one in the uri", () => {
	const analyzer = new MongoAnalyzer({
		uri: "mongodb://localhost:27017/from-uri",
		database: "explicit",
	});

	assert.equal(
		(analyzer as unknown as { databaseName: string }).databaseName,
		"explicit",
	);
});

test("close is safe when never connected, and idempotent", async () => {
	const analyzer = new MongoAnalyzer();
	await analyzer.close();
	await analyzer.close();
});

test("a caller-supplied client is not closed by close", async () => {
	let closeCalls = 0;
	const fakeDb = { command: async () => ({ ok: 1 }) };
	const fakeClient = {
		on: () => fakeClient,
		connect: async () => fakeClient,
		db: () => fakeDb,
		close: async () => {
			closeCalls++;
		},
	};

	const analyzer = new MongoAnalyzer({ client: fakeClient as never });
	await analyzer.connect();
	await analyzer.close();

	assert.equal(closeCalls, 0, "close must not close a client it does not own");
});

test("a connection failure is reported clearly", async () => {
	const analyzer = new MongoAnalyzer({
		host: "127.0.0.1",
		port: 1,
		uri: "mongodb://127.0.0.1:1/x?serverSelectionTimeoutMS=300",
	});

	await assert.rejects(
		() => analyzer.analyze(),
		(error: Error) => {
			assert.match(error.message, /Cannot connect to MongoDB/);
			return true;
		},
	);

	await analyzer.close();
});

test("healthScore returns a score, status and issues", () => {
	const health = calculateHealthScore(report());

	assert.equal(typeof health.score, "number");
	assert.ok(
		health.score > 0 && health.score <= 100,
		`score was ${health.score}`,
	);
	assert.equal(typeof health.status, "string");
	assert.ok(Array.isArray(health.issues));
});

test("healthScore drops when the cache hit ratio is poor", () => {
	const healthy = calculateHealthScore(report());
	const unhealthy = calculateHealthScore(
		report({
			metrics: { ...report().metrics, cacheHitRatio: 50 },
		} as Partial<AnalysisReport>),
	);

	assert.ok(
		unhealthy.score < healthy.score,
		`${unhealthy.score} should be below ${healthy.score}`,
	);
});

test("the markdown report contains the database name and metrics", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "mongo-report-"));
	const generator = new ReportGenerator(outputDir, {});

	const path = await generator.generateFullReport(report());
	const contents = readFileSync(path, "utf8");

	assert.ok(path.endsWith(".md"), path);
	assert.match(contents, /analyze/);
	assert.match(contents, /250 KB/);
});

test("the json report is valid JSON carrying the report", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "mongo-report-"));
	const generator = new ReportGenerator(outputDir, {});

	const path = await generator.generateJsonReport(report());
	const parsed = JSON.parse(readFileSync(path, "utf8"));

	assert.ok(path.endsWith(".json"), path);
	assert.equal(parsed.databaseName ?? parsed.report?.databaseName, "analyze");
});

test("the html report escapes a hostile collection name", async () => {
	const outputDir = mkdtempSync(join(tmpdir(), "mongo-report-"));
	const generator = new ReportGenerator(outputDir, {});

	const path = await generator.generateHtmlReport(
		report({
			collectionStats: [
				{
					namespace: "analyze.<script>alert(1)</script>",
					collection: "<script>alert(1)</script>",
					documentCount: 1,
					totalSize: "1 KB",
					totalSizeBytes: 1024,
					storageSize: "1 KB",
					storageSizeBytes: 1024,
					indexSize: "1 KB",
					indexSizeBytes: 1024,
					avgDocSize: 1024,
					indexCount: 1,
					capped: false,
				},
			],
		}),
	);
	const contents = readFileSync(path, "utf8");

	assert.ok(path.endsWith(".html"), path);
	assert.ok(
		!contents.includes("<script>alert(1)</script>"),
		"a collection name must not be interpolated into the HTML unescaped",
	);
});

test("loadConfig reads an explicit path and rejects a missing one", () => {
	const dir = mkdtempSync(join(tmpdir(), "mongo-config-"));
	const path = join(dir, "config.json");
	writeFileSync(
		path,
		JSON.stringify({
			output: "./out",
			profiles: { prod: { host: "p.example.com" } },
		}),
	);

	assert.equal(loadConfig(path).output, "./out");
	assert.throws(
		() => loadConfig(join(dir, "nope.json")),
		/Config file not found/,
	);
});

test("malformed JSON at an explicit config path names the file", () => {
	const dir = mkdtempSync(join(tmpdir(), "mongo-config-"));
	const path = join(dir, "config.json");
	writeFileSync(path, "{ not json");

	assert.throws(() => loadConfig(path), /Could not parse config file/);
});

test("resolveProfile resolves by name, by default, and rejects unknown", () => {
	const config = {
		defaultProfile: "staging",
		profiles: {
			prod: { host: "prod.example.com" },
			staging: { host: "staging.example.com" },
		},
	};

	assert.equal(resolveProfile(config, "prod").host, "prod.example.com");
	assert.equal(resolveProfile(config, undefined).host, "staging.example.com");
	assert.throws(() => resolveProfile(config, "nope"), /nope/);
});
