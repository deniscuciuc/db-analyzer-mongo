/**
 * Custom error types for MongoDB Analyzer
 */

export type AnalysisErrorType =
	| "connection"
	| "permission"
	| "timeout"
	| "version"
	| "validation"
	| "unknown";

export type AnalysisErrorSeverity = "fatal" | "warning" | "info";

export interface AnalysisErrorDetails {
	type: AnalysisErrorType;
	severity: AnalysisErrorSeverity;
	message: string;
	collection?: string;
	operation?: string;
	originalError?: Error;
	code?: number;
}

/**
 * Custom error class for analysis operations
 */
export class AnalysisError extends Error {
	readonly type: AnalysisErrorType;
	readonly severity: AnalysisErrorSeverity;
	readonly collection?: string;
	readonly operation?: string;
	readonly originalError?: Error;
	readonly code?: number;

	constructor(details: AnalysisErrorDetails) {
		super(details.message);
		this.name = "AnalysisError";
		this.type = details.type;
		this.severity = details.severity;
		this.collection = details.collection;
		this.operation = details.operation;
		this.originalError = details.originalError;
		this.code = details.code;
	}

	toJSON(): AnalysisErrorDetails {
		return {
			type: this.type,
			severity: this.severity,
			message: this.message,
			collection: this.collection,
			operation: this.operation,
			code: this.code,
		};
	}
}

/**
 * Classify MongoDB error into AnalysisErrorType
 */
export function classifyMongoError(error: unknown): AnalysisErrorType {
	if (!(error instanceof Error)) return "unknown";

	const message = error.message.toLowerCase();
	const name = error.name.toLowerCase();

	// Connection errors
	if (
		name.includes("mongonetworkerror") ||
		message.includes("connection") ||
		message.includes("connect econnrefused") ||
		message.includes("topology was destroyed")
	) {
		return "connection";
	}

	// Permission errors
	if (
		message.includes("not authorized") ||
		message.includes("authentication failed") ||
		message.includes("requires authentication") ||
		(error as any).code === 13 ||
		(error as any).code === 18
	) {
		return "permission";
	}

	// Timeout errors
	if (
		message.includes("timeout") ||
		message.includes("timed out") ||
		(error as any).code === 50
	) {
		return "timeout";
	}

	// Version/compatibility errors
	if (
		message.includes("unknown command") ||
		message.includes("no such cmd") ||
		message.includes("not supported")
	) {
		return "version";
	}

	return "unknown";
}

/**
 * Create AnalysisError from unknown error
 */
export function createAnalysisError(
	error: unknown,
	context?: {
		collection?: string;
		operation?: string;
		severity?: AnalysisErrorSeverity;
	},
): AnalysisError {
	const originalError =
		error instanceof Error ? error : new Error(String(error));
	const type = classifyMongoError(error);

	let severity: AnalysisErrorSeverity = context?.severity ?? "warning";
	if (type === "connection" || type === "permission") {
		severity = "fatal";
	}

	return new AnalysisError({
		type,
		severity,
		message: originalError.message,
		collection: context?.collection,
		operation: context?.operation,
		originalError,
		code: (error as any)?.code,
	});
}

/**
 * Error collector for batch operations
 */
export class ErrorCollector {
	private errors: AnalysisError[] = [];

	add(error: AnalysisError): void {
		this.errors.push(error);
	}

	addFromUnknown(
		error: unknown,
		context?: { collection?: string; operation?: string },
	): void {
		this.errors.push(createAnalysisError(error, context));
	}

	getErrors(): AnalysisError[] {
		return [...this.errors];
	}

	getFatalErrors(): AnalysisError[] {
		return this.errors.filter((e) => e.severity === "fatal");
	}

	getWarnings(): AnalysisError[] {
		return this.errors.filter((e) => e.severity === "warning");
	}

	hasFatalErrors(): boolean {
		return this.errors.some((e) => e.severity === "fatal");
	}

	hasErrors(): boolean {
		return this.errors.length > 0;
	}

	clear(): void {
		this.errors = [];
	}

	toJSON(): AnalysisErrorDetails[] {
		return this.errors.map((e) => e.toJSON());
	}
}
