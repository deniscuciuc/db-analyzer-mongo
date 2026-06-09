import type { Db, MongoClient } from "mongodb";

import { THRESHOLDS } from "../config/thresholds";
import type {
	AnalyzerOptions,
	ConfigurationSetting,
	ConnectionStats,
	DatabaseMetrics,
	DocumentSizeDistribution,
	HealthReport,
	LockStats,
	OperationStats,
	OplogStats,
	ReplicaSetStatus,
	ServerInfo,
	ShardingStatus,
	TTLIndexInfo,
	WiredTigerStats,
} from "../types";
import { ErrorCollector } from "../utils/errors";
import { formatBytes } from "../utils/formatting";

export class StatsCollector {
	private errorCollector = new ErrorCollector();

	constructor(
		private client: MongoClient,
		private db: Db,
		_options: AnalyzerOptions = {},
	) {}

	async getDatabaseMetrics(): Promise<DatabaseMetrics> {
		const [dbStats, serverStatus] = await Promise.all([
			this.db.stats(),
			this.db
				.admin()
				.command({ serverStatus: 1 })
				.catch(() => null),
		]);

		const cacheHitRatio = this.calculateCacheHitRatio(serverStatus);
		const connections = serverStatus?.connections ?? {};
		const opcounters = serverStatus?.opcounters ?? {};
		const globalLock = serverStatus?.globalLock ?? {};
		const uptime = serverStatus?.uptime ?? 1;

		const operationStats: OperationStats = {
			insertsPerSec: Math.round((opcounters.insert ?? 0) / uptime),
			queriesPerSec: Math.round((opcounters.query ?? 0) / uptime),
			updatesPerSec: Math.round((opcounters.update ?? 0) / uptime),
			deletesPerSec: Math.round((opcounters.delete ?? 0) / uptime),
			getmorePerSec: Math.round((opcounters.getmore ?? 0) / uptime),
			commandsPerSec: Math.round((opcounters.command ?? 0) / uptime),
			totalOpsPerSec: 0,
			readWriteRatio: "N/A",
		};

		const totalReads =
			operationStats.queriesPerSec + operationStats.getmorePerSec;
		const totalWrites =
			operationStats.insertsPerSec +
			operationStats.updatesPerSec +
			operationStats.deletesPerSec;
		operationStats.totalOpsPerSec =
			totalReads + totalWrites + operationStats.commandsPerSec;

		if (totalWrites > 0) {
			operationStats.readWriteRatio = `${(totalReads / totalWrites).toFixed(2)}:1`;
		} else if (totalReads > 0) {
			operationStats.readWriteRatio = "Read-only";
		}

		const lockStats: LockStats = {
			globalLockTotal: serverStatus?.locks?.Global?.acquireCount?.r ?? 0,
			globalLockTimeUs: globalLock.totalTime ?? 0,
			currentQueueReaders: globalLock.currentQueue?.readers ?? 0,
			currentQueueWriters: globalLock.currentQueue?.writers ?? 0,
			activeReaders: globalLock.activeClients?.readers ?? 0,
			activeWriters: globalLock.activeClients?.writers ?? 0,
		};

		return {
			databaseSize: formatBytes(dbStats.dataSize ?? 0),
			databaseSizeBytes: dbStats.dataSize ?? 0,
			storageSize: formatBytes(dbStats.storageSize ?? 0),
			storageSizeBytes: dbStats.storageSize ?? 0,
			indexSize: formatBytes(dbStats.indexSize ?? 0),
			indexSizeBytes: dbStats.indexSize ?? 0,
			collections: dbStats.collections ?? 0,
			documents: dbStats.objects ?? 0,
			indexes: dbStats.indexes ?? 0,
			currentConnections: connections.current ?? 0,
			availableConnections: connections.available ?? 0,
			activeConnections: connections.active ?? connections.current ?? 0,
			cacheHitRatio,
			totalReads: opcounters.query ?? 0,
			totalWrites:
				(opcounters.insert ?? 0) +
				(opcounters.update ?? 0) +
				(opcounters.delete ?? 0),
			uptimeSeconds: serverStatus?.uptime,
			operationStats,
			lockStats,
		};
	}

	async getConnectionStats(): Promise<ConnectionStats> {
		try {
			const serverStatus = await this.db.admin().command({ serverStatus: 1 });
			const connections = serverStatus.connections ?? {};

			const currentOp = await this.db.admin().command({ currentOp: 1 });
			const ops = currentOp.inprog ?? [];

			const clientCounts = new Map<string, number>();
			for (const op of ops) {
				const client =
					op.client ?? op.clientMetadata?.application?.name ?? "unknown";
				clientCounts.set(client, (clientCounts.get(client) ?? 0) + 1);
			}

			return {
				current: connections.current ?? 0,
				available: connections.available ?? 0,
				active: connections.active ?? 0,
				totalCreated: connections.totalCreated ?? 0,
				byClient: Array.from(clientCounts.entries())
					.map(([client, count]) => ({ client, count }))
					.sort((a, b) => b.count - a.count),
			};
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getConnectionStats",
			});
			return {
				current: 0,
				available: 0,
				active: 0,
				totalCreated: 0,
				byClient: [],
			};
		}
	}

	async getReplicaSetStatus(): Promise<ReplicaSetStatus | null> {
		try {
			const status = await this.db.admin().command({ replSetGetStatus: 1 });

			const primaryMember = status.members?.find(
				(m: any) => m.stateStr === "PRIMARY",
			);
			const primaryOptimeDate = primaryMember?.optimeDate
				? new Date(primaryMember.optimeDate)
				: null;

			return {
				set: status.set,
				myState: status.myState,
				term: status.term,
				heartbeatIntervalMs: status.heartbeatIntervalMillis,
				members:
					status.members?.map((m: any) => {
						let replicationLagSeconds: number | undefined;
						if (
							m.stateStr === "SECONDARY" &&
							primaryOptimeDate &&
							m.optimeDate
						) {
							const secondaryOptimeDate = new Date(m.optimeDate);
							replicationLagSeconds = Math.max(
								0,
								(primaryOptimeDate.getTime() - secondaryOptimeDate.getTime()) /
									1000,
							);
						}

						return {
							id: m._id,
							name: m.name,
							health: m.health,
							state: m.state,
							stateStr: m.stateStr,
							uptime: m.uptime,
							optime: m.optime,
							optimeDate: m.optimeDate,
							lastHeartbeat: m.lastHeartbeat,
							lastHeartbeatRecv: m.lastHeartbeatRecv,
							pingMs: m.pingMs,
							syncSourceHost: m.syncSourceHost,
							configVersion: m.configVersion,
							replicationLagSeconds,
						};
					}) ?? [],
			};
		} catch {
			return null;
		}
	}

	async getShardingStatus(): Promise<ShardingStatus | null> {
		try {
			// Check if this is a mongos or sharded cluster (hello replaces deprecated isMaster)
			let serverInfo: Record<string, unknown>;
			try {
				serverInfo = await this.db.admin().command({ hello: 1 });
			} catch {
				serverInfo = await this.db.admin().command({ isMaster: 1 });
			}

			if (!serverInfo.msg || serverInfo.msg !== "isdbgrid") {
				return null;
			}

			const configDb = this.client.db("config");

			const [shards, databases, collections] = await Promise.all([
				configDb.collection("shards").find().toArray(),
				configDb.collection("databases").find().toArray(),
				configDb
					.collection("collections")
					.find({ dropped: { $ne: true } })
					.toArray(),
			]);

			const chunkCounts = await configDb
				.collection("chunks")
				.aggregate([{ $group: { _id: "$ns", count: { $sum: 1 } } }])
				.toArray();

			const chunkCountMap = new Map(chunkCounts.map((c) => [c._id, c.count]));

			const shardedCollections = collections.map((coll) => ({
				namespace: String(coll._id),
				shardKey: coll.key as Record<string, number>,
				chunks: chunkCountMap.get(coll._id) ?? 0,
				unique: coll.unique ?? false,
			}));

			let balancerStatus: { running: boolean; mode: string } | undefined;
			try {
				const balancerState = await configDb
					.collection("settings")
					.findOne({ _id: "balancer" } as any);
				balancerStatus = {
					running: balancerState?.mode !== "off",
					mode: (balancerState?.mode as string) ?? "full",
				};
			} catch {
				balancerStatus = undefined;
			}

			return {
				shards: shards.map((s) => ({
					id: String(s._id),
					host: String(s.host),
					state: (s.state as number) ?? 1,
					tags: s.tags,
				})),
				databases: databases.map((d) => ({
					name: String(d._id),
					primary: String(d.primary),
					partitioned: (d.partitioned as boolean) ?? false,
				})),
				shardedCollections,
				balancerStatus,
			};
		} catch {
			return null;
		}
	}

	async getServerInfo(): Promise<ServerInfo> {
		try {
			const buildInfo = await this.db.admin().command({ buildInfo: 1 });
			const serverStatus = await this.db.admin().command({ serverStatus: 1 });

			return {
				version: buildInfo.version ?? "unknown",
				gitVersion: buildInfo.gitVersion ?? "unknown",
				modules: buildInfo.modules ?? [],
				openSSL: buildInfo.openssl?.running ?? "N/A",
				allocator: buildInfo.allocator ?? "unknown",
				javascriptEngine: buildInfo.javascriptEngine ?? "unknown",
				storageEngines: buildInfo.storageEngines ?? [],
				currentStorageEngine: serverStatus.storageEngine?.name ?? "unknown",
				platform: buildInfo.platform,
				bits: buildInfo.bits,
			};
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getServerInfo",
			});
			return {
				version: "unknown",
				gitVersion: "unknown",
				modules: [],
				openSSL: "N/A",
				allocator: "unknown",
				javascriptEngine: "unknown",
				storageEngines: [],
				currentStorageEngine: "unknown",
			};
		}
	}

	async getWiredTigerStats(): Promise<WiredTigerStats | null> {
		try {
			const serverStatus = await this.db.admin().command({ serverStatus: 1 });
			const wt = serverStatus.wiredTiger;

			if (!wt) return null;

			const cache = wt.cache ?? {};
			const bytesTotal = cache["bytes currently in the cache"] ?? 0;
			const bytesMax = cache["maximum bytes configured"] ?? 1;
			const bytesDirty = cache["tracked dirty bytes in the cache"] ?? 0;
			const pagesRead = cache["pages read into cache"] ?? 0;
			const pagesWritten = cache["pages written from cache"] ?? 0;
			const bytesRead = cache["bytes read into cache"] ?? 0;
			const bytesWritten = cache["bytes written from cache"] ?? 0;
			const evictedPages = cache["unmodified pages evicted"] ?? 0;

			const hits = cache["pages requested from the cache"] ?? 0;
			const misses = cache["pages not found in the cache"] ?? 0;
			const hitRatio = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 100;

			const checkpoint = wt.checkpoint;
			const checkpointTime =
				checkpoint?.["most recent checkpoint time (msecs)"];

			return {
				cacheSize: formatBytes(bytesMax),
				cacheSizeBytes: bytesMax,
				cacheUsed: formatBytes(bytesTotal),
				cacheUsedBytes: bytesTotal,
				cacheDirty: formatBytes(bytesDirty),
				cacheDirtyBytes: bytesDirty,
				cacheHitRatio: Math.round(hitRatio * 100) / 100,
				pagesRead,
				pagesWritten,
				bytesRead,
				bytesWritten,
				evictedPages,
				checkpointTime,
			};
		} catch {
			return null;
		}
	}

	async getOplogStats(): Promise<OplogStats | null> {
		try {
			const localDb = this.client.db("local");
			const oplogStats = await localDb.command({ collStats: "oplog.rs" });

			const oplog = localDb.collection("oplog.rs");
			const [first, last] = await Promise.all([
				oplog.findOne({}, { sort: { $natural: 1 } }),
				oplog.findOne({}, { sort: { $natural: -1 } }),
			]);

			const firstTs = first?.ts ? this.getTimestampSeconds(first.ts) : 0;
			const lastTs = last?.ts ? this.getTimestampSeconds(last.ts) : 0;
			const timeDiffSeconds = lastTs - firstTs;

			let opsPerSecond: number | undefined;
			if (timeDiffSeconds > 0) {
				try {
					const opCount = await oplog.estimatedDocumentCount();
					opsPerSecond = Math.round(opCount / timeDiffSeconds);
				} catch {}
			}

			return {
				size: formatBytes(oplogStats.maxSize ?? 0),
				sizeBytes: oplogStats.maxSize ?? 0,
				usedSize: formatBytes(oplogStats.size ?? 0),
				usedSizeBytes: oplogStats.size ?? 0,
				timeDiffSeconds,
				timeDiffHours: Math.round((timeDiffSeconds / 3600) * 100) / 100,
				firstEntry: firstTs > 0 ? new Date(firstTs * 1000) : null,
				lastEntry: lastTs > 0 ? new Date(lastTs * 1000) : null,
				opsPerSecond,
			};
		} catch {
			return null;
		}
	}

	async getOperationStats(): Promise<OperationStats | null> {
		try {
			const serverStatus = await this.db.admin().command({ serverStatus: 1 });
			const opcounters = serverStatus.opcounters ?? {};
			const uptime = serverStatus.uptime ?? 1;

			const insertsPerSec = Math.round((opcounters.insert ?? 0) / uptime);
			const queriesPerSec = Math.round((opcounters.query ?? 0) / uptime);
			const updatesPerSec = Math.round((opcounters.update ?? 0) / uptime);
			const deletesPerSec = Math.round((opcounters.delete ?? 0) / uptime);
			const getmorePerSec = Math.round((opcounters.getmore ?? 0) / uptime);
			const commandsPerSec = Math.round((opcounters.command ?? 0) / uptime);

			const totalReads = queriesPerSec + getmorePerSec;
			const totalWrites = insertsPerSec + updatesPerSec + deletesPerSec;
			const totalOpsPerSec = totalReads + totalWrites + commandsPerSec;

			let readWriteRatio = "N/A";
			if (totalWrites > 0) {
				const ratio = totalReads / totalWrites;
				readWriteRatio = `${ratio.toFixed(2)}:1`;
			} else if (totalReads > 0) {
				readWriteRatio = "Read-only";
			}

			return {
				insertsPerSec,
				queriesPerSec,
				updatesPerSec,
				deletesPerSec,
				getmorePerSec,
				commandsPerSec,
				totalOpsPerSec,
				readWriteRatio,
			};
		} catch {
			return null;
		}
	}

	async getLockStats(): Promise<LockStats | null> {
		try {
			const serverStatus = await this.db.admin().command({ serverStatus: 1 });
			const globalLock = serverStatus.globalLock ?? {};
			const locks = serverStatus.locks?.Global ?? {};

			return {
				globalLockTotal: locks.acquireCount?.r ?? 0,
				globalLockTimeUs: globalLock.totalTime ?? 0,
				currentQueueReaders: globalLock.currentQueue?.readers ?? 0,
				currentQueueWriters: globalLock.currentQueue?.writers ?? 0,
				activeReaders: globalLock.activeClients?.readers ?? 0,
				activeWriters: globalLock.activeClients?.writers ?? 0,
			};
		} catch {
			return null;
		}
	}

	async getTTLIndexes(): Promise<TTLIndexInfo[]> {
		const ttlIndexes: TTLIndexInfo[] = [];

		try {
			const collections = await this.db.listCollections().toArray();

			for (const coll of collections) {
				if (coll.name.startsWith("system.")) continue;

				try {
					const indexes = await this.db
						.collection(coll.name)
						.listIndexes()
						.toArray();

					for (const idx of indexes) {
						if (idx.expireAfterSeconds !== undefined) {
							const field = Object.keys(idx.key)[0];
							const seconds = idx.expireAfterSeconds;

							let expireAfterFormatted: string;
							if (seconds < 60) {
								expireAfterFormatted = `${seconds} seconds`;
							} else if (seconds < 3600) {
								expireAfterFormatted = `${Math.round(seconds / 60)} minutes`;
							} else if (seconds < 86400) {
								expireAfterFormatted = `${Math.round(seconds / 3600)} hours`;
							} else {
								expireAfterFormatted = `${Math.round(seconds / 86400)} days`;
							}

							ttlIndexes.push({
								collection: coll.name,
								indexName: idx.name,
								field,
								expireAfterSeconds: seconds,
								expireAfterFormatted,
							});
						}
					}
				} catch {
					// Skip collections we can't access
				}
			}
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getTTLIndexes",
			});
		}

		return ttlIndexes;
	}

	async getDocumentSizeDistribution(
		collectionName: string,
		sampleSize = 1000,
	): Promise<DocumentSizeDistribution | null> {
		try {
			const collection = this.db.collection(collectionName);

			const samples = await collection
				.aggregate([
					{ $sample: { size: sampleSize } },
					{
						$project: {
							docSize: { $bsonSize: "$$ROOT" },
						},
					},
				])
				.toArray();

			if (samples.length === 0) return null;

			const sizes = samples
				.map((s) => s.docSize as number)
				.sort((a, b) => a - b);
			const avgDocSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
			const minDocSize = sizes[0];
			const maxDocSize = sizes[sizes.length - 1];
			const medianDocSize = sizes[Math.floor(sizes.length / 2)];

			const buckets = [
				{ max: 1024, label: "< 1 KB" },
				{ max: 10240, label: "1-10 KB" },
				{ max: 102400, label: "10-100 KB" },
				{ max: 1048576, label: "100 KB - 1 MB" },
				{ max: Number.POSITIVE_INFINITY, label: "> 1 MB" },
			];

			const distribution = buckets.map((bucket) => {
				const count = sizes.filter(
					(s) =>
						s <= bucket.max &&
						(bucket === buckets[0] ||
							s > buckets[buckets.indexOf(bucket) - 1].max),
				).length;
				return {
					bucket: bucket.label,
					count,
					percentage: Math.round((count / sizes.length) * 100),
				};
			});

			const oversizedCount = sizes.filter((s) => s > 1048576).length;

			return {
				collection: collectionName,
				sampleSize: sizes.length,
				avgDocSize: Math.round(avgDocSize),
				avgDocSizeFormatted: formatBytes(avgDocSize),
				minDocSize,
				maxDocSize,
				medianDocSize,
				distribution,
				oversizedCount,
			};
		} catch {
			return null;
		}
	}

	async getConfigurationSettings(): Promise<ConfigurationSetting[]> {
		const settings: ConfigurationSetting[] = [];

		try {
			const serverStatus = await this.db.admin().command({ serverStatus: 1 });
			const cmdLineOpts = await this.db
				.admin()
				.command({ getCmdLineOpts: 1 })
				.catch(() => null);

			settings.push({
				name: "storageEngine",
				value: serverStatus.storageEngine?.name ?? "unknown",
				description: "Current storage engine",
				category: "storage",
			});

			if (serverStatus.wiredTiger?.cache) {
				const cacheSize =
					serverStatus.wiredTiger.cache["maximum bytes configured"];
				settings.push({
					name: "wiredTiger.cacheSizeGB",
					value: `${(cacheSize / (1024 * 1024 * 1024)).toFixed(2)} GB`,
					description: "WiredTiger cache size",
					category: "storage",
				});
			}

			const connAvailable = serverStatus.connections?.available ?? 0;
			const connCurrent = serverStatus.connections?.current ?? 0;
			settings.push({
				name: "net.maxIncomingConnections",
				value: String(connAvailable + connCurrent),
				description: "Maximum number of incoming connections",
				category: "network",
			});

			const profile = await this.db.command({ profile: -1 });
			settings.push({
				name: "operationProfiling.mode",
				value: profile.was === 0 ? "off" : profile.was === 1 ? "slowOp" : "all",
				description: "Database profiling level",
				category: "profiling",
			});

			if (profile.slowms !== undefined) {
				settings.push({
					name: "operationProfiling.slowOpThresholdMs",
					value: String(profile.slowms),
					description: "Slow operation threshold in milliseconds",
					category: "profiling",
				});
			}

			if (cmdLineOpts?.parsed) {
				const parsed = cmdLineOpts.parsed;
				if (parsed.storage?.dbPath) {
					settings.push({
						name: "storage.dbPath",
						value: parsed.storage.dbPath,
						description: "Database path",
						category: "storage",
					});
				}
				if (parsed.net?.port) {
					settings.push({
						name: "net.port",
						value: String(parsed.net.port),
						description: "Network port",
						category: "network",
					});
				}
				if (parsed.net?.bindIp) {
					settings.push({
						name: "net.bindIp",
						value: parsed.net.bindIp,
						description: "Bind IP addresses",
						category: "network",
					});
				}
			}
		} catch (error) {
			this.errorCollector.addFromUnknown(error, {
				operation: "getConfigurationSettings",
			});
		}

		return settings;
	}

	/**
	 * Generate comprehensive health report
	 */
	generateHealthReport(metrics: DatabaseMetrics): HealthReport {
		const issues: HealthReport["issues"] = [];
		const recommendations: string[] = [];
		let healthScore = 100;

		if (metrics.cacheHitRatio < THRESHOLDS.cache.poor) {
			healthScore -= THRESHOLDS.healthScore.lowCacheHitPenalty;
			issues.push({
				category: "Cache",
				severity: "critical",
				message: `Very low cache hit ratio: ${metrics.cacheHitRatio.toFixed(1)}%`,
				impact:
					"Queries reading from disk instead of memory, causing slow performance",
			});
			recommendations.push(
				"Urgently increase WiredTiger cache size or add more RAM.",
			);
		} else if (metrics.cacheHitRatio < THRESHOLDS.cache.acceptable) {
			healthScore -= THRESHOLDS.healthScore.lowCacheHitPenalty;
			issues.push({
				category: "Cache",
				severity: "high",
				message: `Low cache hit ratio: ${metrics.cacheHitRatio.toFixed(1)}%`,
				impact: "Reduced query performance due to disk reads",
			});
			recommendations.push(
				"Consider increasing WiredTiger cache size or adding more RAM.",
			);
		} else if (metrics.cacheHitRatio < THRESHOLDS.cache.optimal) {
			healthScore -= THRESHOLDS.healthScore.suboptimalCachePenalty;
			issues.push({
				category: "Cache",
				severity: "medium",
				message: `Suboptimal cache hit ratio: ${metrics.cacheHitRatio.toFixed(1)}%`,
				impact: "Minor performance impact from occasional disk reads",
			});
		}

		const totalConnections =
			metrics.currentConnections + metrics.availableConnections;
		const connectionUsage =
			totalConnections > 0
				? (metrics.currentConnections / totalConnections) * 100
				: 0;

		if (connectionUsage > THRESHOLDS.connections.criticalUsage) {
			healthScore -= THRESHOLDS.healthScore.highConnectionPenalty;
			issues.push({
				category: "Connections",
				severity: "critical",
				message: `Critical connection usage: ${connectionUsage.toFixed(1)}%`,
				impact: "New connections may be rejected",
			});
			recommendations.push(
				"Immediately increase maxIncomingConnections or implement connection pooling.",
			);
		} else if (connectionUsage > THRESHOLDS.connections.highUsage) {
			healthScore -= THRESHOLDS.healthScore.highConnectionPenalty;
			issues.push({
				category: "Connections",
				severity: "high",
				message: `High connection usage: ${metrics.currentConnections}/${totalConnections}`,
				impact: "Limited headroom for new connections",
			});
			recommendations.push(
				"Consider increasing maxIncomingConnections or using connection pooling.",
			);
		}

		const indexRatio =
			metrics.databaseSizeBytes > 0
				? (metrics.indexSizeBytes / metrics.databaseSizeBytes) * 100
				: 0;

		if (indexRatio > THRESHOLDS.indexes.criticalIndexRatio) {
			healthScore -= THRESHOLDS.healthScore.highIndexRatioPenalty;
			issues.push({
				category: "Indexes",
				severity: "high",
				message: `Index size exceeds data size: ${indexRatio.toFixed(1)}%`,
				impact: "Excessive memory usage and slower writes",
			});
			recommendations.push("Review indexes for unused or redundant indexes.");
		} else if (indexRatio > THRESHOLDS.indexes.highIndexRatio) {
			healthScore -= THRESHOLDS.healthScore.highIndexRatioPenalty / 2;
			issues.push({
				category: "Indexes",
				severity: "medium",
				message: `High index-to-data ratio: ${indexRatio.toFixed(1)}%`,
				impact: "May indicate unused or redundant indexes",
			});
		}

		let status: HealthReport["status"];
		if (healthScore >= 90) status = "excellent";
		else if (healthScore >= 75) status = "good";
		else if (healthScore >= 60) status = "fair";
		else if (healthScore >= 40) status = "poor";
		else status = "critical";

		return {
			healthScore: Math.max(0, healthScore),
			status,
			issues,
			recommendations,
		};
	}

	/**
	 * Legacy method for backward compatibility
	 */
	generateMetricsReport(metrics: DatabaseMetrics): {
		healthScore: number;
		issues: string[];
		recommendations: string[];
	} {
		const report = this.generateHealthReport(metrics);
		return {
			healthScore: report.healthScore,
			issues: report.issues.map((i) => i.message),
			recommendations: report.recommendations,
		};
	}

	/**
	 * Get errors collected during analysis
	 */
	getErrors() {
		return this.errorCollector.getErrors();
	}

	private calculateCacheHitRatio(serverStatus: any): number {
		if (!serverStatus?.wiredTiger?.cache) {
			// Return -1 to indicate unavailable data (e.g. insufficient permissions)
			// rather than masking the issue as a perfect 100%
			return -1;
		}

		const cache = serverStatus.wiredTiger.cache;
		const hits = cache["pages requested from the cache"] ?? 0;
		const misses = cache["pages not found in the cache"] ?? 0;

		if (hits + misses === 0) return 100;

		return Math.round((hits / (hits + misses)) * 10000) / 100;
	}

	private getTimestampSeconds(ts: any): number {
		// Handle MongoDB Timestamp type
		if (ts && typeof ts.getHighBits === "function") {
			return ts.getHighBits();
		}
		// Handle Date
		if (ts instanceof Date) {
			return Math.floor(ts.getTime() / 1000);
		}
		// Handle number (already seconds)
		if (typeof ts === "number") {
			return ts;
		}
		return 0;
	}
}
