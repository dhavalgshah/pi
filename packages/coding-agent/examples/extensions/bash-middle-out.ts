/**
 * Bash Middle-Out Example
 *
 * Reattaches the head of truncated bash output. Core truncates tail-only and
 * saves the full log to a temp file (`details.fullOutputPath`); this streams
 * the first 40 lines back and composes head + exact omitted count + tail, so
 * the command echo survives alongside the final error. The model greps the
 * log instead of re-running the command.
 *
 * Usage:
 *   pi -e ./bash-middle-out.ts
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const HEAD_LINES = 40;

const TAIL_FOOTER = /^\[(Showing .*|.*omitted.*)\]\s*$/;

export function stripTailFooter(tailText: string): string {
	const lines = tailText.split("\n");
	if (lines.length > 1 && TAIL_FOOTER.test(lines[lines.length - 1].trim())) {
		lines.pop();
	}
	return lines.join("\n").replace(/\n+$/, "");
}

export function middleOutView(tailText: string, headText: string, totalLines: number): string {
	const tail = stripTailFooter(tailText);
	// Raw lines preserved: filtering blanks would shift displayed content
	// against real line numbers.
	const headLines = headText.split("\n");
	const tailCount = tail.split("\n").length;
	const omitted = Math.max(0, totalLines - headLines.length - tailCount);
	const head = headLines.slice(0, HEAD_LINES).join("\n");
	return `[output head — first ${Math.min(headLines.length, HEAD_LINES)} lines]\n${head}\n[... ${omitted} lines omitted ...]\n${tail}`;
}

export async function readHeadLines(path: string, maxLines: number): Promise<string> {
	const lines: string[] = [];
	const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
	try {
		for await (const line of rl) {
			if (lines.length >= maxLines) break;
			lines.push(line);
		}
	} finally {
		rl.close();
	}
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return undefined;
		// Pinned to core's bash result details (formatOutput): renames fail
		// silent to tail-only by the guards below.
		const details = event.details as
			| { truncation?: { truncated?: boolean; totalLines?: number }; fullOutputPath?: string }
			| undefined;
		if (!details?.truncation?.truncated || !details.fullOutputPath || !details.truncation.totalLines) {
			return undefined;
		}
		const text = event.content
			.filter((b): b is { type: "text"; text: string } => b.type === "text")
			.map((b) => b.text)
			.join("\n");
		try {
			const head = await readHeadLines(details.fullOutputPath, HEAD_LINES);
			if (!head) return undefined;
			return {
				content: [{ type: "text" as const, text: middleOutView(text, head, details.truncation.totalLines) }],
			};
		} catch {
			return undefined;
		}
	});
}
