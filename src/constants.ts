export const COMMANDS = [
	"full",
	"health",
	"unused-indexes",
	"missing-indexes",
	"duplicate-indexes",
	"slow-queries",
	"query-stats",
	"query-antipatterns",
	"current-ops",
	"long-running",
	"blocking",
	"collections",
	"largest-collections",
	"compact-needed",
	"run-compact",
	"auto-compact",
	"schema",
	"schema-issues",
	"connections",
	"config",
	"server-info",
	"replica-set",
	"sharding",
	"wiredtiger",
	"oplog",
	"enable-profiler",
	"disable-profiler",
	"profiler-status",
] as const;

export type Command = (typeof COMMANDS)[number];

export const FULL_ANALYSIS_COMMANDS: Command[] = [
	"health",
	"unused-indexes",
	"missing-indexes",
	"duplicate-indexes",
	"slow-queries",
	"query-antipatterns",
	"schema-issues",
	"collections",
	"compact-needed",
	"replica-set",
	"wiredtiger",
	"connections",
];

export const WATCH_ALLOWED = new Set<Command>([
	"health",
	"connections",
	"current-ops",
	"long-running",
	"blocking",
	"collections",
	"compact-needed",
	"replica-set",
	"wiredtiger",
	"oplog",
]);

export const WATCH_BLOCKED = new Set<Command>([
	"run-compact",
	"auto-compact",
	"enable-profiler",
	"disable-profiler",
]);

export const DEFAULTS = {
	host: "localhost",
	port: 27017,
	database: "test",
	authSource: "admin",
	slowQueryThreshold: 100,
	minIndexAccesses: 50,
	output: "./reports",
	watchInterval: 30,
	schemaSampleSize: 1000,
} as const;
