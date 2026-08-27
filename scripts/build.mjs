/**
 * Build script for config-engine.
 * Uses Bun's bundler (invoked as subprocess) for fast builds,
 * with declaration generation via tsc. Runs under Node.js.
 */

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(rootDir, "dist");

// Clean output
rmSync(outDir, { recursive: true, force: true });

console.log("Building config-engine...");

// Transpile TypeScript → JavaScript using Bun bundler
execFileSync(
	"bun",
	[
		"build",
		"src/index.ts",
		"src/validation.ts",
		"--outdir",
		"dist",
		"--target",
		"node",
		"--format",
		"esm",
		"--splitting",
		"--sourcemap=external",
		"--external",
		"better-sqlite3",
		"--external",
		"@wgtechlabs/secrets-engine",
		"--external",
		"zod",
	],
	{ cwd: rootDir, stdio: "inherit" },
);

console.log("Generating type declarations...");

// Generate declaration files via tsc
execFileSync("bunx", ["tsc", "--emitDeclarationOnly"], {
	cwd: rootDir,
	stdio: "inherit",
});

console.log("Build complete!");
