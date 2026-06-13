import { WATCH_ALLOWED, WATCH_BLOCKED } from "../constants";

const CLEAR = "\x1Bc";

export interface WatchOptions {
	intervalSeconds: number;
	command: string;
	runCommand: () => Promise<void>;
}

export function validateWatchCommand(command: string): void {
	if (WATCH_BLOCKED.has(command as never)) {
		throw new Error(
			`--watch cannot be used with '${command}' (write operation).`,
		);
	}

	if (!WATCH_ALLOWED.has(command as never)) {
		throw new Error(
			`--watch is not supported for '${command}'. Supported: ${Array.from(WATCH_ALLOWED).join(", ")}`,
		);
	}
}

export async function runWatchLoop(options: WatchOptions): Promise<void> {
	validateWatchCommand(options.command);

	let stopped = false;
	const handleSigInt = () => {
		stopped = true;
	};

	process.on("SIGINT", handleSigInt);

	try {
		while (!stopped) {
			process.stdout.write(CLEAR);
			process.stdout.write(
				`[watch] command: ${options.command} | interval: ${options.intervalSeconds}s | updated: ${new Date().toLocaleTimeString()} | Ctrl+C to stop\n\n`,
			);

			try {
				await options.runCommand();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(`\nWatch iteration failed: ${message}\n`);
			}

			for (
				let remaining = options.intervalSeconds;
				remaining > 0;
				remaining--
			) {
				if (stopped) {
					break;
				}

				process.stdout.write(`\rNext update in ${remaining}s...   `);
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			if (!stopped) {
				process.stdout.write("\r");
			}
		}
	} finally {
		process.off("SIGINT", handleSigInt);
		process.stdout.write("\nWatch stopped.\n");
	}
}
