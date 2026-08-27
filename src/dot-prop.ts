/**
 * @module dot-prop
 * Lightweight dot-notation property access utilities.
 * Zero dependencies — replaces the `dot-prop` npm package.
 */

/**
 * Get a nested value using dot-notation path.
 *
 * ```ts
 * getByPath({ a: { b: { c: 42 } } }, "a.b.c") // 42
 * getByPath({ a: { b: 1 } }, "a.x")            // undefined
 * ```
 */
export function getByPath(obj: unknown, path: string): unknown {
	if (typeof obj !== "object" || obj === null) return undefined;

	const keys = path.split(".");
	let current: unknown = obj;

	for (const key of keys) {
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as Record<string, unknown>)[key];
	}

	return current;
}

/**
 * Set a nested value using dot-notation path. Creates intermediate
 * objects as needed. Returns a new object (shallow copies along the path).
 *
 * ```ts
 * setByPath({}, "a.b.c", 42)            // { a: { b: { c: 42 } } }
 * setByPath({ a: { x: 1 } }, "a.b", 2) // { a: { x: 1, b: 2 } }
 * ```
 */
export function setByPath<T extends Record<string, unknown>>(
	obj: T,
	path: string,
	value: unknown,
): T {
	const keys = path.split(".");
	if (keys.length === 0) return obj;

	// biome-ignore lint/suspicious/noExplicitAny: deep clone helper
	const result = { ...obj } as any;
	let current = result;

	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i]!;
		if (typeof current[key] !== "object" || current[key] === null) {
			current[key] = {};
		} else {
			current[key] = { ...current[key] };
		}
		current = current[key];
	}

	const lastKey = keys[keys.length - 1]!;
	current[lastKey] = value;

	return result as T;
}

/**
 * Check if a nested path exists.
 */
export function hasByPath(obj: unknown, path: string): boolean {
	if (typeof obj !== "object" || obj === null) return false;

	const keys = path.split(".");
	let current: unknown = obj;

	for (let i = 0; i < keys.length; i++) {
		if (typeof current !== "object" || current === null) return false;
		const key = keys[i]!;
		if (!Object.prototype.hasOwnProperty.call(current, key)) return false;
		current = (current as Record<string, unknown>)[key];
	}

	return true;
}

/**
 * Delete a nested property using dot-notation path.
 * Returns a new object (shallow copies along the path).
 * Returns the original object if the path doesn't exist.
 */
export function deleteByPath<T extends Record<string, unknown>>(obj: T, path: string): T {
	const keys = path.split(".");
	if (keys.length === 0) return obj;

	// biome-ignore lint/suspicious/noExplicitAny: deep clone helper
	const result = { ...obj } as any;
	let current = result;

	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i]!;
		if (typeof current[key] !== "object" || current[key] === null) {
			return obj; // Path doesn't exist — return unchanged
		}
		current[key] = { ...current[key] };
		current = current[key];
	}

	const lastKey = keys[keys.length - 1]!;
	delete current[lastKey];

	return result as T;
}
