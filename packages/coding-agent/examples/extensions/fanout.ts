/**
 * Fanout Example
 *
 * Launch isolated runs in parallel (separate working directories, depth
 * limit 1, max 4 per call). Each run writes a tool-owned result envelope;
 * read output back with shell-output. Pair with bash-bg/shell-output.
 *
 * Usage:
 *   pi -e ./fanout.ts -e ./bash-bg.ts -e ./shell-output.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { startTask } from "./bash-bg.ts";

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


export interface FanoutSpec {
	label: string;
	command: string;
}

export interface FanoutRun {
	label: string;
	taskId: string;
	workdir: string;
	outputPath: string;
	resultPath: string;
}

export const MAX_FANOUT = 4;

// Depth guard: runs cannot fan out (fork bomb with your subscription).
// The envelope format is owned here; the shell wrapper only fills it in,
// and the trailing printf runs whether the command succeeds or fails.
export async function fanout(specs: FanoutSpec[]): Promise<FanoutRun[]> {
	if (process.env.PI_FANOUT_DEPTH) {
		throw new Error("refusing nested fan-out (depth limit 1): runs cannot fan out");
	}
	if (specs.length > MAX_FANOUT) {
		throw new Error(`refusing fan-out of ${specs.length}: max ${MAX_FANOUT} per call`);
	}
	const base = mkdtempSync(join(tmpdir(), "pi-fanout-"));
	return specs.map((spec) => {
		const workdir = join(base, spec.label.replace(/[^A-Za-z0-9_-]+/g, "_"));
		mkdirSync(workdir, { recursive: true });
		const outputPath = join(workdir, "output.log");
		const resultPath = join(workdir, "result.json");
		const wrapped = `cd ${JSON.stringify(workdir)} && PI_FANOUT_DEPTH=1 sh -c ${JSON.stringify(spec.command)} >${JSON.stringify(outputPath)} 2>&1; code=$?; printf '{"exit":%d}' "$code" >${JSON.stringify(resultPath)}; printf '{"exit":%d}\\n' "$code"`;
		const task = startTask(wrapped);
		return { label: spec.label, taskId: task.id, workdir, outputPath, resultPath };
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "fanout",
		label: "fanout",
		description:
			"Launch up to 4 isolated runs in parallel (separate working directories, depth limit 1). Returns task ids plus result paths; read back with shell_output.",
		parameters: Type.Object({
			runs: Type.Array(Type.Object({ label: Type.String(), command: Type.String() }), {
				description: "Runs to launch (max 4)",
			}),
		}),
		async execute(_toolCallId, params) {
			const runs = await fanout(params.runs);
			return {
				content: [
					{
						type: "text" as const,
						text: runs.map((r) => `run ${r.label}: task ${r.taskId}, result ${r.resultPath}`).join("\n"),
					},
				],
			};
		},
	});
}
