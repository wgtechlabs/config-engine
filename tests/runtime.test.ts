/**
 * Tests for the runtime SQLite adapter selection.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

describe("runtime bundling", () => {
	test("does not emit a static bun:sqlite import in Node bundles", async () => {
		const workDir = mkdtempSync(join(tmpdir(), "config-engine-runtime-"));
		const entryPath = join(workDir, "entry.ts");
		const outDir = join(workDir, "dist");
		const runtimePath = fileURLToPath(new URL("../src/runtime.ts", import.meta.url));

		try {
			mkdirSync(outDir, { recursive: true });
			writeFileSync(
				entryPath,
				`import { isBun } from ${JSON.stringify(runtimePath)};\nconsole.log(isBun());\n`,
			);

			const result = await Bun.build({
				entrypoints: [entryPath],
				outdir: outDir,
				target: "node",
				format: "esm",
				splitting: false,
				external: ["better-sqlite3"],
			});

			expect(result.success).toBe(true);

			const outputPath = join(outDir, "entry.js");
			const bundled = readFileSync(outputPath, "utf8");
			expect(bundled).not.toMatch(/(?:from|import)\s+["']bun:sqlite["']/);

			const run = Bun.spawnSync(["node", outputPath], {
				stdout: "pipe",
				stderr: "pipe",
			});

			expect(run.exitCode).toBe(0);
			expect(new TextDecoder().decode(run.stdout).trim()).toBe("false");
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});
});
