/**
 * Kill Port Example
 *
 * One-call cleanup for "port already in use" dev-server failures: resolves
 * the listener via `lsof` (fallback `ss`) and kills the single pid with
 * SIGTERM, then SIGKILL after a 5s poll. Never touches process groups.
 *
 * Usage:
 *   pi -e ./kill-port.ts
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function run(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
			if (err) reject(err);
			else resolve(stdout);
		});
	});
}

export async function findPidByPort(port: number): Promise<number | undefined> {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
	try {
		const out = await run("lsof", ["-i", `TCP:${port}`, "-sTCP:LISTEN", "-t"]);
		const pid = Number.parseInt(out.trim().split("\n")[0], 10);
		if (Number.isInteger(pid)) return pid;
	} catch {
		// fall through to ss
	}
	const out = await run("ss", ["-ltnp"]);
	const m = out.match(new RegExp(`:${port}\\s+.*pid=(\\d+)`));
	if (m) return Number.parseInt(m[1], 10);
	return undefined;
}

export async function killPid(pid: number): Promise<"term" | "kill"> {
	process.kill(pid, "SIGTERM");
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200));
		try {
			process.kill(pid, 0);
		} catch {
			return "term";
		}
	}
	process.kill(pid, "SIGKILL");
	return "kill";
}

export async function killByPort(port: number): Promise<{ pid: number; how: "term" | "kill" }> {
	const pid = await findPidByPort(port);
	if (pid === undefined) throw new Error(`no listener on port ${port}`);
	return { pid, how: await killPid(pid) };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "kill_port",
		label: "kill_port",
		description: "Kill the process listening on a TCP port (SIGTERM, then SIGKILL). Single pid only.",
		parameters: Type.Object({
			port: Type.Number({ description: "TCP port whose listener to kill" }),
		}),
		async execute(_toolCallId, params) {
			const { pid, how } = await killByPort(params.port);
			return {
				content: [
					{
						type: "text" as const,
						text: `killed pid ${pid} on port ${params.port} via SIG${how === "term" ? "TERM" : "KILL"}`,
					},
				],
			};
		},
	});
}
