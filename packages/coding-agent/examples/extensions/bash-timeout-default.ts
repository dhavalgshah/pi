/**
 * Bash Timeout Default Example
 *
 * Applies a default timeout and an upper cap to shell tool calls via the
 * `tool_call` event (pattern: permission-gate.ts mutates `event.input` in place),
 * and coaches the model on core timeout results via `tool_result`.
 *
 * Without this, `timeout` is optional with no default: a hanging command
 * (e.g. `psql` waiting on a connection) stalls the agent loop indefinitely.
 * Covers `bash` and `powershell` (same opt-in timeout, same missing default).
 * Core throws on timeout 0, so there is no opt-out to preserve: invalid
 * values coerce to the default, matching core's validation.
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

export const SHELL_TIMEOUT_TOOLS = ["bash", "powershell"];

const TIMEOUT_TEXT = /Command timed out after \d+ seconds/;
const TIMEOUT_NOTE =
	"[note: retry with a larger timeout if the command needs it, or run it via bash_bg and read back with shell_output]";

// Pinned to core's message in src/core/tools/bash.ts (`Command timed out after N seconds`).
export function timeoutNote(text: string): string | undefined {
	if (!TIMEOUT_TEXT.test(text)) return undefined;
	if (text.includes(TIMEOUT_NOTE)) return undefined;
	return `${text}\n\n${TIMEOUT_NOTE}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!SHELL_TIMEOUT_TOOLS.includes(event.toolName)) return undefined;
		event.input.timeout = resolveBashTimeout(event.input.timeout as unknown);
		return undefined;
	});
	pi.on("tool_result", async (event) => {
		if (!SHELL_TIMEOUT_TOOLS.includes(event.toolName)) return undefined;
		const text = event.content
			.filter((b): b is { type: "text"; text: string } => b.type === "text")
			.map((b) => b.text)
			.join("\n");
		const noted = timeoutNote(text);
		if (!noted) return undefined;
		return { content: [{ type: "text" as const, text: noted }] };
	});
}
