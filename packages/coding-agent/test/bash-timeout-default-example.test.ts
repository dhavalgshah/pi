/**
 * Unit test for the bash-timeout-default example.
 */

import { describe, expect, it, vi } from "vitest";
import defaultExtension, {
	BASH_DEFAULT_TIMEOUT,
	resolveBashTimeout,
} from "../examples/extensions/bash-timeout-default.ts";

describe("resolveBashTimeout", () => {
	it("defaults to 30s when unset", () => {
		expect(resolveBashTimeout(undefined)).toBe(30);
	});

	it("keeps model-set values under the cap", () => {
		expect(resolveBashTimeout(10)).toBe(10);
	});

	it("caps at 600s", () => {
		expect(resolveBashTimeout(900)).toBe(600);
		expect(resolveBashTimeout(600)).toBe(600);
	});

	it("coerces invalid values to the default instead of throwing", () => {
		expect(resolveBashTimeout(0)).toBe(BASH_DEFAULT_TIMEOUT);
		expect(resolveBashTimeout(-5)).toBe(BASH_DEFAULT_TIMEOUT);
		expect(resolveBashTimeout(NaN)).toBe(BASH_DEFAULT_TIMEOUT);
		expect(resolveBashTimeout(Infinity)).toBe(BASH_DEFAULT_TIMEOUT);
	});
});

describe("bash-timeout-default extension", () => {
	it("patches bash timeout in place and ignores other tools", async () => {
		const handlers = new Map<string, (event: any) => Promise<unknown>>();
		const pi = {
			on: vi.fn((name: string, handler: (event: any) => Promise<unknown>) => handlers.set(name, handler)),
		};
		defaultExtension(pi as never);
		const handler = handlers.get("tool_call");
		if (!handler) throw new Error("tool_call handler not registered");

		const bashEvent = { toolName: "bash", input: { command: "sleep 60" } };
		await handler(bashEvent);
		expect(bashEvent.input).toEqual({ command: "sleep 60", timeout: 30 });

		const otherEvent = { toolName: "read", input: { path: "a.ts" } };
		await handler(otherEvent);
		expect(otherEvent.input).toEqual({ path: "a.ts" });
	});
});
