import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { ThresholdOverrides } from "./types";

export interface ProfileConfig {
	uri?: string;
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	authSource?: string;
}

export interface AnalyzerConfig {
	profiles?: Record<string, ProfileConfig>;
	defaultProfile?: string;
	thresholds?: ThresholdOverrides;
	output?: string;
	slowQueryThreshold?: number;
	minIndexAccesses?: number;
}

function parseConfig(candidate: string): AnalyzerConfig {
	return JSON.parse(readFileSync(candidate, "utf-8")) as AnalyzerConfig;
}

export function loadConfig(configPath?: string): AnalyzerConfig {
	if (configPath) {
		const explicitPath = resolve(configPath);
		if (!existsSync(explicitPath)) {
			throw new Error(`Config file not found: ${explicitPath}`);
		}

		try {
			return parseConfig(explicitPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Could not parse config file at ${explicitPath}: ${message}`,
			);
		}
	}

	const candidates = [
		join(process.cwd(), ".analyzerrc.json"),
		join(homedir(), ".config", "db-analyzer", "config.json"),
	];

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}

		try {
			return parseConfig(candidate);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`Warning: could not parse config file at ${candidate}: ${message}`,
			);
		}
	}

	return {};
}

export function resolveProfile(
	config: AnalyzerConfig,
	profileName?: string,
): ProfileConfig {
	if (!config.profiles) {
		if (profileName) {
			throw new Error(
				`Profile "${profileName}" was requested, but no profiles were found in the config file.`,
			);
		}

		return {};
	}

	const name = profileName ?? config.defaultProfile;
	if (!name) {
		return {};
	}

	const profile = config.profiles[name];
	if (!profile) {
		throw new Error(`Profile "${name}" not found in config file.`);
	}

	return profile;
}
