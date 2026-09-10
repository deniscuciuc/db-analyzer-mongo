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

	if (
		!Number.isFinite(options.intervalSeconds) ||
		options.intervalSeconds <= 0
	) {
		throw new Error(`Invalid watch interval: ${options.intervalSeconds}`);
	}

	let stopped = false;
	let pendingTimer: NodeJS.Timeout | undefined;
	let signalCount = 0;

	// The loop stops at the next checkpoint rather than mid-query, so the first
	// signal is a graceful stop. A second one means the user is waiting on a slow
	// round-trip and wants out now — restore the default behaviour so Ctrl+C
	// actually exits instead of appearing to hang.
	const requestStop = (signal: NodeJS.Signals) => {
		stopped = true;
		signalCount++;

		if (pendingTimer) {
			clearTimeout(pendingTimer);
			pendingTimer = undefined;
		}

		if (signalCount === 1) {
			process.stdout.write(
				"\nStopping after the current iteration (press again to exit now)...\n",
			);
			return;
		}

		detach();
		process.kill(process.pid, signal);
	};

	const handleSigInt = () => requestStop("SIGINT");
	const handleSigTerm = () => requestStop("SIGTERM");

	function detach(): void {
		process.off("SIGINT", handleSigInt);
		process.off("SIGTERM", handleSigTerm);
	}

	process.on("SIGINT", handleSigInt);
	// Without this, `docker stop` skips the caller's connection cleanup.
	process.on("SIGTERM", handleSigTerm);

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
				await new Promise<void>((resolve) => {
					pendingTimer = setTimeout(() => {
						pendingTimer = undefined;
						resolve();
					}, 1000);
				});
			}

			if (!stopped) {
				process.stdout.write("\r");
			}
		}
	} finally {
		if (pendingTimer) {
			clearTimeout(pendingTimer);
		}
		detach();
		process.stdout.write("\nWatch stopped.\n");
	}
}
