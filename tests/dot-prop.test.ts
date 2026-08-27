/**
 * Tests for the dot-prop utility module.
 */

import { describe, expect, test } from "vitest";
import { deleteByPath, getByPath, hasByPath, setByPath } from "../src/dot-prop.js";

describe("getByPath", () => {
	test("gets top-level value", () => {
		expect(getByPath({ a: 1 }, "a")).toBe(1);
	});

	test("gets nested value", () => {
		expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
	});

	test("returns undefined for missing path", () => {
		expect(getByPath({ a: { b: 1 } }, "a.x")).toBeUndefined();
	});

	test("returns undefined for non-object intermediate", () => {
		expect(getByPath({ a: "string" }, "a.b")).toBeUndefined();
	});

	test("returns undefined for null input", () => {
		expect(getByPath(null, "a")).toBeUndefined();
	});

	test("handles array values", () => {
		expect(getByPath({ a: [1, 2, 3] }, "a")).toEqual([1, 2, 3]);
	});
});

describe("setByPath", () => {
	test("sets top-level value", () => {
		expect(setByPath({}, "a", 1)).toEqual({ a: 1 });
	});

	test("sets nested value", () => {
		expect(setByPath({}, "a.b.c", 42)).toEqual({ a: { b: { c: 42 } } });
	});

	test("preserves existing sibling keys", () => {
		expect(setByPath({ a: { x: 1 } }, "a.b", 2)).toEqual({
			a: { x: 1, b: 2 },
		});
	});

	test("overwrites existing value", () => {
		expect(setByPath({ a: { b: 1 } }, "a.b", 99)).toEqual({ a: { b: 99 } });
	});

	test("creates intermediate objects", () => {
		expect(setByPath({ a: "str" }, "a.b", 1)).toEqual({ a: { b: 1 } });
	});
});

describe("hasByPath", () => {
	test("returns true for existing path", () => {
		expect(hasByPath({ a: { b: 1 } }, "a.b")).toBe(true);
	});

	test("returns true for top-level key", () => {
		expect(hasByPath({ a: 1 }, "a")).toBe(true);
	});

	test("returns false for missing path", () => {
		expect(hasByPath({ a: { b: 1 } }, "a.c")).toBe(false);
	});

	test("returns false for non-object input", () => {
		expect(hasByPath(null, "a")).toBe(false);
	});

	test("returns true even for undefined value", () => {
		expect(hasByPath({ a: undefined }, "a")).toBe(true);
	});
});

describe("deleteByPath", () => {
	test("deletes top-level key", () => {
		const result = deleteByPath({ a: 1, b: 2 }, "a");
		expect(result).toEqual({ b: 2 });
		expect("a" in result).toBe(false);
	});

	test("deletes nested key", () => {
		const result = deleteByPath({ a: { b: 1, c: 2 } }, "a.b");
		expect(result).toEqual({ a: { c: 2 } });
	});

	test("returns original if path doesn't exist", () => {
		const obj = { a: 1 };
		expect(deleteByPath(obj, "b.c")).toBe(obj);
	});
});
