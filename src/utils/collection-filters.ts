export function filterCollectionNames(
	collectionNames: string[],
	selectedCollections?: string[],
): string[] {
	if (!selectedCollections || selectedCollections.length === 0) {
		return collectionNames;
	}

	const filterSet = new Set(selectedCollections);
	return collectionNames.filter((name) => filterSet.has(name));
}

export function buildNamespaceFilter(
	databaseName: string,
	selectedCollections?: string[],
): Record<string, unknown> {
	if (!selectedCollections || selectedCollections.length === 0) {
		return {};
	}

	return {
		ns: {
			$in: selectedCollections.map(
				(collectionName) => `${databaseName}.${collectionName}`,
			),
		},
	};
}

export function getCollectionNameFromNamespace(
	namespace: string,
	databaseName: string,
): string {
	if (namespace.startsWith(`${databaseName}.`)) {
		return namespace.slice(databaseName.length + 1);
	}

	return namespace.split(".").slice(1).join(".");
}
