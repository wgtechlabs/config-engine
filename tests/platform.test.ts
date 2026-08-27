/**
 * Tests for the platform module.
 */

import { describe, expect, test } from "bun:test";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { resolveConfigDir, resolveConfigPath } from "../src/platform.js";

describe("resolveConfigDir", () => {
	const home = homedir();

	test("returns a path containing the project name", () => {
		const dir = resolveConfigDir("my-app");
		expect(dir).toContain("my-app");
	});

	test("uses platform-appropriate base directory", () => {
		const dir = resolveConfigDir("test-app");
		const os = platform();

		if (os === "darwin") {
			expect(dir).toContain(join(home, "Library", "Preferences"));
		} else if (os === "win32") {
			expect(dir).toContain("test-app");
		} else {
			// Linux / other
			expect(dir).toContain(".config");
		}
	});
});

describe("resolveConfigPath", () => {
	test("returns .db file with default config name", () => {
		const path = resolveConfigPath({ projectName: "my-app" });
		expect(path).toEndWith("config.db");
		expect(path).toContain("my-app");
	});

	test("respects custom configName", () => {
		const path = resolveConfigPath({
			projectName: "my-app",
			configName: "settings",
		});
		expect(path).toEndWith("settings.db");
	});

	test("respects cwd override", () => {
		const path = resolveConfigPath({
			projectName: "my-app",
			cwd: "/tmp/custom-dir",
		});
		expect(path).toBe(join("/tmp/custom-dir", "config.db"));
	});
});
