/**
 * Unit test for the bash-benign-exit example.
 */

import { describe, expect, it, vi } from "vitest";
import defaultExtension, { benignExitPatch, commandName } from "../examples/extensions/bash-benign-exit.ts";

const EXIT_1_TEXT = "(no output)\n\nCommand exited with code 1";

describe("benignExitPatch", () => {
	it("annotates grep exit 1 and clears the error flag", () => {
		const patch = benignExitPatch({ toolName: "bash", command: "grep -rn foo .", isError: true, text: EXIT_1_TEXT });
		expect(patch).toBeDefined();
		expect(patch?.isError).toBe(false);
		expect(patch?.content).toContain("not an error");
	});

	it("ignores non-benign commands", () => {
		expect(
			benignExitPatch({ toolName: "bash", command: "./deploy.sh", isError: true, text: EXIT_1_TEXT }),
		).toBeUndefined();
	});

	it("ignores non-errors and other exit codes", () => {
		expect(
			benignExitPatch({ toolName: "bash", command: "grep -rn foo .", isError: false, text: "a:1: foo" }),
		).toBeUndefined();
		expect(
			benignExitPatch({
				toolName: "bash",
				command: "grep foo .",
				isError: true,
				text: "x\n\nCommand exited with code 2",
			}),
		).toBeUndefined();
	});

	it("ignores non-bash tools", () => {
		expect(
			benignExitPatch({ toolName: "grep", command: "grep foo .", isError: true, text: EXIT_1_TEXT }),
		).toBeUndefined();
	});
});

describe("bash-benign-exit extension", () => {
	it("patches only matching bash results", async () => {
		const handlers = new Map<string, (event: any) => Promise<unknown>>();
		const pi = {
			on: vi.fn((name: string, handler: (event: any) => Promise<unknown>) => handlers.set(name, handler)),
		};
		defaultExtension(pi as never);
		const handler = handlers.get("tool_result");
		if (!handler) throw new Error("tool_result handler not registered");

		const match = {
			toolName: "bash",
			input: { command: "grep -rn foo ." },
			content: [{ type: "text", text: EXIT_1_TEXT }],
			isError: true,
		};
		const patched = (await handler(match)) as { isError: boolean };
		expect(patched.isError).toBe(false);

		const miss = {
			toolName: "bash",
			input: { command: "./deploy.sh" },
			content: [{ type: "text", text: EXIT_1_TEXT }],
			isError: true,
		};
		expect(await handler(miss)).toBeUndefined();
	});
});

describe("bash-benign-exit v2", () => {
	it("strips wrappers before matching", () => {
		expect(commandName("sudo grep x")).toBe("grep");
		expect(commandName("FOO=1 grep x")).toBe("grep");
		expect(commandName("git grep x")).toBe("grep");
		expect(commandName("ls /tmp")).toBe("ls");
	});
});

describe("bash-benign-exit diff note", () => {
	it("labels diff exit 1 as differences found", () => {
		const r = benignExitPatch({
			toolName: "bash",
			command: "diff a b",
			isError: true,
			text: "(no output)\n\nCommand exited with code 1",
		});
		expect(r?.content).toMatch(/differences found/);
		expect(r?.content).not.toMatch(/no matches/);
	});
});
