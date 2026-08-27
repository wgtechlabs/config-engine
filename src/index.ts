/**
 * @module config-engine
 * Node.js configuration engine with SQLite-backed storage.
 * Bun is used as the build and test toolchain; Node.js is the target runtime.
 *
 * @example
 * ```ts
 * import { ConfigEngine } from "@wgtechlabs/config-engine";
 * import { z } from "zod";
 *
 * const config = await ConfigEngine.open({
 *   projectName: "my-app",
 *   defaults: { theme: "dark", fontSize: 14 },
 *   schema: z.object({
 *     theme: z.enum(["light", "dark"]),
 *     fontSize: z.number().min(8).max(72),
 *   }),
 * });
 *
 * config.get("theme");        // "dark"
 * config.set("fontSize", 16);
 * config.set({ theme: "light", fontSize: 12 });
 *
 * config.close();
 * ```
 */

import { mkdirSync } from "node:fs";
import { type FSWatcher, watch } from "node:fs";
import { dirname } from "node:path";

import { ConfigCache } from "./cache.js";
import { deleteByPath, getByPath, hasByPath, setByPath } from "./dot-prop.js";
import { resolveEncryptor } from "./encryption.js";
import { runMigrations } from "./migrations.js";
import { resolveConfigPath } from "./platform.js";
import { openDatabase } from "./runtime.js";
import { ConfigStore } from "./store.js";
import type {
	AnyChangeCallback,
	ChangeCallback,
	ConfigEngineOptions,
	Encryptor,
	FlushStrategy,
	Unsubscribe,
	Validator,
} from "./types.js";
import { resolveValidator } from "./validation.js";

// Re-export public types
export type {
	ConfigEngineOptions,
	Validator,
	ValidationResult,
	ValidationSuccess,
	ValidationFailure,
	Encryptor,
	MigrationDefinition,
	MigrationContext,
	MigrationHookContext,
	FlushStrategy as FlushStrategyType,
	ChangeCallback,
	AnyChangeCallback,
	Unsubscribe,
} from "./types.js";

export { createZodValidator, resolveValidator } from "./validation.js";
export { resolveConfigDir, resolveConfigPath } from "./platform.js";
export type { FlushStrategy } from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConfigEngineError extends Error {
	override name = "ConfigEngineError";
}

export class ValidationError extends ConfigEngineError {
	override name = "ValidationError";
	errors: string[];

	constructor(errors: string[]) {
		super(`Config validation failed:\n  - ${errors.join("\n  - ")}`);
		this.errors = errors;
	}
}

// ---------------------------------------------------------------------------
// ConfigEngine
// ---------------------------------------------------------------------------

export class ConfigEngine<T extends Record<string, unknown>> {
	readonly #store: ConfigStore;
	readonly #cache: ConfigCache<T>;
	readonly #validator: Validator<T> | undefined;
	readonly #encryptor: Encryptor | undefined;
	readonly #defaults: Partial<T>;
	readonly #dotNotation: boolean;
	readonly #filePath: string;
	readonly #listeners = new Map<string, Set<ChangeCallback<unknown>>>();
	readonly #anyListeners = new Set<AnyChangeCallback<T>>();
	#watcher: FSWatcher | null = null;
	#lastKnownWrite = 0;
	#closed = false;

	/**
	 * Private constructor — use `ConfigEngine.open()` instead.
	 */
	private constructor(
		store: ConfigStore,
		cache: ConfigCache<T>,
		options: {
			validator?: Validator<T>;
			encryptor?: Encryptor;
			defaults: Partial<T>;
			dotNotation: boolean;

			filePath: string;
			watch: boolean;
		},
	) {
		this.#store = store;
		this.#cache = cache;
		this.#validator = options.validator;
		this.#encryptor = options.encryptor;
		this.#defaults = options.defaults;
		this.#dotNotation = options.dotNotation;
		this.#filePath = options.filePath;
		this.#lastKnownWrite = store.getLastWrite();

		if (options.watch) {
			this.#startWatching();
		}
	}

	/**
	 * Async factory — the only way to create a `ConfigEngine` instance.
	 * Handles encryption init, migration, and initial validation.
	 */
	static async open<T extends Record<string, unknown>>(
		options: ConfigEngineOptions<T>,
	): Promise<ConfigEngine<T>> {
		const {
			projectName,
			projectVersion,
			cwd,
			configName,
			defaults = {} as Partial<T>,
			encryptionKey,
			migrations,
			beforeEachMigration,
			afterEachMigration,
			flushStrategy = "batched",
			accessPropertiesByDotNotation = true,
			watch: enableWatch = false,
			clearInvalidConfig = false,
		} = options;

		// Resolve file path and ensure directory exists
		const filePath = resolveConfigPath({ projectName, cwd, configName });
		mkdirSync(dirname(filePath), { recursive: true });

		// Open SQLite database
		const db = openDatabase(filePath);
		const store = new ConfigStore(db);

		// Resolve encryption
		const encryptor = await resolveEncryptor(encryptionKey);

		// Resolve validator
		const validator = resolveValidator<T>(options);

		// Load existing data (with optional decryption)
		let storedData: Record<string, unknown>;
		try {
			storedData = store.getAll();
			if (encryptor) {
				storedData = await decryptStore(storedData, encryptor);
			}
		} catch (error) {
			if (clearInvalidConfig) {
				store.deleteAll();
				storedData = {};
			} else {
				store.close();
				throw new ConfigEngineError(
					`Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Merge defaults (defaults fill in missing keys, don't overwrite)
		const merged = { ...defaults, ...storedData } as T;

		// Validate initial store
		if (validator) {
			const result = validator.validate(merged);
			if (!result.success) {
				if (clearInvalidConfig) {
					store.deleteAll();
					// Re-merge with just defaults
					const freshData = { ...defaults } as T;
					const freshResult = validator.validate(freshData);
					if (!freshResult.success) {
						store.close();
						throw new ValidationError(freshResult.errors);
					}
					// Write defaults
					const entries = Object.entries(freshData);
					if (encryptor) {
						const encrypted = await encryptStore(freshData, encryptor);
						store.setMany(Object.entries(encrypted));
					} else {
						store.setMany(entries);
					}
					store.touchLastWrite();

					const cache = new ConfigCache<T>(store, flushStrategy);
					cache.load(freshData);

					return new ConfigEngine<T>(store, cache, {
						validator,
						encryptor,
						defaults,
						dotNotation: accessPropertiesByDotNotation,
						filePath,
						watch: enableWatch,
					});
				}
				store.close();
				throw new ValidationError(result.errors);
			}
		}

		// Persist merged data if defaults added new keys
		const hasNewDefaults = Object.keys(defaults).some((key) => !(key in storedData));
		if (hasNewDefaults) {
			if (encryptor) {
				const encrypted = await encryptStore(merged, encryptor);
				store.setMany(Object.entries(encrypted));
			} else {
				store.setMany(Object.entries(merged));
			}
			store.touchLastWrite();
		}

		// Run migrations if configured
		if (migrations && migrations.length > 0) {
			if (!projectVersion) {
				store.close();
				throw new ConfigEngineError('"projectVersion" is required when "migrations" is provided.');
			}
			await runMigrations({
				store,
				migrations,
				projectVersion,
				beforeEachMigration,
				afterEachMigration,
			});
		}

		// Initialize cache
		const cache = new ConfigCache<T>(store, flushStrategy);
		let finalData: Record<string, unknown>;
		if (encryptor) {
			finalData = await decryptStore(store.getAll(), encryptor);
		} else {
			finalData = store.getAll();
		}
		// Re-merge defaults in case migrations changed data
		const cacheData = { ...defaults, ...finalData } as T;
		cache.load(cacheData);

		return new ConfigEngine<T>(store, cache, {
			validator,
			encryptor,
			defaults,
			dotNotation: accessPropertiesByDotNotation,
			filePath,
			watch: enableWatch,
		});
	}

	// -----------------------------------------------------------------------
	// Read operations
	// -----------------------------------------------------------------------

	/**
	 * Get a config value by key. Supports dot-notation by default.
	 * @param key - The configuration key.
	 * @param defaultValue - Fallback value if the key doesn't exist.
	 */
	get<K extends string & keyof T>(key: K): T[K] | undefined;
	get<K extends string & keyof T>(key: K, defaultValue: T[K]): T[K];
	get<V = unknown>(key: string, defaultValue?: V): V | undefined;
	get(key: string, defaultValue?: unknown): unknown {
		this.#ensureOpen();

		if (this.#dotNotation && key.includes(".")) {
			const full = this.#cache.getAll();
			const value = getByPath(full, key);
			return value !== undefined ? value : defaultValue;
		}

		const value = this.#cache.get(key);
		return value !== undefined ? value : defaultValue;
	}

	/**
	 * Check whether a key exists in the config.
	 */
	has(key: string): boolean {
		this.#ensureOpen();

		if (this.#dotNotation && key.includes(".")) {
			return hasByPath(this.#cache.getAll(), key);
		}
		return this.#cache.has(key);
	}

	/**
	 * Get the entire config store as a typed object (shallow copy).
	 */
	get store(): T {
		this.#ensureOpen();
		return this.#cache.getAll();
	}

	/**
	 * Replace the entire config store.
	 */
	set store(value: T) {
		this.#ensureOpen();
		this.#validateFull(value);

		const oldStore = this.#cache.getAll();
		this.#cache.replaceAll(value);
		this.#notifyAnyChange(value, oldStore);
	}

	/**
	 * Number of top-level config entries.
	 */
	get size(): number {
		this.#ensureOpen();
		return this.#cache.size;
	}

	/**
	 * Absolute path to the SQLite database file.
	 */
	get path(): string {
		return this.#filePath;
	}

	// -----------------------------------------------------------------------
	// Write operations
	// -----------------------------------------------------------------------

	/**
	 * Set a config value. Supports two signatures:
	 * - `set(key, value)` — set a single key
	 * - `set(object)` — set multiple keys at once
	 */
	set<K extends string & keyof T>(key: K, value: T[K]): void;
	set(key: string, value: unknown): void;
	set(object: Partial<T>): void;
	set(keyOrObject: string | Partial<T>, value?: unknown): void {
		this.#ensureOpen();

		if (typeof keyOrObject === "string") {
			this.#setKey(keyOrObject, value);
		} else {
			const entries = Object.entries(keyOrObject);
			const oldStore = this.#cache.getAll();

			for (const [key, val] of entries) {
				if (this.#dotNotation && key.includes(".")) {
					const full = this.#cache.getAll();
					const updated = setByPath(full, key, val);
					this.#validateFull(updated as T);
					this.#cache.replaceAll(updated as T);
				} else {
					this.#cache.set(key, val);
				}
			}

			// Validate the full store after batch update
			this.#validateFull(this.#cache.getAll());
			this.#notifyAnyChange(this.#cache.getAll(), oldStore);
		}
	}

	#setKey(key: string, value: unknown): void {
		const oldStore = this.#cache.getAll();
		const oldValue = this.get(key);

		if (this.#dotNotation && key.includes(".")) {
			const full = this.#cache.getAll();
			const updated = setByPath(full, key, value);
			this.#validateFull(updated as T);
			this.#cache.replaceAll(updated as T);
		} else {
			// Validate with this change applied
			const testStore = { ...this.#cache.getAll(), [key]: value } as T;
			this.#validateFull(testStore);
			this.#cache.set(key, value);
		}

		this.#notifyKeyChange(key, value, oldValue);
		this.#notifyAnyChange(this.#cache.getAll(), oldStore);
	}

	/**
	 * Delete a config key.
	 */
	delete(key: string): void {
		this.#ensureOpen();

		const oldStore = this.#cache.getAll();
		const oldValue = this.get(key);

		if (this.#dotNotation && key.includes(".")) {
			const full = this.#cache.getAll();
			const updated = deleteByPath(full, key);
			this.#cache.replaceAll(updated as T);
		} else {
			this.#cache.delete(key);
		}

		this.#notifyKeyChange(key, undefined, oldValue);
		this.#notifyAnyChange(this.#cache.getAll(), oldStore);
	}

	/**
	 * Delete all config entries and restore defaults.
	 */
	clear(): void {
		this.#ensureOpen();

		const oldStore = this.#cache.getAll();
		this.#cache.clear();

		// Restore defaults
		if (this.#defaults && Object.keys(this.#defaults).length > 0) {
			this.#cache.setMany(Object.entries(this.#defaults));
		}

		this.#notifyAnyChange(this.#cache.getAll(), oldStore);
	}

	/**
	 * Reset specific keys to their default values.
	 */
	reset(...keys: (string & keyof T)[]): void {
		this.#ensureOpen();

		const oldStore = this.#cache.getAll();

		for (const key of keys) {
			if (key in this.#defaults) {
				this.#cache.set(key, this.#defaults[key]);
			} else {
				this.#cache.delete(key);
			}
		}

		this.#notifyAnyChange(this.#cache.getAll(), oldStore);
	}

	// -----------------------------------------------------------------------
	// Change events
	// -----------------------------------------------------------------------

	/**
	 * Watch a specific key for changes.
	 * @returns An unsubscribe function.
	 */
	onDidChange<K extends string & keyof T>(key: K, callback: ChangeCallback<T[K]>): Unsubscribe {
		if (!this.#listeners.has(key)) {
			this.#listeners.set(key, new Set());
		}
		const set = this.#listeners.get(key)!;
		set.add(callback as ChangeCallback<unknown>);

		return () => {
			set.delete(callback as ChangeCallback<unknown>);
			if (set.size === 0) this.#listeners.delete(key);
		};
	}

	/**
	 * Watch the entire store for any change.
	 * @returns An unsubscribe function.
	 */
	onDidAnyChange(callback: AnyChangeCallback<T>): Unsubscribe {
		this.#anyListeners.add(callback);
		return () => {
			this.#anyListeners.delete(callback);
		};
	}

	// -----------------------------------------------------------------------
	// Flush & lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Flush any pending writes to disk.
	 * Required when using `flushStrategy: "manual"`.
	 */
	async flush(): Promise<void> {
		this.#ensureOpen();
		await this.#cache.flush();
	}

	/**
	 * Synchronously flush any pending writes to disk.
	 */
	flushSync(): void {
		this.#ensureOpen();
		this.#cache.flushSync();
	}

	/**
	 * Close the config engine. Flushes pending writes and releases
	 * the database connection. The instance cannot be used after closing.
	 */
	close(): void {
		if (this.#closed) return;

		this.#stopWatching();
		this.#cache.flushSync();
		this.#store.close();
		this.#closed = true;
	}

	// -----------------------------------------------------------------------
	// Iterable
	// -----------------------------------------------------------------------

	*[Symbol.iterator](): IterableIterator<[string, unknown]> {
		this.#ensureOpen();
		yield* this.#cache.entries();
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	#ensureOpen(): void {
		if (this.#closed) {
			throw new ConfigEngineError(
				"This ConfigEngine instance has been closed. Create a new one with ConfigEngine.open().",
			);
		}
	}

	#validateFull(data: T): void {
		if (!this.#validator) return;

		const result = this.#validator.validate(data);
		if (!result.success) {
			throw new ValidationError(result.errors);
		}
	}

	#notifyKeyChange(key: string, newValue: unknown, oldValue: unknown): void {
		if (newValue === oldValue) return;
		if (
			typeof newValue === "object" &&
			typeof oldValue === "object" &&
			JSON.stringify(newValue) === JSON.stringify(oldValue)
		) {
			return;
		}

		const listeners = this.#listeners.get(key);
		if (listeners) {
			for (const cb of listeners) {
				cb(newValue, oldValue);
			}
		}
	}

	#notifyAnyChange(newStore: T, oldStore: T): void {
		if (JSON.stringify(newStore) === JSON.stringify(oldStore)) return;

		for (const cb of this.#anyListeners) {
			cb(newStore, oldStore);
		}
	}

	// -----------------------------------------------------------------------
	// File watching
	// -----------------------------------------------------------------------

	#startWatching(): void {
		try {
			this.#watcher = watch(dirname(this.#filePath), (_event, filename) => {
				if (!filename) return;
				const expectedName = this.#filePath.split(/[\\/]/).pop();
				if (filename !== expectedName) return;

				// Check if an external process updated the DB
				const currentWrite = this.#store.getLastWrite();
				if (currentWrite > this.#lastKnownWrite) {
					this.#lastKnownWrite = currentWrite;
					const oldStore = this.#cache.getAll();
					this.#cache.reload();
					const newStore = this.#cache.getAll();
					this.#notifyAnyChange(newStore, oldStore);
				}
			});

			// Don't keep the process alive just for file watching
			if (this.#watcher && "unref" in this.#watcher) {
				this.#watcher.unref();
			}
		} catch {
			// If watching fails (e.g. some CI environments), silently ignore
		}
	}

	#stopWatching(): void {
		if (this.#watcher) {
			this.#watcher.close();
			this.#watcher = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

async function encryptStore(
	data: Record<string, unknown>,
	encryptor: Encryptor,
): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(data)) {
		result[key] = await encryptor.encrypt(JSON.stringify(value));
	}
	return result;
}

async function decryptStore(
	data: Record<string, unknown>,
	encryptor: Encryptor,
): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (typeof value === "string") {
			try {
				const decrypted = await encryptor.decrypt(value);
				result[key] = JSON.parse(decrypted);
			} catch {
				// Value might not be encrypted (e.g. first load with encryption enabled)
				result[key] = value;
			}
		} else {
			result[key] = value;
		}
	}
	return result;
}
