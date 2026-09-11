/**
 * Unit test for the bash-bg example.
 */

import { describe, expect, it } from "vitest";
import { startTask, taskStatus } from "../examples/extensions/bash-bg.ts";

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

describe("bash-bg example", () => {
	it("runs a quick command detached and records exit 0", async () => {
		const t = startTask("echo hello-bg");
		expect(t.id).toMatch(/^bg-\d+-\d+-[a-z0-9]+$/);
		expect(t.pid).toBeGreaterThan(0);
		await waitForDone(t.id);
		expect(taskStatus(t.id)?.status).toBe("done");
		expect(taskStatus(t.id)?.exitCode).toBe(0);
	});

	it("reports a slow command as running", () => {
		const t = startTask("sleep 30");
		expect(taskStatus(t.id)?.status).toBe("running");
		process.kill(t.pid, "SIGKILL");
	});
});

describe("bash-bg ids", () => {
	it("mints unique ids across parallel starts", async () => {
		const { startTask } = await import("../examples/extensions/bash-bg.ts");
		const a = startTask("echo a");
		const b = startTask("echo b");
		expect(a.id).not.toBe(b.id);
		expect(a.logPath).not.toBe(b.logPath);
	});
});
