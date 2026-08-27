/**
 * Build script for config-engine.
 * Uses esbuild for fast bundling with declaration generation via tsc.
 * Runs under Node.js — no Bun runtime required.
 */

import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(rootDir, "dist");

// Clean output
rmSync(outDir, { recursive: true, force: true });

console.log("Building config-engine...");

// Transpile TypeScript → JavaScript using esbuild
const result = await esbuild.build({
	entryPoints: [
		resolve(rootDir, "src/index.ts"),
		resolve(rootDir, "src/validation.ts"),
	],
	outdir: outDir,
	platform: "node",
	format: "esm",
	splitting: true,
	sourcemap: true,
	external: ["better-sqlite3", "@wgtechlabs/secrets-engine", "zod"],
	bundle: true,
	metafile: true,
});

const outputFiles = Object.keys(result.metafile.outputs);
console.log(`  ${outputFiles.length} files generated`);

console.log("Generating type declarations...");

// Generate declaration files via tsc (using local typescript install)
execSync("node node_modules/typescript/bin/tsc --emitDeclarationOnly", {
	cwd: rootDir,
	stdio: "inherit",
});

console.log("Build complete!");
