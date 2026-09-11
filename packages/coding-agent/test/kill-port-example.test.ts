/**
 * Unit test for the kill-port example.
 */

import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { assertKillable, findPidByPort, killByPort, parseLsof, parseSs } from "../examples/extensions/kill-port.ts";

function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = createServer();
		s.listen(0, () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resolve(port));
		});
	});
}

function portOpen(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = createConnection({ port, host: "127.0.0.1" });
		sock.on("connect", () => {
			sock.end();
			resolve(true);
		});
		sock.on("error", () => resolve(false));
	});
}

describe("killByPort", () => {
	it("frees a real listener with TERM-first escalation", async () => {
		const port = await freePort();
		const server = spawn("python3", ["-m", "http.server", String(port)], { stdio: "ignore" });
		try {
			let pid: number | undefined;
			for (let i = 0; i < 25 && pid === undefined; i++) {
				await new Promise((r) => setTimeout(r, 200));
				pid = await findPidByPort(port).catch(() => undefined);
			}
			expect(pid).toBeDefined();
			const result = await killByPort(port);
			expect(result.pid).toBe(pid);
			expect(await portOpen(port)).toBe(false);
		} finally {
			try {
				server.kill("SIGKILL");
			} catch {
				// already dead
			}
		}
	}, 30000);

	it("rejects invalid ports and empty ports", async () => {
		await expect(killByPort(0)).rejects.toThrow(/invalid port/);
		await expect(killByPort(54321)).rejects.toThrow(/no listener/);
	});
});

describe("kill-port guards", () => {
	it("parses all lsof pids", () => {
		expect(parseLsof("123\n456\n")).toEqual([123, 456]);
		expect(parseLsof("")).toEqual([]);
	});
	it("parses all ss pids without cross-port matches", () => {
		const ss = "LISTEN 0 10 0.0.0.0:8080 users:(pid=11) \nLISTEN 0 10 0.0.0.0:808  users:(pid=22)";
		expect(parseSs(ss, 8080)).toEqual([11]);
		expect(parseSs(ss, 808)).toEqual([22]);
	});
	it("refuses system ports and tiny pids", () => {
		expect(() => assertKillable(22, 9999)).toThrow(/system port/);
		expect(() => assertKillable(8080, 1)).toThrow(/refusing pid/);
		assertKillable(8080, 9999);
	});
	it("killByPort refuses system ports before lookup", async () => {
		await expect(killByPort(22)).rejects.toThrow(/system port/);
	});
});
