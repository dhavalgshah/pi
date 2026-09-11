/**
 * Unit test for the shell-output example.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.PI_BG_DIR = mkdtempSync(join(tmpdir(), "pi-bg-test-"));
import { startTask, taskStatus } from "../examples/extensions/bash-bg.ts";
import { readTaskOutput } from "../examples/extensions/shell-output.ts";

function waitForDone(id: string, tries = 40): Promise<void> {
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

describe("shell-output example", () => {
	it("reads from offset 0 and advances the cursor", async () => {
		const t = startTask("printf 'aaa\\nbbb\\nccc\\n'");
		await waitForDone(t.id);
		const r = await readTaskOutput(t.id);
		expect(r.status).toBe("done");
		expect(r.output).toBe("aaa\nbbb\nccc\n");
		expect(r.from_offset).toBe(0);
		expect(r.next_offset).toBeGreaterThan(0);
		const r2 = await readTaskOutput(t.id);
		expect(r2.output).toBe("");
		expect(r2.from_offset).toBe(r.next_offset);
	});

	it("snaps mid-line offsets forward to the next newline", async () => {
		const t = startTask("printf 'aaa\\nbbb\\nccc\\n'");
		await waitForDone(t.id);
		const r = await readTaskOutput(t.id, { from_offset: 5 });
		expect(r.output).toBe("ccc\n");
		expect(r.from_offset).toBe(8);
	});
	it("refuses a log path swapped for a symlink", async () => {
		const { renameSync, symlinkSync, unlinkSync } = await import("node:fs");
		const t = startTask("echo hi");
		await waitForDone(t.id);
		const log = taskStatus(t.id)?.logPath as string;
		renameSync(log, log + ".real");
		symlinkSync("/etc/hostname", log);
		try {
			const r = await readTaskOutput(t.id);
			expect(r.output).toMatch(/refusing.*symlink/);
		} finally {
			unlinkSync(log);
			renameSync(log + ".real", log);
		}
	});
	it("wait-exit blocks until a slow command finishes", async () => {
		const t = startTask("sleep 2 && echo finished");
		const start = Date.now();
		const r = await readTaskOutput(t.id, { mode: "wait-exit", timeoutSec: 10 });
		expect(Date.now() - start).toBeGreaterThanOrEqual(1500);
		expect(r.status).toBe("done");
		expect(r.output).toMatch(/finished/);
	});

	it("return-now on a running task reports running without blocking", async () => {
		const t = startTask("sleep 20");
		const start = Date.now();
		const r = await readTaskOutput(t.id, { mode: "return-now" });
		expect(Date.now() - start).toBeLessThan(5000);
		expect(r.status).toBe("running");
		process.kill(t.pid, "SIGKILL");
	});
});
