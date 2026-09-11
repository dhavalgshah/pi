/**
 * shell-output example: cursor reads over background task logs.
 *
 * bash-bg tasks append to per-task log files. This extension registers a
 * `shell_output` tool that reads only new bytes: it keeps a per-task cursor,
 * so omitting from_offset continues where the last read stopped. Three wait
 * modes: return-now (default), wait-write (until new bytes or exit), and
 * wait-exit (until the task exits), each capped by a timeout.
 */

import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bgDir } from "./bash-bg.ts";

interface BgTask {
	id: string;
	pid: number;
	logPath: string;
	status: "running" | "done";
	exitCode: number | null;
}

function taskStatus(id: string): BgTask | undefined {
	let all: BgTask[];
	try {
		all = JSON.parse(readFileSync(join(bgDir(), "registry.json"), "utf8")) as BgTask[];
	} catch {
		return undefined;
	}
	const t = all.find((x) => x.id === id);
	if (!t) return undefined;
	if (t.status === "running" && existsSync(t.logPath)) {
		try {
			process.kill(t.pid, 0);
		} catch {
			t.status = "done";
		}
	}
	return t;
}

export type WaitMode = "return-now" | "wait-write" | "wait-exit";

export interface TaskRead {
	id: string;
	status: "running" | "done" | "unknown";
	exitCode: number | null;
	from_offset: number;
	next_offset: number;
	output: string;
	timedOut: boolean;
}

// Single-session assumption: cursors live in memory, so an extension reload
// restarts them (benign re-delivery) and two sessions sharing the registry
// last-write-win each other. Stated, not solved.
const cursors = new Map<string, number>();
const MAX_CHARS = 8000;

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function readTaskOutput(
	id: string,
	opts: { from_offset?: number; mode?: WaitMode; timeoutSec?: number } = {},
): Promise<TaskRead> {
	const mode = opts.mode ?? "return-now";
	const timeoutMs = Math.min(Math.max(opts.timeoutSec ?? 30, 1), 120) * 1000;
	const task = taskStatus(id);
	if (!task) {
		return { id, status: "unknown", exitCode: null, from_offset: 0, next_offset: 0, output: "", timedOut: false };
	}
	let from = opts.from_offset ?? cursors.get(id) ?? 0;
	const deadline = Date.now() + timeoutMs;
	let timedOut = false;
	if (mode !== "return-now") {
		for (;;) {
			const t = taskStatus(id);
			const size = existsSync(task.logPath) ? statSync(task.logPath).size : 0;
			const exited = t?.status === "done";
			if (mode === "wait-write" && (size > from || exited)) break;
			if (mode === "wait-exit" && exited) break;
			if (Date.now() >= deadline) {
				timedOut = true;
				break;
			}
			await sleepMs(250);
		}
	}
	const final = taskStatus(id);
	// Symlink guard: a swapped log path reads arbitrary files.
	if (lstatSync(task.logPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
		return { id, status: "unknown", exitCode: null, from_offset: from, next_offset: from, output: "refusing: log path is a symlink", timedOut };
	}
	const size = existsSync(task.logPath) ? statSync(task.logPath).size : 0;
	from = Math.min(from, size);
	const buf = existsSync(task.logPath) ? readFileSync(task.logPath) : Buffer.alloc(0);
	// Snap mid-line offsets forward to the next newline; the partial line is
	// discarded, never split. Line-start offsets pass through untouched.
	if (from > 0 && from < size && buf[from - 1] !== 0x0a) {
		const nl = buf.indexOf(0x0a, from);
		from = nl === -1 ? size : nl + 1;
	}
	const slice = buf.subarray(from, size);
	let output = slice.toString("utf8");
	if (output.length > MAX_CHARS) {
		output = output.slice(0, MAX_CHARS) + `\n[${slice.length - MAX_CHARS} chars truncated; re-read with from_offset=${from + MAX_CHARS}]`;
	}
	const next = size;
	cursors.set(id, next);
	return {
		id,
		status: final?.status ?? "unknown",
		exitCode: final?.exitCode ?? null,
		from_offset: from,
		next_offset: next,
		output,
		timedOut,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "shell_output",
		label: "shell_output",
		description:
			"Read new output from a bash_bg task. Remembers a per-task cursor: omit from_offset to continue where the last read stopped. Modes: return-now (default), wait-write, wait-exit.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task id from bash_bg (bg-N)" }),
			from_offset: Type.Optional(Type.Number({ description: "Byte offset to read from; defaults to the saved cursor" })),
			mode: Type.Optional(
				Type.Union([Type.Literal("return-now"), Type.Literal("wait-write"), Type.Literal("wait-exit")], {
					description: "Wait behavior",
				}),
			),
			timeout: Type.Optional(Type.Number({ description: "Wait cap in seconds, default 30, max 120" })),
		}),
		async execute(_toolCallId, params) {
			const r = await readTaskOutput(params.taskId, {
				from_offset: params.from_offset,
				mode: params.mode,
				timeoutSec: params.timeout,
			});
			return {
				content: [
					{
						type: "text" as const,
						text: `task ${r.id} status=${r.status} exit=${r.exitCode ?? "-"} bytes[${r.from_offset}-${r.next_offset}]${r.timedOut ? " timedOut" : ""}\n${r.output}`,
					},
				],
			};
		},
	});
}
