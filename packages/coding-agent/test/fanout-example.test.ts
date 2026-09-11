/**
 * Unit test for the fanout example.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.PI_BG_DIR = mkdtempSync(join(tmpdir(), "pi-bg-test-"));

import { taskStatus } from "../examples/extensions/bash-bg.ts";
import { fanout } from "../examples/extensions/fanout.ts";
import { readTaskOutput } from "../examples/extensions/shell-output.ts";

function waitDone(id: string, tries = 100): Promise<void> {
	return new Promise((resolve, reject) => {
		let n = 0;
		const tick = () => {
			if (taskStatus(id)?.status === "done") return resolve();
			if (++n >= tries) return reject(new Error(`task ${id} still running`));
			setTimeout(tick, 100);
		};
		tick();
	});
}

describe("fanout example", () => {
	it("runs two commands isolated with envelopes", async () => {
		const runs = await fanout([
			{ label: "a", command: "echo hello-a" },
			{ label: "b", command: "echo hello-b" },
		]);
		expect(runs.length).toBe(2);
		for (const r of runs) {
			await waitDone(r.taskId);
			const out = await readTaskOutput(r.taskId);
			expect(out.output).toMatch(/"exit":0/);
		}
		expect(readFileSync(runs[0].outputPath, "utf8")).toMatch(/hello-a/);
		expect(readFileSync(runs[1].outputPath, "utf8")).toMatch(/hello-b/);
		expect(runs[0].workdir).not.toBe(runs[1].workdir);
	});
	it("records failure without affecting siblings", async () => {
		const runs = await fanout([
			{ label: "ok", command: "echo fine" },
			{ label: "bad", command: "exit 3" },
		]);
		for (const r of runs) await waitDone(r.taskId);
		const outs = await Promise.all(runs.map((r) => readTaskOutput(r.taskId)));
		expect(outs[0].output).toMatch(/"exit":0/);
		expect(outs[1].output).toMatch(/"exit":3/);
	});
	it("refuses nesting and more than four runs", async () => {
		process.env.PI_FANOUT_DEPTH = "1";
		try {
			await expect(fanout([{ label: "x", command: "echo x" }])).rejects.toThrow(/depth/);
		} finally {
			delete process.env.PI_FANOUT_DEPTH;
		}
		await expect(fanout([1, 2, 3, 4, 5].map((i) => ({ label: `r${i}`, command: "echo x" })))).rejects.toThrow(/fan-out/);
	});
	it("registers a working tool (load smoke test)", async () => {
		const { default: fanoutExt } = await import("../examples/extensions/fanout.ts");
		const tools: Record<string, { execute: (id: string, params: never) => Promise<unknown> }> = {};
		fanoutExt({ registerTool: (t: { name: string }) => { tools[t.name] = t as never; } } as never);
		expect(Object.keys(tools)).toEqual(["fanout"]);
	});
});
