/**
 * bash-bg example: run shell commands detached and read them back later.
 *
 * Long commands stall the agent loop when run through bash. This extension
 * registers a `bash_bg` tool that spawns the command detached (stdio to a log
 * file), returns a task id immediately, and lets the agent keep working while
 * the command runs. Pair with `shell-output.ts` to read the log back.
 *
 * Usage:
 *   pi -e ./bash-bg.ts
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { killPid } from "./kill-port.ts";

export interface BgTask {
	id: string;
	pid: number;
	command: string;
	logPath: string;
	startedAt: number;
	status: "running" | "done";
	exitCode: number | null;
}

export function bgDir(): string {
	// PI_BG_DIR isolates registries (tests, and one day sessions).
	const d = process.env.PI_BG_DIR ?? join(tmpdir(), "pi-bg");
	mkdirSync(d, { recursive: true });
	return d;
}

function registryPath(): string {
	return join(bgDir(), "registry.json");
}

function load(): BgTask[] {
	try {
		return JSON.parse(readFileSync(registryPath(), "utf8")) as BgTask[];
	} catch {
		return [];
	}
}

function save(tasks: BgTask[]): void {
	// Atomic write: readers never see torn JSON from parallel writers.
	const target = registryPath();
	const tmp = `${target}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(tasks));
	renameSync(tmp, target);
}

export function startTask(command: string): BgTask {
	const tasks = load();
	// Unique without coordination: counter keeps ids ordered; pid plus
	// timestamp survive registry deletion and same-millisecond starts.
	// (Starts are synchronous in one process, so the counter never races.)
	// Shell injection is by design here (parity with the bash tool itself).
	const n = tasks.length + 1;
	const stamp = Date.now().toString(36);
	const tmpLog = join(bgDir(), `bg-${n}-${stamp}.tmp.log`);
	const fd = openSync(tmpLog, "a");
	const child = spawn(command, { detached: true, shell: true, stdio: ["ignore", fd, fd] });
	child.unref();
	const pid = child.pid ?? -1;
	const id = `bg-${n}-${pid}-${stamp}`;
	const logPath = join(bgDir(), `${id}.log`);
	renameSync(tmpLog, logPath);
	const task: BgTask = {
		id,
		pid,
		command,
		logPath,
		startedAt: Date.now(),
		status: "running",
		exitCode: null,
	};
	child.on("exit", (code) => {
		const all = load();
		const t = all.find((x) => x.id === id);
		if (t) {
			t.status = "done";
			t.exitCode = code;
			save(all);
		}
	});
	tasks.push(task);
	save(tasks);
	return task;
}

export function taskStatus(id: string): BgTask | undefined {
	const t = load().find((x) => x.id === id);
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

export function readTasks(): BgTask[] {
	return load();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "bash_bg",
		label: "bash_bg",
		description:
			"Run a shell command in the background (detached). Returns a task id, pid, and log path immediately. Read output with shell_output; never blocks the agent loop.",
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run detached" }),
		}),
		async execute(_toolCallId, params) {
			const t = startTask(params.command);
			return {
				content: [
					{
						type: "text" as const,
						text: `started ${t.id} (pid ${t.pid}, log ${t.logPath}). Read with shell_output taskId=${t.id}.`,
					},
				],
			};
		},
	});
	pi.registerTool({
		name: "shell_kill",
		label: "shell_kill",
		description:
			"Terminate a bash_bg task by id (SIGTERM-first with a 5s poll before SIGKILL). Never signals finished tasks.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task id from bash_bg" }),
		}),
		async execute(_toolCallId, params) {
			const r = await killTask(params.taskId);
			return {
				content: [
					{
						type: "text" as const,
						text:
							r.result === "killed"
								? `killed ${r.id} (pid ${r.pid}) via SIG${r.how === "term" ? "TERM" : "KILL"}`
								: r.result === "already-exited"
									? `${r.id} already exited; nothing signaled`
									: `unknown task ${r.id}`,
					},
				],
			};
		},
	});
}

export interface KillResult {
	id: string;
	pid: number | null;
	result: "killed" | "already-exited" | "not-found";
	how: "term" | "kill" | null;
}

export async function killTask(id: string): Promise<KillResult> {
	const task = taskStatus(id);
	if (!task) return { id, pid: null, result: "not-found", how: null };
	// Never signal a finished task: the pid may already belong to someone else.
	if (task.status === "done") return { id, pid: task.pid, result: "already-exited", how: null };
	try {
		const how = await killPid(task.pid);
		return { id, pid: task.pid, result: "killed", how };
	} catch (err) {
		// ESRCH race: the pid died between lookup and signal.
		if ((err as NodeJS.ErrnoException).code === "ESRCH") {
			return { id, pid: task.pid, result: "already-exited", how: null };
		}
		throw err;
	}
}
