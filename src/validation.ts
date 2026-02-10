/**
 * @module validation
 * Pluggable validation system with built-in Zod adapter.
 */

import { type ZodSchema, type ZodError } from "zod";
import type { ValidationResult, Validator } from "./types.js";

/**
 * Create a `Validator<T>` backed by a Zod schema.
 *
 * ```ts
 * import { z } from "zod";
 * import { createZodValidator } from "@wgtechlabs/config-engine/validators/zod";
 *
 * const validator = createZodValidator(z.object({
 *   theme: z.enum(["light", "dark"]),
 *   fontSize: z.number().min(8).max(72),
 * }));
 * ```
 */
export function createZodValidator<T>(schema: ZodSchema<T>): Validator<T> {
	return {
		validate(data: unknown): ValidationResult<T> {
			const result = schema.safeParse(data);
			if (result.success) {
				return { success: true, data: result.data };
			}
			return {
				success: false,
				errors: formatZodErrors(result.error),
			};
		},
	};
}

/**
 * Format Zod errors into human-readable strings.
 */
function formatZodErrors(error: ZodError): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.length > 0 ? `\`${issue.path.join(".")}\` ` : "";
		return `${path}${issue.message}`;
	});
}

/**
 * Build a validator from the options — resolves `schema` vs `validator`.
 */
export function resolveValidator<T>(options: {
	schema?: ZodSchema<T>;
	validator?: Validator<T>;
}): Validator<T> | undefined {
	// Explicit validator takes precedence
	if (options.validator) return options.validator;
	// Fall back to Zod schema
	if (options.schema) return createZodValidator(options.schema);
	return undefined;
}
