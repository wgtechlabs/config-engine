/**
 * Tests for the runtime SQLite adapter.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

describe("runtime bundling", () => {
	test("node-targeted bundle externalises better-sqlite3 and has no bun-specific imports", async () => {
		const workDir = mkdtempSync(join(tmpdir(), "config-engine-runtime-"));
		const entryPath = join(workDir, "entry.ts");
		const outDir = join(workDir, "dist");
		// Resolve through a file:// URL, then back to a filesystem path: the bundler
		// resolves plain paths, and JSON.stringify escapes Windows separators safely.
		const runtimePath = fileURLToPath(new URL("../src/runtime.ts", import.meta.url));

		try {
			mkdirSync(outDir, { recursive: true });
			// The bundle is emitted as ESM, so mark the output directory as a module
			// package, otherwise Node parses the .js output as CommonJS and fails.
			writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
			writeFileSync(
				entryPath,
				`import { openDatabase } from ${JSON.stringify(runtimePath)};\nconsole.log(typeof openDatabase);\n`,
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
			// No bun-specific imports should appear in a node-targeted bundle
			expect(bundled).not.toMatch(/(?:from|import|require\s*\()\s*["']bun:sqlite["']/);
			// better-sqlite3 must remain external (not inlined)
			expect(bundled).toMatch(/better-sqlite3/);

			const run = Bun.spawnSync(["node", outputPath], {
				stdout: "pipe",
				stderr: "pipe",
			});

			expect(run.exitCode).toBe(0);
			expect(new TextDecoder().decode(run.stdout).trim()).toBe("function");
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});
});
