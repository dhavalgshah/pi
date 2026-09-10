/**
 * bash-bg example: run shell commands detached and read them back later.
 *
 * Long commands stall the agent loop when run through bash. This extension
 * registers a `bash_bg` tool that spawns the command detached (stdio to a log
 * file), returns a task id immediately, and lets the agent keep working while
 * the command runs. Pair with `shell-output.ts` to read the log back.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
	const d = join(tmpdir(), "pi-bg");
	mkdirSync(d, { recursive: true });
	return d;
}

function loadTasks(): BgTask[] {
	try {
		return JSON.parse(readFileSync(join(bgDir(), "registry.json"), "utf8")) as BgTask[];
	} catch {
		return [];
	}
}

function saveTasks(tasks: BgTask[]): void {
	writeFileSync(join(bgDir(), "registry.json"), JSON.stringify(tasks));
}

export function startTask(command: string): BgTask {
	const tasks = loadTasks();
	const id = `bg-${tasks.length + 1}`;
	const logPath = join(bgDir(), `${id}.log`);
	const fd = openSync(logPath, "a");
	const child = spawn(command, { detached: true, shell: true, stdio: ["ignore", fd, fd] });
	child.unref();
	const task: BgTask = {
		id,
		pid: child.pid ?? -1,
		command,
		logPath,
		startedAt: Date.now(),
		status: "running",
		exitCode: null,
	};
	child.on("exit", (code) => {
		const all = loadTasks();
		const t = all.find((x) => x.id === id);
		if (t) {
			t.status = "done";
			t.exitCode = code;
			saveTasks(all);
		}
	});
	tasks.push(task);
	saveTasks(tasks);
	return task;
}

export function taskStatus(id: string): BgTask | undefined {
	const t = loadTasks().find((x) => x.id === id);
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
