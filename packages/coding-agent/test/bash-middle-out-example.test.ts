/**
 * Unit test for the bash-middle-out example.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import defaultExtension, {
	middleOutView,
	readHeadLines,
	stripTailFooter,
} from "../examples/extensions/bash-middle-out.ts";

describe("middleOutView", () => {
	it("prepends head with exact omitted count", () => {
		const head = Array.from({ length: 40 }, (_, i) => `h${i + 1}`).join("\n");
		const tail = Array.from({ length: 100 }, (_, i) => `t${i + 1}`).join("\n");
		const out = middleOutView(tail, head, 5000);
		expect(out).toContain("h1");
		expect(out).toContain("h40");
		expect(out).toContain("[... 4860 lines omitted ...]");
		expect(out).toContain("t100");
	});

	it("strips the core tail footer before composing", () => {
		const out = middleOutView("a\nb\n[Showing lines 4901-5000 of 5000. Full output: /tmp/x]", "h1", 5000);
		expect(out.match(/Showing lines/g) ?? []).toHaveLength(0);
		expect(out).toContain("4997 lines omitted");
	});

	it("stripTailFooter leaves non-footer tails alone", () => {
		expect(stripTailFooter("a\nb")).toBe("a\nb");
	});
});

describe("readHeadLines", () => {
	it("returns the first N lines of a large file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-head-"));
		writeFileSync(`${dir}/big.log`, Array.from({ length: 5000 }, (_, i) => `line${i + 1}`).join("\n"));
		const lines = (await readHeadLines(join(dir, "big.log"), 40)).split("\n");
		expect(lines).toHaveLength(40);
		expect(lines[0]).toBe("line1");
		expect(lines[39]).toBe("line40");
	});
});

describe("bash-middle-out extension", () => {
	it("passes through non-truncated results", async () => {
		const handlers = new Map<string, (event: any) => Promise<unknown>>();
		const pi = {
			on: vi.fn((name: string, handler: (event: any) => Promise<unknown>) => handlers.set(name, handler)),
		};
		defaultExtension(pi as never);
		const handler = handlers.get("tool_result");
		if (!handler) throw new Error("tool_result handler not registered");
		expect(await handler({ toolName: "bash", input: {}, content: [], details: undefined })).toBeUndefined();
	});
});
