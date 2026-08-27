/**
 * Tests for the in-memory cache layer.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigCache } from "../src/cache.js";
import { openDatabase } from "../src/runtime.js";
import { ConfigStore } from "../src/store.js";

let store: ConfigStore;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`config-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
	dbPath = join(tmpDir, "test.db");
	store = new ConfigStore(openDatabase(dbPath));
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

describe("ConfigCache", () => {
	test("load populates from store", () => {
		store.setMany([
			["a", 1],
			["b", 2],
		]);
		const cache = new ConfigCache(store, "manual");
		cache.load();

		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
		expect(cache.size).toBe(2);
	});

	test("load with initial data", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load({ x: 10, y: 20 });

		expect(cache.get("x")).toBe(10);
		expect(cache.get("y")).toBe(20);
	});

	test("get returns undefined for missing key", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load();
		expect(cache.get("nope")).toBeUndefined();
	});

	test("set + has + get", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load();

		cache.set("key", "value");
		expect(cache.has("key")).toBe(true);
		expect(cache.get("key")).toBe("value");
	});

	test("delete", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load({ a: 1 });

		expect(cache.delete("a")).toBe(true);
		expect(cache.has("a")).toBe(false);
		expect(cache.delete("a")).toBe(false);
	});

	test("clear", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load({ a: 1, b: 2 });

		cache.clear();
		expect(cache.size).toBe(0);
	});

	test("getAll returns shallow copy", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load({ a: 1, b: 2 });

		const all = cache.getAll();
		expect(all).toEqual({ a: 1, b: 2 });

		// Mutation of returned object shouldn't affect cache
		(all as Record<string, unknown>).a = 999;
		expect(cache.get("a")).toBe(1);
	});

	test("flushSync writes dirty entries to store", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load();

		cache.set("x", 42);
		cache.set("y", "hello");

		// Not in store yet
		expect(store.getOne("x")).toBeUndefined();

		cache.flushSync();

		// Now in store
		expect(store.getOne("x")).toBe(42);
		expect(store.getOne("y")).toBe("hello");
	});

	test("flushSync handles deletes", () => {
		store.setOne("a", 1);
		const cache = new ConfigCache(store, "manual");
		cache.load();

		cache.delete("a");
		cache.flushSync();

		expect(store.has("a")).toBe(false);
	});

	test("immediate strategy flushes on every set", () => {
		const cache = new ConfigCache(store, "immediate");
		cache.load();

		cache.set("fast", true);
		// Should already be in store
		expect(store.getOne("fast")).toBe(true);
	});

	test("batched strategy flushes via microtask", async () => {
		const cache = new ConfigCache(store, "batched");
		cache.load();

		cache.set("async", 42);
		// Not in store yet (microtask hasn't run)
		expect(store.getOne("async")).toBeUndefined();

		// Wait for microtask
		await cache.flush();
		expect(store.getOne("async")).toBe(42);
	});

	test("replaceAll swaps entire cache", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load({ a: 1, b: 2 });

		cache.replaceAll({ x: 10, y: 20 } as Record<string, unknown>);

		expect(cache.has("a")).toBe(false);
		expect(cache.has("b")).toBe(false);
		expect(cache.get("x")).toBe(10);
		expect(cache.get("y")).toBe(20);
	});

	test("setMany sets multiple keys", () => {
		const cache = new ConfigCache(store, "manual");
		cache.load();

		cache.setMany([
			["a", 1],
			["b", 2],
		]);
		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
	});

	test("reload discards uncommitted changes", () => {
		store.setOne("original", true);
		const cache = new ConfigCache(store, "manual");
		cache.load();

		cache.set("uncommitted", "yes");
		cache.reload();

		expect(cache.has("uncommitted")).toBe(false);
		expect(cache.get("original")).toBe(true);
	});
});
