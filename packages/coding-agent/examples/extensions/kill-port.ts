/**
 * Kill Port Example
 *
 * One-call cleanup for "port already in use" dev-server failures: resolves
 * the listener via `lsof` (fallback `ss`) and kills the single pid with
 * SIGTERM, then SIGKILL after a 5s poll. Refuses ambiguity (multiple
 * listeners), system ports, and tiny pids. Never touches process groups.
 *
 * Usage:
 *   pi -e ./kill-port.ts
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";


function sh(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
			if (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if (code === "ENOENT") reject(new Error(`${cmd} not found: install lsof or iproute2 (Unix-only tool)`));
				else reject(err);
			} else resolve(stdout);
		});
	});
}

export function parseLsof(out: string): number[] {
	return out
		.trim()
		.split("\n")
		.map((l) => Number.parseInt(l.trim(), 10))
		.filter((n) => Number.isInteger(n));
}

export function parseSs(out: string, port: number): number[] {
	const pids: number[] = [];
	const re = new RegExp(`:${port}\\s+.*pid=(\\d+)`, "g");
	for (const m of out.matchAll(re)) pids.push(Number.parseInt(m[1], 10));
	return pids;
}

export async function findPidsByPort(port: number): Promise<number[]> {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
	try {
		const pids = parseLsof(await sh("lsof", ["-i", `TCP:${port}`, "-sTCP:LISTEN", "-t"]));
		if (pids.length > 0) return pids;
	} catch (err) {
		if (err instanceof Error && err.message.includes("not found")) {
			try {
				await sh("ss", ["-ltnp"]);
			} catch (ssErr) {
				if (ssErr instanceof Error && ssErr.message.includes("not found")) {
					throw new Error("neither lsof nor ss found: install lsof or iproute2 (Unix-only tool)");
				}
				throw ssErr;
			}
		}
		// lsof ran but found nothing (or ss probe ok) — fall through to ss parse
	}
	try {
		return parseSs(await sh("ss", ["-ltnp"]), port);
	} catch (err) {
		if (err instanceof Error && err.message.includes("not found")) {
			throw new Error("neither lsof nor ss found: install lsof or iproute2 (Unix-only tool)");
		}
		throw err;
	}
}

export async function findPidByPort(port: number): Promise<number | undefined> {
	const pids = await findPidsByPort(port);
	return pids[0];
}

// Safety rails for autonomous use: never ambiguous, never system services, never init.
export function assertKillable(port: number, pid: number): void {
	assertPortAllowed(port);
	if (pid <= 1) throw new Error(`refusing pid ${pid}: will not signal init or the kernel`);
}

export function assertPortAllowed(port: number): void {
	if (port < 1024) throw new Error(`refusing system port ${port}: confirm a user-owned service before killing`);
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
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
	assertPortAllowed(port);
	const pids = await findPidsByPort(port);
	if (pids.length === 0) throw new Error(`no listener on port ${port}`);
	if (pids.length > 1) throw new Error(`refusing: ${pids.length} listeners on port ${port} (${pids.join(", ")}): pick one`);
	const pid = pids[0];
	assertKillable(port, pid);
	return { pid, how: await killPid(pid) };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "kill_port",
		label: "kill_port",
		description:
			"Kill the process listening on a TCP port (SIGTERM, then SIGKILL). Refuses system ports, multiple listeners, and pid<=1.",
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
