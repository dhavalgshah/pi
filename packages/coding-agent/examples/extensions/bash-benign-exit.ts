/**
 * Bash Benign Exit Example
 *
 * Annotates `grep`/`rg`/`diff` exit code 1 as a benign result instead of an
 * error. The bash tool rejects any non-zero exit, so a plain "no matches"
 * arrives as `isError: true` and models retry a query that already answered
 * itself. `diff` exit 1 means "differences found" and is labeled as such.
 * Select-String (powershell) has different codes and stays out of scope.
 *
 * Usage:
 *   pi -e ./bash-benign-exit.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface BenignExitInput {
	toolName: string;
	command: string;
	isError: boolean;
	text: string;
}

// Pinned to core's message in src/core/tools/bash.ts
// (`Command exited with code N`); loosened to the code fragment so a
// rephrase that keeps the code still matches.
const EXIT_1 = /\bexited with code 1(\s|$)/;
const NOTE_GREP = "[note: exit 1 here means 'no matches found', not an error — do not retry]";
const NOTE_DIFF = "[note: exit 1 here means 'differences found', not an error — do not retry]";

const WRAPPERS = new Set(["sudo", "command", "time", "git", "env", "nice"]);

// First real command token, skipping sudo/env-style wrappers and VAR=x assignments.
export function commandName(command: string): string {
	for (const token of command.trim().split(/\s+/)) {
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
		if (WRAPPERS.has(token)) continue;
		const base = token.split("/").pop() ?? token;
		return base;
	}
	return "";
}

export function benignExitPatch(input: BenignExitInput): { content: string; isError: false } | undefined {
	if (input.toolName !== "bash" || !input.isError) return undefined;
	const name = commandName(input.command);
	const note = name === "diff" ? NOTE_DIFF : name === "grep" || name === "rg" ? NOTE_GREP : undefined;
	if (!note) return undefined;
	if (!EXIT_1.test(input.text)) return undefined;
	if (input.text.includes(note)) return undefined;
	return { content: `${input.text}\n\n${note}`, isError: false };
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
