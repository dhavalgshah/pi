/**
 * Bash Benign Exit Example
 *
 * Annotates `grep`/`rg`/`diff` exit code 1 ("no matches") as a benign result
 * instead of an error. The bash tool rejects any non-zero exit, so a plain
 * "no matches" arrives as `isError: true` and models retry a query that
 * already answered itself.
 *
 * Usage:
 *   pi -e ./bash-benign-exit.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BENIGN_COMMAND = /^\s*(grep|rg|diff)\b/;
const EXIT_1 = /Command exited with code 1(\s|$)/;
const NOTE = "[note: exit 1 here means 'no matches found', not an error — do not retry]";

export interface BenignExitInput {
	toolName: string;
	command: string;
	isError: boolean;
	text: string;
}

export function benignExitPatch(input: BenignExitInput): { content: string; isError: false } | undefined {
	if (input.toolName !== "bash" || !input.isError) return undefined;
	if (!BENIGN_COMMAND.test(input.command)) return undefined;
	if (!EXIT_1.test(input.text)) return undefined;
	if (input.text.includes(NOTE)) return undefined;
	return { content: `${input.text}\n\n${NOTE}`, isError: false };
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return undefined;
		const text = event.content
			.filter((b): b is { type: "text"; text: string } => b.type === "text")
			.map((b) => b.text)
			.join("\n");
		const command = typeof event.input.command === "string" ? event.input.command : "";
		const patch = benignExitPatch({ toolName: event.toolName, command, isError: event.isError, text });
		if (!patch) return undefined;
		return { content: [{ type: "text" as const, text: patch.content }], isError: patch.isError };
	});
}
