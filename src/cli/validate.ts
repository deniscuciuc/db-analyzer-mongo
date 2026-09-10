import { COMMANDS, DESTRUCTIVE_COMMANDS } from "../constants";
import type { ParsedOptions } from "./options";

/** Reject an unrecognised --command instead of silently running a full analysis. */
export function assertKnownCommand(command: string): void {
	if (!(COMMANDS as readonly string[]).includes(command)) {
		throw new Error(
			`Unknown command: ${command}. Run --help for the list of commands.`,
		);
	}
}

/**
 * Require an explicit --yes before a command that changes server state. The
 * interactive menus prompt instead, so this only gates non-interactive runs.
 */
export function assertConfirmedIfDestructive(options: ParsedOptions): void {
	if (!DESTRUCTIVE_COMMANDS.has(options.command as never)) {
		return;
	}

	if (options.dryRun || options.yes) {
		return;
	}

	throw new Error(
		`${options.command} changes server state. Re-run with --yes to confirm, or --dry-run to preview.`,
	);
}
