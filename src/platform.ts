/**
 * @module platform
 * OS-specific config directory resolution.
 * Replaces the `env-paths` package with a zero-dep implementation.
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Resolve the default config directory for a given project name,
 * following platform conventions:
 *
 * - **macOS**:   `~/Library/Preferences/<projectName>/`
 * - **Windows**: `%APPDATA%/<projectName>/`
 * - **Linux**:   `$XDG_CONFIG_HOME/<projectName>/` (defaults to `~/.config`)
 */
export function resolveConfigDir(projectName: string): string {
	const home = homedir();
	const os = platform();

	switch (os) {
		case "darwin":
			return join(home, "Library", "Preferences", projectName);

		case "win32":
			return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), projectName);

		default:
			// Linux / FreeBSD / other Unix
			return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), projectName);
	}
}

/**
 * Build the full database file path from options.
 */
export function resolveConfigPath(options: {
	projectName: string;
	cwd?: string;
	configName?: string;
}): string {
	const dir = options.cwd ?? resolveConfigDir(options.projectName);
	const name = options.configName ?? "config";
	return join(dir, `${name}.db`);
}
