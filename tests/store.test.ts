/**
 * Tests for the SQLite store layer.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase } from "../src/runtime.js";
import { ConfigStore } from "../src/store.js";

let store: ConfigStore;
let dbPath: string;

beforeEach(() => {
	const dir = join(
		tmpdir(),
		`config-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	dbPath = join(dir, "test.db");
	const db = openDatabase(dbPath);
	store = new ConfigStore(db);
});

afterEach(() => {
	try {
		store.close();
	} catch {
		// ignore
	}
	try {
		rmSync(dbPath, { force: true });
		rmSync(`${dbPath}-wal`, { force: true });
		rmSync(`${dbPath}-shm`, { force: true });
	} catch {
		// ignore
	}
});

describe("ConfigStore", () => {
	test("starts empty", () => {
		expect(store.count()).toBe(0);
		expect(store.getAll()).toEqual({});
	});

	test("setOne / getOne", () => {
		store.setOne("name", "Waren");
		expect(store.getOne("name")).toBe("Waren");
	});

	test("stores complex values as JSON", () => {
		const value = { nested: { array: [1, 2, 3], flag: true } };
		store.setOne("complex", value);
		expect(store.getOne("complex")).toEqual(value);
	});

	test("getOne returns undefined for missing key", () => {
		expect(store.getOne("missing")).toBeUndefined();
	});

	test("setMany / getAll", () => {
		store.setMany([
			["a", 1],
			["b", "two"],
			["c", true],
		]);
		expect(store.getAll()).toEqual({ a: 1, b: "two", c: true });
	});

	test("setOne upserts existing key", () => {
		store.setOne("key", "old");
		store.setOne("key", "new");
		expect(store.getOne("key")).toBe("new");
	});

	test("has", () => {
		store.setOne("exists", 1);
		expect(store.has("exists")).toBe(true);
		expect(store.has("missing")).toBe(false);
	});

	test("deleteOne", () => {
		store.setOne("key", "value");
		expect(store.deleteOne("key")).toBe(true);
		expect(store.has("key")).toBe(false);
		expect(store.deleteOne("key")).toBe(false);
	});

	test("deleteAll", () => {
		store.setMany([
			["a", 1],
			["b", 2],
		]);
		store.deleteAll();
		expect(store.count()).toBe(0);
	});

	test("count", () => {
		store.setMany([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
		expect(store.count()).toBe(3);
	});

	test("meta operations", () => {
		expect(store.hasMeta("version")).toBe(false);

		store.setMeta("version", "1.0.0");
		expect(store.getMeta("version")).toBe("1.0.0");
		expect(store.hasMeta("version")).toBe(true);

		store.setMeta("version", "2.0.0");
		expect(store.getMeta("version")).toBe("2.0.0");
	});

	test("transaction", () => {
		store.transaction(() => {
			store.setOne("a", 1);
			store.setOne("b", 2);
		});
		expect(store.count()).toBe(2);
	});

	test("touchLastWrite / getLastWrite", () => {
		expect(store.getLastWrite()).toBe(0);
		store.touchLastWrite();
		expect(store.getLastWrite()).toBeGreaterThan(0);
	});
});
