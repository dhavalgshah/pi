/**
 * Bash Timeout Default Example
 *
 * Applies a default timeout and an upper cap to bash tool calls via the
 * `tool_call` event (pattern: permission-gate.ts mutates `event.input` in place).
 *
 * Without this, `timeout` is optional with no default: a hanging command
 * (e.g. `psql` waiting on a connection) stalls the agent loop indefinitely.
 *
 * Usage:
 *   pi -e ./bash-timeout-default.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const BASH_DEFAULT_TIMEOUT = 30;
export const BASH_MAX_TIMEOUT = 600;

export function resolveBashTimeout(input: unknown): number {
	if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) {
		return BASH_DEFAULT_TIMEOUT;
	}
	return Math.min(input, BASH_MAX_TIMEOUT);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return undefined;
		event.input.timeout = resolveBashTimeout(event.input.timeout as unknown);
		return undefined;
	});
}
