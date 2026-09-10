/**
 * Shapes for the MongoDB responses this tool reads.
 *
 * The driver types `db.command()` and `system.profile` documents as `Document`, which is
 * `Record<string, any>`. Naming the fields actually used is what lets the analyzers avoid
 * `any` while staying honest that every field is optional — a server may not report it, and
 * which fields exist varies by version and deployment topology.
 */

/** A document read from the `system.profile` collection. */
export interface ProfileEntry {
	op?: string;
	ns?: string;
	millis?: number;
	ts?: Date;
	planSummary?: string;
	command?: Record<string, unknown>;
	query?: Record<string, unknown>;
	filter?: Record<string, unknown>;
	docsExamined?: number;
	nreturned?: number;
	keysExamined?: number;
	nModified?: number;
	appName?: string;
	client?: string;
	user?: string;
	[key: string]: unknown;
}

/** An entry from the `currentOp` command's `inprog` array. */
export interface CurrentOpEntry {
	opid?: number | string;
	op?: string;
	ns?: string;
	secs_running?: number;
	microsecs_running?: number;
	waitingForLock?: boolean;
	desc?: string;
	client?: string;
	appName?: string;
	planSummary?: string;
	command?: Record<string, unknown>;
	lockStats?: {
		waitingForLock?: { opid?: number | string };
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/** A single BSON value as it appears in a sampled document. */
export type BsonValue = unknown;

/** A document sampled from a collection during schema analysis. */
export type SampledDocument = Record<string, BsonValue>;

/** A member entry from `replSetGetStatus`. */
export interface ReplSetMemberEntry {
	_id?: number;
	name?: string;
	stateStr?: string;
	health?: number;
	uptime?: number;
	optimeDate?: Date;
	lastHeartbeat?: Date;
	syncSourceHost?: string;
	[key: string]: unknown;
}

/** The subset of `serverStatus` this tool reads. */
export interface ServerStatusResponse {
	wiredTiger?: {
		cache?: Record<string, number>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/** The subset of `collStats` this tool reads. */
export interface CollStatsResponse {
	size?: number;
	storageSize?: number;
	wiredTiger?: {
		"block-manager"?: Record<string, number>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/** An error from the MongoDB driver, which carries a numeric `code`. */
export interface MongoErrorLike {
	code?: number;
	codeName?: string;
	message?: string;
	name?: string;
}

/** The index metadata `collection.indexes()` returns for one index. */
export interface IndexMetadata {
	name?: string;
	unique?: boolean;
	sparse?: boolean;
	hidden?: boolean;
	expireAfterSeconds?: number;
	partialFilterExpression?: Record<string, unknown>;
	key?: Record<string, number | string>;
	[key: string]: unknown;
}

/** A BSON timestamp, as returned in oplog entries. */
export interface BsonTimestampLike {
	high?: number;
	low?: number;
	getHighBits?: () => number;
	t?: number;
}
