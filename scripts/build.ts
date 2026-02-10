/**
 * Build script for config-engine.
 * Uses Bun's bundler for fast builds with declaration generation via tsc.
 */

import { rmSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const outDir = resolve(rootDir, "dist");

// Clean output
rmSync(outDir, { recursive: true, force: true });

console.log("Building config-engine...");

// Transpile TypeScript → JavaScript using Bun
const result = await Bun.build({
	entrypoints: [
		resolve(rootDir, "src/index.ts"),
		resolve(rootDir, "src/validation.ts"),
	],
	outdir: outDir,
	target: "node",
	format: "esm",
	splitting: true,
	sourcemap: "external",
	external: [
		"bun:sqlite",
		"better-sqlite3",
		"@wgtechlabs/secrets-engine",
		"zod",
	],
});

if (!result.success) {
	console.error("Build failed:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log(`  ${result.outputs.length} files generated`);

// Generate declaration files via tsc
console.log("Generating type declarations...");
const tsc = Bun.spawnSync(["bunx", "tsc", "--emitDeclarationOnly"], {
	cwd: rootDir,
	stdio: ["inherit", "inherit", "inherit"],
});

if (tsc.exitCode !== 0) {
	console.error("Type declaration generation failed");
	process.exit(1);
}

console.log("Build complete!");
