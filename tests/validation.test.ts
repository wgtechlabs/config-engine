/**
 * Tests for the validation module.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createZodValidator, resolveValidator } from "../src/validation.js";
import type { Validator } from "../src/types.js";

describe("createZodValidator", () => {
	const schema = z.object({
		theme: z.enum(["light", "dark"]),
		fontSize: z.number().min(8).max(72),
	});

	const validator = createZodValidator(schema);

	test("valid data returns success", () => {
		const result = validator.validate({ theme: "dark", fontSize: 14 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({ theme: "dark", fontSize: 14 });
		}
	});

	test("invalid data returns errors", () => {
		const result = validator.validate({ theme: "blue", fontSize: 200 });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors.length).toBeGreaterThan(0);
		}
	});

	test("missing fields returns errors", () => {
		const result = validator.validate({});
		expect(result.success).toBe(false);
	});

	test("extra fields are stripped by default", () => {
		const result = validator.validate({
			theme: "light",
			fontSize: 12,
			extra: "field",
		});
		// Zod strips extra fields in .parse but not .safeParse by default
		expect(result.success).toBe(true);
	});
});

describe("resolveValidator", () => {
	test("returns Zod validator when schema is provided", () => {
		const schema = z.object({ name: z.string() });
		const validator = resolveValidator({ schema });
		expect(validator).toBeDefined();

		const result = validator!.validate({ name: "test" });
		expect(result.success).toBe(true);
	});

	test("returns custom validator when provided", () => {
		const custom: Validator<{ x: number }> = {
			validate(data) {
				if (typeof data === "object" && data !== null && "x" in data) {
					return { success: true, data: data as { x: number } };
				}
				return { success: false, errors: ["Missing x field"] };
			},
		};

		const validator = resolveValidator({ validator: custom });
		expect(validator).toBe(custom);
	});

	test("custom validator takes precedence over schema", () => {
		const schema = z.object({ name: z.string() });
		const custom: Validator<{ name: string }> = {
			validate() {
				return { success: false, errors: ["custom always fails"] };
			},
		};

		const validator = resolveValidator({ schema, validator: custom });
		expect(validator).toBe(custom);
	});

	test("returns undefined when nothing is provided", () => {
		const validator = resolveValidator({});
		expect(validator).toBeUndefined();
	});
});
