export const MAIN_MENU_CHOICES = [
	{ name: "🔍  Run analysis", value: "analysis" },
	{ name: "📊  Generate reports", value: "reports" },
	{ name: "📺  Live monitoring", value: "watch" },
	{ name: "🧹  Maintenance", value: "maintenance" },
	{ name: "⚙️  Settings", value: "settings" },
	{ name: "❌  Exit", value: "exit" },
] as const;

export const ANALYSIS_MENU_CHOICES = [
	{ name: "📊  Full analysis (all modules)", value: "full" },
	{ name: "⚡  Health check", value: "health" },
	{ name: "🔍  Quick analysis (select modules)", value: "quick" },
	{ name: "🔎  Single module", value: "single" },
	{ name: "← Back", value: "back" },
] as const;

export const MODULE_CHOICES = [
	{ name: "Health score", value: "health" },
	{ name: "Unused indexes", value: "unused-indexes" },
	{ name: "Missing indexes", value: "missing-indexes" },
	{ name: "Duplicate indexes", value: "duplicate-indexes" },
	{ name: "Slow queries", value: "slow-queries" },
	{ name: "Query stats", value: "query-stats" },
	{ name: "Query anti-patterns", value: "query-antipatterns" },
	{ name: "Current operations", value: "current-ops" },
	{ name: "Long-running operations", value: "long-running" },
	{ name: "Blocking operations", value: "blocking" },
	{ name: "Collections", value: "collections" },
	{ name: "Largest collections", value: "largest-collections" },
	{ name: "Collections needing compact", value: "compact-needed" },
	{ name: "Schema overview", value: "schema" },
	{ name: "Schema issues", value: "schema-issues" },
	{ name: "Connection stats", value: "connections" },
	{ name: "Server info", value: "server-info" },
	{ name: "Replica set status", value: "replica-set" },
	{ name: "Sharding status", value: "sharding" },
	{ name: "WiredTiger stats", value: "wiredtiger" },
	{ name: "Oplog stats", value: "oplog" },
	{ name: "Configuration", value: "config" },
	{ name: "Profiler status", value: "profiler-status" },
] as const;

export const REPORTS_MENU_CHOICES = [
	{ name: "📝  Markdown + JSON report", value: "markdown" },
	{ name: "🌐  HTML report", value: "html" },
	{ name: "🔀  Diff with previous report", value: "diff" },
	{ name: "← Back", value: "back" },
] as const;

export const WATCH_COMMAND_CHOICES = [
	{ name: "Health", value: "health" },
	{ name: "Current operations", value: "current-ops" },
	{ name: "Connections", value: "connections" },
	{ name: "Long-running operations", value: "long-running" },
	{ name: "Blocking operations", value: "blocking" },
	{ name: "Collections", value: "collections" },
	{ name: "Compact-needed", value: "compact-needed" },
	{ name: "Replica set", value: "replica-set" },
	{ name: "WiredTiger", value: "wiredtiger" },
	{ name: "Oplog", value: "oplog" },
] as const;

export const MAINTENANCE_MENU_CHOICES = [
	{ name: "🧹  Run compact", value: "run-compact" },
	{ name: "⚙️  Enable profiler", value: "enable-profiler" },
	{ name: "🗑️  Disable profiler", value: "disable-profiler" },
	{ name: "← Back", value: "back" },
] as const;

export const SETTINGS_MENU_CHOICES = [
	{ name: "👤  Switch connection profile", value: "profile" },
	{ name: "📋  Set collection filter", value: "collections" },
	{ name: "📄  Show current settings", value: "show" },
	{ name: "← Back", value: "back" },
] as const;
