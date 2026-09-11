/**
 * Unit test for the bash-bg example.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.PI_BG_DIR = mkdtempSync(join(tmpdir(), "pi-bg-test-"));
import defaultExtension, { killTask, startTask, taskStatus } from "../examples/extensions/bash-bg.ts";

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

describe("shell_kill", () => {
	it("kills a running task SIGTERM-first", async () => {
		const t = startTask("sleep 60");
		const r = await killTask(t.id);
		expect(r.result).toBe("killed");
		expect(r.how).toBe("term");
		expect(taskStatus(t.id)?.status).toBe("done");
	});
	it("reports unknown ids and finished tasks cleanly", async () => {
		expect((await killTask("bg-0-0-0")).result).toBe("not-found");
		const t = startTask("echo hi");
		await waitForDone(t.id);
		expect((await killTask(t.id)).result).toBe("already-exited");
	});
	it("registers working tools (load smoke test)", async () => {
		const tools: Record<string, { execute: (id: string, params: never) => Promise<unknown> }> = {};
		defaultExtension({ registerTool: (t: { name: string }) => { tools[t.name] = t as never; } } as never);
		expect(Object.keys(tools).sort()).toEqual(["bash_bg", "shell_kill"]);
		const t = startTask("sleep 60");
	 const out = (await tools.shell_kill.execute("x", { taskId: t.id } as never)) as {
			content: [{ text: string }];
		};
		expect(out.content[0].text).toMatch(/killed .* via SIGTERM/);
	});
});
