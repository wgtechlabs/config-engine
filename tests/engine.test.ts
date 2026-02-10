/**
 * Integration tests for the ConfigEngine class.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ConfigEngine, ValidationError } from "../src/index.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(tmpdir(), `config-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function opts<T extends Record<string, unknown>>(
	overrides: Partial<import("../src/types.js").ConfigEngineOptions<T>> = {},
) {
	return {
		projectName: "test-app",
		cwd: tmpDir,
		flushStrategy: "immediate" as const,
		...overrides,
	};
}

// -----------------------------------------------------------------------
// Basic CRUD
// -----------------------------------------------------------------------

describe("ConfigEngine — basic CRUD", () => {
	test("open creates a new config store", async () => {
		const config = await ConfigEngine.open(opts());
		expect(config.size).toBe(0);
		expect(config.path).toContain("config.db");
		config.close();
	});

	test("set and get a value", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("name", "Waren");
		expect(config.get("name")).toBe("Waren");
		config.close();
	});

	test("set multiple values with object syntax", async () => {
		const config = await ConfigEngine.open(opts());
		config.set({ theme: "dark", fontSize: 14 });
		expect(config.get("theme")).toBe("dark");
		expect(config.get("fontSize")).toBe(14);
		config.close();
	});

	test("has returns correct boolean", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("exists", true);
		expect(config.has("exists")).toBe(true);
		expect(config.has("missing")).toBe(false);
		config.close();
	});

	test("delete removes a key", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("key", "value");
		config.delete("key");
		expect(config.has("key")).toBe(false);
		config.close();
	});

	test("clear resets to defaults", async () => {
		const config = await ConfigEngine.open(
			opts({ defaults: { theme: "light" } }),
		);
		config.set("theme", "dark");
		config.set("extra", "value");
		config.clear();

		expect(config.get("theme")).toBe("light");
		expect(config.has("extra")).toBe(false);
		config.close();
	});

	test("reset specific keys to defaults", async () => {
		const config = await ConfigEngine.open(
			opts({ defaults: { a: 1, b: 2, c: 3 } }),
		);
		config.set("a", 100);
		config.set("b", 200);
		config.reset("a");

		expect(config.get("a")).toBe(1);
		expect(config.get("b")).toBe(200);
		expect(config.get("c")).toBe(3);
		config.close();
	});

	test("store getter returns full object", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("a", 1);
		config.set("b", 2);

		const store = config.store;
		expect(store).toEqual({ a: 1, b: 2 });
		config.close();
	});

	test("store setter replaces everything", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("old", true);
		config.store = { new: true } as Record<string, unknown>;

		expect(config.has("old")).toBe(false);
		expect(config.get("new")).toBe(true);
		config.close();
	});

	test("size reflects entry count", async () => {
		const config = await ConfigEngine.open(opts());
		expect(config.size).toBe(0);

		config.set("a", 1);
		config.set("b", 2);
		expect(config.size).toBe(2);

		config.delete("a");
		expect(config.size).toBe(1);
		config.close();
	});

	test("Symbol.iterator yields entries", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("x", 10);
		config.set("y", 20);

		const entries = [...config];
		expect(entries).toEqual(
			expect.arrayContaining([
				["x", 10],
				["y", 20],
			]),
		);
		config.close();
	});
});

// -----------------------------------------------------------------------
// Defaults
// -----------------------------------------------------------------------

describe("ConfigEngine — defaults", () => {
	test("defaults populate on first open", async () => {
		const config = await ConfigEngine.open(
			opts({ defaults: { theme: "dark", fontSize: 14 } }),
		);
		expect(config.get("theme")).toBe("dark");
		expect(config.get("fontSize")).toBe(14);
		config.close();
	});

	test("existing values are not overwritten by defaults", async () => {
		// First open — set a value
		const config1 = await ConfigEngine.open(
			opts({ defaults: { theme: "dark" } }),
		);
		config1.set("theme", "light");
		config1.close();

		// Second open — defaults should not overwrite
		const config2 = await ConfigEngine.open(
			opts({ defaults: { theme: "dark" } }),
		);
		expect(config2.get("theme")).toBe("light");
		config2.close();
	});

	test("get with defaultValue fallback", async () => {
		const config = await ConfigEngine.open(opts());
		expect(config.get("missing", "fallback")).toBe("fallback");
		config.close();
	});
});

// -----------------------------------------------------------------------
// Dot notation
// -----------------------------------------------------------------------

describe("ConfigEngine — dot notation", () => {
	test("set and get nested values via dot notation", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("ui.sidebar.width", 300);
		expect(config.get("ui.sidebar.width")).toBe(300);
		expect(config.get("ui")).toEqual({ sidebar: { width: 300 } });
		config.close();
	});

	test("has works with dot notation", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("a.b.c", true);
		expect(config.has("a.b.c")).toBe(true);
		expect(config.has("a.b.d")).toBe(false);
		config.close();
	});

	test("delete works with dot notation", async () => {
		const config = await ConfigEngine.open(opts());
		config.set("a.b", 1);
		config.set("a.c", 2);
		config.delete("a.b");
		expect(config.has("a.b")).toBe(false);
		expect(config.get("a.c")).toBe(2);
		config.close();
	});

	test("dot notation can be disabled", async () => {
		const config = await ConfigEngine.open(
			opts({ accessPropertiesByDotNotation: false }),
		);
		config.set("a.b.c", "literal");
		expect(config.get("a.b.c")).toBe("literal");
		expect(config.has("a")).toBe(false); // "a" should not exist as a key
		config.close();
	});
});

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------

describe("ConfigEngine — validation", () => {
	const schema = z.object({
		theme: z.enum(["light", "dark"]),
		fontSize: z.number().min(8).max(72),
	});

	test("valid data passes", async () => {
		const config = await ConfigEngine.open(
			opts({
				defaults: { theme: "dark", fontSize: 14 },
				schema,
			}),
		);
		config.set("fontSize", 20);
		expect(config.get("fontSize")).toBe(20);
		config.close();
	});

	test("invalid data throws ValidationError", async () => {
		const config = await ConfigEngine.open(
			opts({
				defaults: { theme: "dark", fontSize: 14 },
				schema,
			}),
		);

		expect(() => config.set("fontSize", 200)).toThrow(ValidationError);
		// Value should not have changed
		expect(config.get("fontSize")).toBe(14);
		config.close();
	});

	test("invalid initial data with clearInvalidConfig", async () => {
		// First: write invalid data without schema
		const config1 = await ConfigEngine.open(opts());
		config1.set("theme", "invalid");
		config1.set("fontSize", 999);
		config1.close();

		// Second: open with schema + clearInvalidConfig
		const config2 = await ConfigEngine.open(
			opts({
				defaults: { theme: "dark", fontSize: 14 },
				schema,
				clearInvalidConfig: true,
			}),
		);
		// Should have cleared and restored defaults
		expect(config2.get("theme")).toBe("dark");
		expect(config2.get("fontSize")).toBe(14);
		config2.close();
	});

	test("custom validator works", async () => {
		const config = await ConfigEngine.open(
			opts({
				defaults: { count: 0 },
				validator: {
					validate(data) {
						if (
							typeof data === "object" &&
							data !== null &&
							"count" in data &&
							typeof (data as Record<string, unknown>).count === "number" &&
							((data as Record<string, unknown>).count as number) >= 0
						) {
							return { success: true, data: data as { count: number } };
						}
						return { success: false, errors: ["count must be >= 0"] };
					},
				},
			}),
		);

		config.set("count", 5);
		expect(config.get("count")).toBe(5);

		expect(() => config.set("count", -1)).toThrow();
		config.close();
	});
});

// -----------------------------------------------------------------------
// Persistence
// -----------------------------------------------------------------------

describe("ConfigEngine — persistence", () => {
	test("data survives close and reopen", async () => {
		const config1 = await ConfigEngine.open(opts());
		config1.set("persistent", true);
		config1.set("count", 42);
		config1.close();

		const config2 = await ConfigEngine.open(opts());
		expect(config2.get("persistent")).toBe(true);
		expect(config2.get("count")).toBe(42);
		config2.close();
	});

	test("custom configName creates separate stores", async () => {
		const config1 = await ConfigEngine.open(
			opts({ configName: "store-a" }),
		);
		config1.set("source", "a");
		config1.close();

		const config2 = await ConfigEngine.open(
			opts({ configName: "store-b" }),
		);
		config2.set("source", "b");
		config2.close();

		const reopen1 = await ConfigEngine.open(
			opts({ configName: "store-a" }),
		);
		const reopen2 = await ConfigEngine.open(
			opts({ configName: "store-b" }),
		);

		expect(reopen1.get("source")).toBe("a");
		expect(reopen2.get("source")).toBe("b");

		reopen1.close();
		reopen2.close();
	});
});

// -----------------------------------------------------------------------
// Migrations
// -----------------------------------------------------------------------

describe("ConfigEngine — migrations", () => {
	test("runs migrations on open", async () => {
		// First open — set initial data
		const config1 = await ConfigEngine.open(opts());
		config1.set("oldKey", "value");
		config1.close();

		// Second open — with migration
		const config2 = await ConfigEngine.open(
			opts({
				projectVersion: "2.0.0",
				migrations: [
					{
						version: "2.0.0",
						up(ctx) {
							const val = ctx.get<string>("oldKey");
							if (val) {
								ctx.set("newKey", val);
								ctx.delete("oldKey");
							}
						},
					},
				],
			}),
		);

		expect(config2.has("oldKey")).toBe(false);
		expect(config2.get("newKey")).toBe("value");
		config2.close();
	});

	test("throws when projectVersion is missing with migrations", async () => {
		await expect(
			ConfigEngine.open(
				opts({
					migrations: [{ version: "1.0.0", up() {} }],
				}),
			),
		).rejects.toThrow("projectVersion");
	});
});

// -----------------------------------------------------------------------
// Change events
// -----------------------------------------------------------------------

describe("ConfigEngine — change events", () => {
	test("onDidChange fires for watched key", async () => {
		const config = await ConfigEngine.open(opts());
		const changes: unknown[] = [];

		config.onDidChange("theme", (newVal, oldVal) => {
			changes.push({ newVal, oldVal });
		});

		config.set("theme", "dark");
		config.set("theme", "light");

		expect(changes).toEqual([
			{ newVal: "dark", oldVal: undefined },
			{ newVal: "light", oldVal: "dark" },
		]);
		config.close();
	});

	test("onDidAnyChange fires on any mutation", async () => {
		const config = await ConfigEngine.open(opts());
		let changeCount = 0;

		config.onDidAnyChange(() => {
			changeCount++;
		});

		config.set("a", 1);
		config.set("b", 2);
		config.delete("a");

		expect(changeCount).toBe(3);
		config.close();
	});

	test("unsubscribe stops notifications", async () => {
		const config = await ConfigEngine.open(opts());
		let count = 0;

		const unsub = config.onDidChange("key", () => {
			count++;
		});

		config.set("key", 1);
		unsub();
		config.set("key", 2);

		expect(count).toBe(1);
		config.close();
	});
});

// -----------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------

describe("ConfigEngine — lifecycle", () => {
	test("throws after close", async () => {
		const config = await ConfigEngine.open(opts());
		config.close();

		expect(() => config.get("anything")).toThrow("closed");
		expect(() => config.set("anything", 1)).toThrow("closed");
		expect(() => config.has("anything")).toThrow("closed");
	});

	test("double close is safe", async () => {
		const config = await ConfigEngine.open(opts());
		config.close();
		config.close(); // Should not throw
	});
});
