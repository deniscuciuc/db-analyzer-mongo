/** Connection details for a MongoDB deployment. */
export interface MongoConnectionConfig {
	/** A full `mongodb://` or `mongodb+srv://` URI, taking precedence over the fields below. */
	uri?: string;
	host: string;
	port: number;
	database: string;
	user?: string;
	password?: string;
	authSource: string;
}

/** Builds a connection URI from the supplied parts, or returns `uri` unchanged when set. */
export function buildConnectionUri(config: MongoConnectionConfig): string {
	if (config.uri) {
		return config.uri;
	}

	if (config.user && config.password) {
		return `mongodb://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}?authSource=${config.authSource}`;
	}

	return `mongodb://${config.host}:${config.port}/${config.database}`;
}

/** Extracts the database name from a connection string, if it carries one. */
export function parseDatabaseFromConnectionString(
	connectionString: string,
): string | undefined {
	try {
		// URL cannot parse the mongodb+srv scheme, so normalize it first.
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
