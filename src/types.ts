// ============================================
// Database Configuration
// ============================================

export interface DatabaseConfig {
	uri?: string;
	host?: string;
	port?: number;
	database: string;
	user?: string;
	password?: string;
	authSource?: string;
	/** Connection timeout in milliseconds */
	connectTimeoutMs?: number;
	/** Socket timeout in milliseconds */
	socketTimeoutMs?: number;
}

// ============================================
// Index Types
// ============================================

export interface IndexInfo {
	namespace: string;
	collection: string;
	name: string;
	key: Record<string, number | string>;
	keyPattern: string;
	size: string;
	sizeBytes: number;
	isUnique: boolean;
	isSparse: boolean;
	isTTL: boolean;
	isPartial: boolean;
	isHidden: boolean;
	expireAfterSeconds?: number;
	partialFilterExpression?: Record<string, unknown>;
}

export interface UnusedIndex extends IndexInfo {
	accesses: number;
	since: Date | null;
	usageStatus: "Never used" | "Rarely used" | "Low usage";
	/** Reason why this index might still be needed */
	potentialReason?: string;
}

export interface MissingIndex {
	collection: string;
	queryPattern: string;
	frequency: number;
	avgExecutionTime: number;
	suggestedIndex: string;
	estimatedBenefit: "Very High" | "High" | "Medium" | "Low";
	/** Fields that should be in the index */
	suggestedFields: string[];
}

export interface DuplicateIndex {
	collection: string;
	index1: string;
	index2: string;
	keys1: string;
	keys2: string;
	recommendation: string;
	duplicateType: "exact" | "prefix" | "similar";
}

export interface IndexUsageSummary {
	collection: string;
	indexCount: number;
	totalIndexSize: string;
	totalIndexSizeBytes: number;
	usedIndexes: number;
	unusedIndexes: number;
	indexEfficiency: number;
}

export interface TTLIndexInfo {
	collection: string;
	indexName: string;
	field: string;
	expireAfterSeconds: number;
	expireAfterFormatted: string;
	/** Number of documents deleted by TTL in last hour */
	deletedLastHour?: number;
	/** Estimated documents pending deletion */
	pendingDeletion?: number;
}

// ============================================
// Collection Types
// ============================================

export interface CollectionStats {
	namespace: string;
	collection: string;
	documentCount: number;
	totalSize: string;
	totalSizeBytes: number;
	storageSize: string;
	storageSizeBytes: number;
	indexSize: string;
	indexSizeBytes: number;
	avgDocSize: number;
	indexCount: number;
	capped: boolean;
	/** Compression ratio if WiredTiger */
	compressionRatio?: number;
}

export interface FragmentedCollection {
	collection: string;
	storageSize: string;
	storageSizeBytes: number;
	dataSize: string;
	dataSizeBytes: number;
	fragmentationRatio: number;
	recommendation: string;
	severity: "critical" | "high" | "medium" | "low";
}

// ============================================
// Query Types
// ============================================

export interface QueryStats {
	queryHash: string;
	queryShape: string;
	namespace: string;
	operation: QueryOperation;
	executionCount: number;
	totalExecutionTime: number;
	avgExecutionTime: number;
	minExecutionTime: number;
	maxExecutionTime: number;
	docsExamined: number;
	docsReturned: number;
	keysExamined: number;
	planSummary: string;
}

export type QueryOperation =
	| "query"
	| "find"
	| "update"
	| "delete"
	| "insert"
	| "aggregate"
	| "findAndModify"
	| "bulkWrite"
	| "mapReduce"
	| "count"
	| "distinct"
	| "unknown";

export interface SlowQuery extends QueryStats {
	recommendations: string[];
	severity: "critical" | "high" | "medium" | "low";
}

export interface CurrentOperation {
	opId: number;
	operation: string;
	namespace: string;
	runningTime: number;
	runningTimeFormatted: string;
	query: Record<string, unknown>;
	client: string;
	waitingForLock: boolean;
	lockType?: string;
}

export interface BlockingOperation {
	blockedOpId: number;
	blockingOpId: number | null;
	blockedNamespace: string;
	blockedOperation: string;
	waitingTime: number;
	waitingTimeFormatted: string;
}

// ============================================
// Database Metrics
// ============================================

export interface DatabaseMetrics {
	databaseSize: string;
	databaseSizeBytes: number;
	storageSize: string;
	storageSizeBytes: number;
	indexSize: string;
	indexSizeBytes: number;
	collections: number;
	documents: number;
	indexes: number;
	currentConnections: number;
	availableConnections: number;
	activeConnections: number;
	cacheHitRatio: number;
	/** Total read operations since server start */
	totalReads: number;
	/** Total write operations since server start */
	totalWrites: number;
	/** Uptime in seconds */
	uptimeSeconds?: number;
	/** Operation statistics */
	operationStats?: OperationStats;
	/** Lock statistics */
	lockStats?: LockStats;
}

export interface OperationStats {
	/** Insert operations per second */
	insertsPerSec: number;
	/** Query operations per second */
	queriesPerSec: number;
	/** Update operations per second */
	updatesPerSec: number;
	/** Delete operations per second */
	deletesPerSec: number;
	/** Getmore operations per second */
	getmorePerSec: number;
	/** Command operations per second */
	commandsPerSec: number;
	/** Total operations per second */
	totalOpsPerSec: number;
	/** Read/Write ratio */
	readWriteRatio: string;
}

export interface LockStats {
	/** Global lock acquire count */
	globalLockTotal: number;
	/** Global lock time acquired (microseconds) */
	globalLockTimeUs: number;
	/** Current queue for read locks */
	currentQueueReaders: number;
	/** Current queue for write locks */
	currentQueueWriters: number;
	/** Active read clients */
	activeReaders: number;
	/** Active write clients */
	activeWriters: number;
}

export interface ConnectionStats {
	current: number;
	available: number;
	active: number;
	totalCreated: number;
	byClient: { client: string; count: number }[];
}

export interface WiredTigerStats {
	cacheSize: string;
	cacheSizeBytes: number;
	cacheUsed: string;
	cacheUsedBytes: number;
	cacheDirty: string;
	cacheDirtyBytes: number;
	cacheHitRatio: number;
	pagesRead: number;
	pagesWritten: number;
	bytesRead: number;
	bytesWritten: number;
	evictedPages?: number;
	checkpointTime?: number;
}

export interface OplogStats {
	size: string;
	sizeBytes: number;
	usedSize: string;
	usedSizeBytes: number;
	timeDiffSeconds: number;
	timeDiffHours: number;
	firstEntry: Date | null;
	lastEntry: Date | null;
	opsPerSecond?: number;
}

// ============================================
// Lock Types
// ============================================

export interface LockInfo {
	opId: number;
	operation: string;
	namespace: string;
	query: Record<string, unknown>;
	runningTime: number;
	waitingForLock: boolean;
	lockType?: string;
	lockMode?: string;
}

// ============================================
// Compact Types
// ============================================

export interface CompactTarget {
	collection: string;
}

export interface CompactResult {
	collection: string;
	success: boolean;
	duration: number;
	bytesFreed?: number;
	bytesFreedFormatted?: string;
	error?: string;
}

export interface CompactSummary {
	totalCollections: number;
	successful: number;
	failed: number;
	totalDuration: number;
	totalBytesFreed: number;
	totalBytesFreedFormatted: string;
	results: CompactResult[];
}

// ============================================
// Replica Set Types
// ============================================

export interface ReplicaSetStatus {
	set: string;
	myState: number;
	term?: number;
	heartbeatIntervalMs?: number;
	members: ReplicaSetMember[];
}

export interface ReplicaSetMember {
	id: number;
	name: string;
	health: number;
	state: number;
	stateStr: string;
	uptime: number;
	optime?: { ts: Date; t: number };
	optimeDate?: Date;
	lastHeartbeat?: Date;
	lastHeartbeatRecv?: Date;
	pingMs?: number;
	syncSourceHost?: string;
	configVersion?: number;
	/** Replication lag in seconds (for secondaries) */
	replicationLagSeconds?: number;
}

export interface DocumentSizeDistribution {
	collection: string;
	sampleSize: number;
	avgDocSize: number;
	avgDocSizeFormatted: string;
	minDocSize: number;
	maxDocSize: number;
	medianDocSize: number;
	/** Size distribution buckets */
	distribution: {
		bucket: string;
		count: number;
		percentage: number;
	}[];
	/** Documents larger than 1MB (potential issues) */
	oversizedCount: number;
}

// ============================================
// Sharding Types
// ============================================

export interface ShardingStatus {
	shards: ShardInfo[];
	databases: ShardedDatabase[];
	shardedCollections: ShardedCollection[];
	balancerStatus?: BalancerStatus;
}

export interface ShardInfo {
	id: string;
	host: string;
	state: number;
	tags?: string[];
}

export interface ShardedDatabase {
	name: string;
	primary: string;
	partitioned: boolean;
}

export interface ShardedCollection {
	namespace: string;
	shardKey: Record<string, number>;
	chunks: number;
	unique?: boolean;
}

export interface BalancerStatus {
	running: boolean;
	mode: string;
	inBalancerRound?: boolean;
}

// ============================================
// Analysis Report Types
// ============================================

export interface AnalysisReport {
	generatedAt: Date;
	databaseName: string;
	metrics: DatabaseMetrics;
	unusedIndexes: UnusedIndex[];
	missingIndexes: MissingIndex[];
	duplicateIndexes: DuplicateIndex[];
	collectionStats: CollectionStats[];
	slowQueries: SlowQuery[];
	fragmentedCollections: FragmentedCollection[];
	/** Detected query anti-patterns */
	queryAntiPatterns?: QueryAntiPattern[];
	/** Schema issues detected across collections */
	schemaIssues?: SchemaIssue[];
	recommendations: string[];
	healthScore: number;
	errors?: AnalysisErrorInfo[];
	/** TTL indexes analysis */
	ttlIndexes?: TTLIndexInfo[];
	/** WiredTiger cache statistics */
	wiredTigerStats?: WiredTigerStats;
	/** Document size distribution for largest collections */
	documentSizeDistribution?: DocumentSizeDistribution[];
	/** Replica set status with lag information */
	replicaSetStatus?: ReplicaSetStatus;
	/** Connection distribution by client */
	connectionStats?: ConnectionStats;
}

export interface AnalysisErrorInfo {
	type: string;
	severity?: "fatal" | "warning" | "info";
	message: string;
	collection?: string;
	operation?: string;
	code?: number;
}

// ============================================
// Analyzer Options
// ============================================

export interface AnalyzerOptions {
	/** Include system.* collections in analysis */
	includeSystemCollections?: boolean;
	/** Minimum accesses for an index to be considered "used" */
	minIndexAccesses?: number;
	/** Threshold for slow queries in milliseconds */
	slowQueryThresholdMs?: number;
	/** Maximum number of queries to analyze */
	topQueriesLimit?: number;
	/** Collections to exclude from analysis */
	excludeCollections?: string[];
	/** Output directory for reports */
	outputDir?: string;
	/** Sample size for schema analysis */
	schemaSampleSize?: number;
	/** Enable verbose logging */
	verbose?: boolean;
	/** Log function for progress messages (defaults to console.log, use no-op for quiet/json mode) */
	log?: (...args: unknown[]) => void;
}

// ============================================
// Schema Analysis Types
// ============================================

export interface FieldTypeStats {
	type: string;
	count: number;
	percentage: number;
}

export interface FieldInfo {
	path: string;
	types: FieldTypeStats[];
	presence: number;
	isArray: boolean;
	hasNestedObjects: boolean;
	avgArrayLength?: number;
	minValue?: number | string | Date;
	maxValue?: number | string | Date;
	distinctValuesEstimate?: number;
	avgStringLength?: number;
}

export interface SchemaAnalysis {
	collection: string;
	documentCount: number;
	sampleSize: number;
	fields: FieldInfo[];
	schemaVariance: number;
	recommendations: string[];
	estimatedDocumentSize: number;
	estimatedDocumentSizeFormatted: string;
}

export interface SchemaIssue {
	collection: string;
	field: string;
	issue: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	recommendation: string;
}

// ============================================
// Query Anti-Pattern Types
// ============================================

export interface QueryAntiPattern {
	pattern: string;
	description: string;
	severity: "critical" | "high" | "medium" | "low";
	count: number;
	recommendation: string;
}

// ============================================
// Server Info Types
// ============================================

export interface ServerInfo {
	version: string;
	gitVersion: string;
	modules: string[];
	openSSL: string;
	allocator: string;
	javascriptEngine: string;
	storageEngines: string[];
	currentStorageEngine: string;
	platform?: string;
	bits?: number;
}

export interface ConfigurationSetting {
	name: string;
	value: string;
	description: string;
	category?: string;
}

// ============================================
// Health Score Types
// ============================================

export interface HealthReport {
	healthScore: number;
	status: "excellent" | "good" | "fair" | "poor" | "critical";
	issues: HealthIssue[];
	recommendations: string[];
}

export interface HealthIssue {
	category: string;
	severity: "critical" | "high" | "medium" | "low";
	message: string;
	impact: string;
}
