/**
 * Tests for the runtime SQLite adapter.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("runtime bundling", () => {
	test("node-targeted bundle externalises better-sqlite3 and has no bun-specific imports", () => {
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

			// Use bun as the build toolchain (subprocess) so we don't depend on Bun runtime APIs
			execFileSync(
				"bun",
				[
					"build",
					entryPath,
					"--outdir",
					outDir,
					"--target",
					"node",
					"--format",
					"esm",
					"--external",
					"better-sqlite3",
				],
				{
					stdio: "pipe",
				},
			);

			const outputPath = join(outDir, "entry.js");
			const bundled = readFileSync(outputPath, "utf8");
			// No bun-specific imports should appear in a node-targeted bundle
			expect(bundled).not.toMatch(/(?:from|import|require\s*\()\s*["']bun:sqlite["']/);
			// better-sqlite3 must remain external (not inlined): the bundle has to keep a
			// real import/require of the specifier, not just an incidental string mention.
			expect(bundled).toMatch(
				/(?:from|import)\s*["']better-sqlite3["']|[\w$]*[Rr]equire\s*\(\s*["']better-sqlite3["']\s*\)/,
			);

			// Verify the bundle runs cleanly under node (no bun runtime needed)
			const output = execFileSync("node", [outputPath], { encoding: "utf8" });
			expect(output.trim()).toBe("function");
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});
});
