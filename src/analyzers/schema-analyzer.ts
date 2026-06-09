import type { Db } from "mongodb";
import type {
	AnalyzerOptions,
	FieldInfo,
	FieldTypeStats,
	SchemaAnalysis,
	SchemaIssue,
} from "../types";
import { ErrorCollector } from "../utils/errors";
import { formatBytes } from "../utils/formatting";

/**
 * Schema Analyzer - analyzes document structure and field usage
 */
export class SchemaAnalyzer {
	private errorCollector = new ErrorCollector();

	constructor(
		private db: Db,
		private options: AnalyzerOptions = {},
	) {}

	/**
	 * Analyze schema for a single collection
	 */
	async analyzeCollection(
		collectionName: string,
		sampleSize = 1000,
	): Promise<SchemaAnalysis> {
		const collection = this.db.collection(collectionName);

		const documentCount = await collection.estimatedDocumentCount();

		const actualSampleSize = Math.min(sampleSize, documentCount);
		const documents = await collection
			.aggregate([{ $sample: { size: actualSampleSize } }])
			.toArray();

		const fieldMap = new Map<
			string,
			{
				types: Map<string, number>;
				count: number;
				isArray: boolean;
				hasNestedObjects: boolean;
				arrayLengths: number[];
				stringLengths: number[];
				numericValues: number[];
				dateValues: Date[];
				distinctValues: Set<string>;
			}
		>();

		for (const doc of documents) {
			this.analyzeDocument(doc, "", fieldMap);
		}

		const fields: FieldInfo[] = [];
		for (const [path, data] of fieldMap) {
			const typeStats: FieldTypeStats[] = [];
			for (const [type, count] of data.types) {
				typeStats.push({
					type,
					count,
					percentage: Math.round((count / data.count) * 10000) / 100,
				});
			}
			typeStats.sort((a, b) => b.count - a.count);

			const fieldInfo: FieldInfo = {
				path,
				types: typeStats,
				presence: Math.round((data.count / actualSampleSize) * 10000) / 100,
				isArray: data.isArray,
				hasNestedObjects: data.hasNestedObjects,
			};

			if (data.arrayLengths.length > 0) {
				fieldInfo.avgArrayLength =
					Math.round(
						(data.arrayLengths.reduce((a, b) => a + b, 0) /
							data.arrayLengths.length) *
							100,
					) / 100;
			}

			if (data.stringLengths.length > 0) {
				fieldInfo.avgStringLength = Math.round(
					data.stringLengths.reduce((a, b) => a + b, 0) /
						data.stringLengths.length,
				);
			}

			if (data.numericValues.length > 0) {
				fieldInfo.minValue = Math.min(...data.numericValues);
				fieldInfo.maxValue = Math.max(...data.numericValues);
			}

			if (data.dateValues.length > 0) {
				const sortedDates = data.dateValues.sort(
					(a, b) => a.getTime() - b.getTime(),
				);
				fieldInfo.minValue = sortedDates[0];
				fieldInfo.maxValue = sortedDates[sortedDates.length - 1];
			}

			if (data.distinctValues.size > 0 && data.distinctValues.size < 1000) {
				fieldInfo.distinctValuesEstimate = data.distinctValues.size;
			}

			fields.push(fieldInfo);
		}

		fields.sort((a, b) => b.presence - a.presence);

		const schemaVariance = this.calculateSchemaVariance(
			fields,
			actualSampleSize,
		);

		const recommendations = this.generateSchemaRecommendations(
			fields,
			schemaVariance,
		);

		const estimatedDocumentSize = this.estimateDocumentSize(documents);

		return {
			collection: collectionName,
			documentCount,
			sampleSize: actualSampleSize,
			fields,
			schemaVariance,
			recommendations,
			estimatedDocumentSize,
			estimatedDocumentSizeFormatted: formatBytes(estimatedDocumentSize),
		};
	}

	/**
	 * Analyze schema for all collections
	 */
	async analyzeAllSchemas(sampleSize = 1000): Promise<SchemaAnalysis[]> {
		const collections = await this.getCollections();
		const results: SchemaAnalysis[] = [];

		for (const collName of collections) {
			try {
				const analysis = await this.analyzeCollection(collName, sampleSize);
				results.push(analysis);
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "schema-analysis",
				});
			}
		}

		return results;
	}

	/**
	 * Find schema issues across collections
	 */
	async findSchemaIssues(sampleSize = 1000): Promise<SchemaIssue[]> {
		const issues: SchemaIssue[] = [];
		const collections = await this.getCollections();

		for (const collName of collections) {
			try {
				const analysis = await this.analyzeCollection(collName, sampleSize);

				for (const field of analysis.fields) {
					if (field.types.length > 1) {
						const nonNullTypes = field.types.filter(
							(t) => t.type !== "null" && t.type !== "undefined",
						);
						if (nonNullTypes.length > 1) {
							issues.push({
								collection: collName,
								field: field.path,
								issue: `Mixed types detected: ${nonNullTypes.map((t) => t.type).join(", ")}`,
								severity: "high",
								recommendation: `Standardize field type. Found: ${nonNullTypes.map((t) => `${t.type} (${t.percentage}%)`).join(", ")}`,
							});
						}
					}

					if (field.presence < 50 && field.presence > 5) {
						issues.push({
							collection: collName,
							field: field.path,
							issue: `Sparse field - present in only ${field.presence}% of documents`,
							severity: "low",
							recommendation:
								"Consider if this field should be required or moved to a separate collection",
						});
					}

					if (
						field.isArray &&
						field.avgArrayLength &&
						field.avgArrayLength > 100
					) {
						issues.push({
							collection: collName,
							field: field.path,
							issue: `Large array field - average length ${field.avgArrayLength}`,
							severity: "medium",
							recommendation:
								"Consider moving array elements to a separate collection with references",
						});
					}

					if (
						field.types.some((t) => t.type === "string") &&
						field.avgStringLength &&
						field.avgStringLength > 1000
					) {
						issues.push({
							collection: collName,
							field: field.path,
							issue: `Long string field - average length ${field.avgStringLength} characters`,
							severity: "low",
							recommendation:
								"Consider storing large text in GridFS or a separate collection",
						});
					}

					if (
						field.distinctValuesEstimate &&
						field.distinctValuesEstimate < 20 &&
						field.presence > 80
					) {
						issues.push({
							collection: collName,
							field: field.path,
							issue: `Low cardinality field - only ${field.distinctValuesEstimate} distinct values`,
							severity: "info",
							recommendation:
								"Consider using schema validation with enum constraint",
						});
					}
				}

				if (analysis.schemaVariance > 30) {
					issues.push({
						collection: collName,
						field: "_schema",
						issue: `High schema variance: ${analysis.schemaVariance}%`,
						severity: "medium",
						recommendation:
							"Consider standardizing document structure or using schema validation",
					});
				}
			} catch (error) {
				this.errorCollector.addFromUnknown(error, {
					collection: collName,
					operation: "find-schema-issues",
				});
			}
		}

		// Sort by severity
		const severityOrder = {
			critical: 0,
			high: 1,
			medium: 2,
			low: 3,
			info: 4,
		};
		issues.sort(
			(a, b) =>
				(severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
		);

		return issues;
	}

	/**
	 * Get field usage statistics across collection
	 */
	async getFieldUsageStats(collectionName: string): Promise<{
		collection: string;
		totalFields: number;
		requiredFields: FieldInfo[];
		optionalFields: FieldInfo[];
		rareFields: FieldInfo[];
	}> {
		const analysis = await this.analyzeCollection(collectionName);

		const requiredFields = analysis.fields.filter((f) => f.presence >= 99);
		const optionalFields = analysis.fields.filter(
			(f) => f.presence >= 50 && f.presence < 99,
		);
		const rareFields = analysis.fields.filter((f) => f.presence < 50);

		return {
			collection: collectionName,
			totalFields: analysis.fields.length,
			requiredFields,
			optionalFields,
			rareFields,
		};
	}

	/**
	 * Compare schemas between two collections
	 */
	async compareSchemas(
		collection1: string,
		collection2: string,
	): Promise<{
		commonFields: string[];
		onlyInFirst: string[];
		onlyInSecond: string[];
		typeMismatches: {
			field: string;
			type1: string;
			type2: string;
		}[];
	}> {
		const [schema1, schema2] = await Promise.all([
			this.analyzeCollection(collection1),
			this.analyzeCollection(collection2),
		]);

		const fields1 = new Map(schema1.fields.map((f) => [f.path, f]));
		const fields2 = new Map(schema2.fields.map((f) => [f.path, f]));

		const allFields = new Set([...fields1.keys(), ...fields2.keys()]);

		const commonFields: string[] = [];
		const onlyInFirst: string[] = [];
		const onlyInSecond: string[] = [];
		const typeMismatches: { field: string; type1: string; type2: string }[] =
			[];

		for (const field of allFields) {
			const f1 = fields1.get(field);
			const f2 = fields2.get(field);

			if (f1 && f2) {
				commonFields.push(field);
				const type1 = f1.types[0]?.type ?? "unknown";
				const type2 = f2.types[0]?.type ?? "unknown";
				if (type1 !== type2) {
					typeMismatches.push({ field, type1, type2 });
				}
			} else if (f1) {
				onlyInFirst.push(field);
			} else {
				onlyInSecond.push(field);
			}
		}

		return {
			commonFields,
			onlyInFirst,
			onlyInSecond,
			typeMismatches,
		};
	}

	/**
	 * Get errors collected during analysis
	 */
	getErrors() {
		return this.errorCollector.getErrors();
	}

	private analyzeDocument(
		doc: any,
		prefix: string,
		fieldMap: Map<string, any>,
	): void {
		for (const [key, value] of Object.entries(doc)) {
			if (key === "_id" && prefix === "") continue; // Skip _id at root level

			const path = prefix ? `${prefix}.${key}` : key;
			const type = this.getValueType(value);

			if (!fieldMap.has(path)) {
				fieldMap.set(path, {
					types: new Map<string, number>(),
					count: 0,
					isArray: false,
					hasNestedObjects: false,
					arrayLengths: [],
					stringLengths: [],
					numericValues: [],
					dateValues: [],
					distinctValues: new Set<string>(),
				});
			}

			const field = fieldMap.get(path)!;
			field.count++;
			field.types.set(type, (field.types.get(type) ?? 0) + 1);

			if (Array.isArray(value)) {
				field.isArray = true;
				field.arrayLengths.push(value.length);
				// Analyze array elements
				if (
					value.length > 0 &&
					typeof value[0] === "object" &&
					value[0] !== null
				) {
					field.hasNestedObjects = true;
					// Sample first element for nested schema
					this.analyzeDocument(value[0], `${path}[]`, fieldMap);
				}
			} else if (
				typeof value === "object" &&
				value !== null &&
				!(value instanceof Date)
			) {
				field.hasNestedObjects = true;
				this.analyzeDocument(value, path, fieldMap);
			} else if (typeof value === "string") {
				field.stringLengths.push(value.length);
				if (value.length < 100) {
					field.distinctValues.add(value);
				}
			} else if (typeof value === "number") {
				field.numericValues.push(value);
			} else if (value instanceof Date) {
				field.dateValues.push(value);
			}
		}
	}

	private getValueType(value: any): string {
		if (value === null) return "null";
		if (value === undefined) return "undefined";
		if (Array.isArray(value)) return "array";
		if (value instanceof Date) return "date";
		if (value instanceof RegExp) return "regex";
		if (typeof value === "object") {
			if (
				value._bsontype === "ObjectId" ||
				value.constructor?.name === "ObjectId"
			) {
				return "ObjectId";
			}
			if (value._bsontype === "Binary") return "binary";
			if (value._bsontype === "Decimal128") return "decimal128";
			return "object";
		}
		return typeof value;
	}

	private calculateSchemaVariance(
		fields: FieldInfo[],
		_sampleSize: number,
	): number {
		if (fields.length === 0) return 0;

		const presenceValues = fields.map((f) => f.presence);
		const avgPresence =
			presenceValues.reduce((a, b) => a + b, 0) / presenceValues.length;

		// Calculate standard deviation of presence
		const squaredDiffs = presenceValues.map((p) => (p - avgPresence) ** 2);
		const avgSquaredDiff =
			squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
		const stdDev = Math.sqrt(avgSquaredDiff);

		// Normalize to 0-100 scale
		return Math.min(100, Math.round(stdDev));
	}

	private generateSchemaRecommendations(
		fields: FieldInfo[],
		schemaVariance: number,
	): string[] {
		const recommendations: string[] = [];

		if (schemaVariance > 30) {
			recommendations.push(
				"High schema variance detected. Consider using MongoDB schema validation to enforce consistent document structure.",
			);
		}

		const deepNesting = fields.filter(
			(f) => f.path.split(".").length > 3 && f.hasNestedObjects,
		);
		if (deepNesting.length > 0) {
			recommendations.push(
				`Found ${deepNesting.length} fields with deep nesting (>3 levels). Consider flattening or normalizing data structure.`,
			);
		}

		const mixedTypeFields = fields.filter(
			(f) =>
				f.types.filter((t) => t.type !== "null" && t.type !== "undefined")
					.length > 1,
		);
		if (mixedTypeFields.length > 0) {
			recommendations.push(
				`Found ${mixedTypeFields.length} fields with mixed types. Standardize data types for consistency.`,
			);
		}

		const sparseFields = fields.filter(
			(f) => f.presence < 50 && f.presence > 5,
		);
		if (sparseFields.length > 5) {
			recommendations.push(
				`Found ${sparseFields.length} sparse fields. Consider restructuring or using separate collections for optional data.`,
			);
		}

		return recommendations;
	}

	private estimateDocumentSize(documents: any[]): number {
		if (documents.length === 0) return 0;

		// Estimate average document size using BSON serialization approximation
		let totalSize = 0;
		for (const doc of documents) {
			totalSize += this.estimateObjectSize(doc);
		}

		return Math.round(totalSize / documents.length);
	}

	private estimateObjectSize(obj: any): number {
		if (obj === null || obj === undefined) return 1;
		if (typeof obj === "boolean") return 1;
		if (typeof obj === "number") return 8;
		if (typeof obj === "string") return obj.length * 2 + 5;
		if (obj instanceof Date) return 8;
		if (Array.isArray(obj)) {
			return obj.reduce((sum, item) => sum + this.estimateObjectSize(item), 4);
		}
		if (typeof obj === "object") {
			let size = 4;
			for (const [key, value] of Object.entries(obj)) {
				size += key.length + 1 + this.estimateObjectSize(value);
			}
			return size;
		}
		return 1;
	}

	private async getCollections(): Promise<string[]> {
		const collections = await this.db.listCollections().toArray();
		const excludeCollections = this.options.excludeCollections ?? [];
		const includeSystem = this.options.includeSystemCollections ?? false;

		return collections
			.map((c) => c.name)
			.filter((name) => {
				if (excludeCollections.includes(name)) return false;
				if (!includeSystem && name.startsWith("system.")) return false;
				return true;
			});
	}
}
