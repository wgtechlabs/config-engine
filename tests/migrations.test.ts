/**
 * Tests for the migration system.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSchemaVersion, runMigrations } from "../src/migrations.js";
import { openDatabase } from "../src/runtime.js";
import { ConfigStore } from "../src/store.js";

let store: ConfigStore;
let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`config-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
	store = new ConfigStore(openDatabase(join(tmpDir, "test.db")));
});

afterEach(() => {
	try {
		store.close();
	} catch {
		/* ignore */
	}
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("migrations", () => {
	test("runs pending migrations in order", async () => {
		store.setOne("value", 1);

		await runMigrations({
			store,
			projectVersion: "2.0.0",
			migrations: [
				{
					version: "1.0.0",
					up(ctx) {
						const val = ctx.get<number>("value")!;
						ctx.set("value", val * 10);
					},
				},
				{
					version: "2.0.0",
					up(ctx) {
						const val = ctx.get<number>("value")!;
						ctx.set("value", val + 5);
					},
				},
			],
		});

		expect(store.getOne("value")).toBe(15); // (1 * 10) + 5
		expect(getSchemaVersion(store)).toBe("2.0.0");
	});

	test("skips already-applied migrations", async () => {
		store.setMeta("schema_version", "1.0.0");
		store.setOne("value", 10);

		await runMigrations({
			store,
			projectVersion: "2.0.0",
			migrations: [
				{
					version: "1.0.0",
					up(ctx) {
						// Should NOT run
						ctx.set("value", 999);
					},
				},
				{
					version: "2.0.0",
					up(ctx) {
						const val = ctx.get<number>("value")!;
						ctx.set("value", val + 1);
					},
				},
			],
		});

		expect(store.getOne("value")).toBe(11); // 10 + 1, not 999
	});

	test("rolls back on failure", async () => {
		store.setOne("value", "original");

		await expect(
			runMigrations({
				store,
				projectVersion: "2.0.0",
				migrations: [
					{
						version: "1.0.0",
						up(ctx) {
							ctx.set("value", "modified");
						},
					},
					{
						version: "2.0.0",
						up() {
							throw new Error("Migration failed!");
						},
					},
				],
			}),
		).rejects.toThrow("rolled back");

		// Should be restored
		expect(store.getOne("value")).toBe("original");
		expect(getSchemaVersion(store)).toBe("0.0.0");
	});

	test("supports async migration functions", async () => {
		store.setOne("value", 1);

		await runMigrations({
			store,
			projectVersion: "1.0.0",
			migrations: [
				{
					version: "1.0.0",
					async up(ctx) {
						// Simulate async work
						await new Promise((r) => setTimeout(r, 10));
						ctx.set("value", 42);
					},
				},
			],
		});

		expect(store.getOne("value")).toBe(42);
	});

	test("calls beforeEachMigration hook", async () => {
		const hooks: string[] = [];

		await runMigrations({
			store,
			projectVersion: "2.0.0",
			migrations: [
				{ version: "1.0.0", up() {} },
				{ version: "2.0.0", up() {} },
			],
			beforeEachMigration(ctx) {
				hooks.push(`before:${ctx.toVersion}`);
			},
		});

		expect(hooks).toEqual(["before:1.0.0", "before:2.0.0"]);
	});

	test("calls afterEachMigration hook", async () => {
		const hooks: string[] = [];

		await runMigrations({
			store,
			projectVersion: "2.0.0",
			migrations: [
				{ version: "1.0.0", up() {} },
				{ version: "2.0.0", up() {} },
			],
			afterEachMigration(ctx) {
				hooks.push(`after:${ctx.toVersion}`);
			},
		});

		expect(hooks).toEqual(["after:1.0.0", "after:2.0.0"]);
	});

	test("handles empty migrations array", async () => {
		await runMigrations({
			store,
			projectVersion: "1.0.0",
			migrations: [],
		});

		// Should not throw, version not set for empty migrations
		expect(getSchemaVersion(store)).toBe("0.0.0");
	});

	test("no-op when all migrations already applied", async () => {
		store.setMeta("schema_version", "2.0.0");
		store.setOne("value", "unchanged");

		await runMigrations({
			store,
			projectVersion: "2.0.0",
			migrations: [
				{
					version: "1.0.0",
					up(ctx) {
						ctx.set("value", "changed");
					},
				},
				{
					version: "2.0.0",
					up(ctx) {
						ctx.set("value", "changed");
					},
				},
			],
		});

		expect(store.getOne("value")).toBe("unchanged");
	});
});
