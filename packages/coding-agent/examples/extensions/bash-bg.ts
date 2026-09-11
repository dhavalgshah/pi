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

export interface BgTask {
	id: string;
	pid: number;
	command: string;
	logPath: string;
	startedAt: number;
	status: "running" | "done";
	exitCode: number | null;
}

function dir(): string {
	const d = join(tmpdir(), "pi-bg");
	mkdirSync(d, { recursive: true });
	return d;
}

function registryPath(): string {
	return join(dir(), "registry.json");
}

function load(): BgTask[] {
	try {
		return JSON.parse(readFileSync(registryPath(), "utf8")) as BgTask[];
	} catch {
		return [];
	}
}

function save(tasks: BgTask[]): void {
	writeFileSync(registryPath(), JSON.stringify(tasks));
}

export function startTask(command: string): BgTask {
	const tasks = load();
	// Unique without coordination: counter keeps ids ordered; pid plus
	// timestamp survive registry deletion and same-millisecond starts.
	// (Starts are synchronous in one process, so the counter never races.)
	// Shell injection is by design here (parity with the bash tool itself).
	const n = tasks.length + 1;
	const stamp = Date.now().toString(36);
	const tmpLog = join(dir(), `bg-${n}-${stamp}.tmp.log`);
	const fd = openSync(tmpLog, "a");
	const child = spawn(command, { detached: true, shell: true, stdio: ["ignore", fd, fd] });
	child.unref();
	const pid = child.pid ?? -1;
	const id = `bg-${n}-${pid}-${stamp}`;
	const logPath = join(dir(), `${id}.log`);
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
}
