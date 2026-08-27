/**
 * @module types
 * Core type definitions for config-engine.
 */

import type { ZodSchema } from "zod";

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

/**
 * Minimal interface that `better-sqlite3` satisfies.
 * We program against this so the rest of the codebase stays decoupled from the driver.
 */
export interface DatabaseAdapter {
	prepare(sql: string): StatementAdapter;
	exec(sql: string): void;
	close(): void;
	transaction<T>(fn: () => T): () => T;
}

export interface StatementAdapter {
	run(...params: unknown[]): void;
	get(...params: unknown[]): unknown;
	all(...params: unknown[]): unknown[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationSuccess<T> {
	success: true;
	data: T;
}

export interface ValidationFailure {
	success: false;
	errors: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Pluggable validator interface. Implement this to bring your own
 * validation library (Valibot, AJV, custom, etc.).
 */
export interface Validator<T> {
	validate(data: unknown): ValidationResult<T>;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Pluggable encryption interface. The built-in adapter uses
 * `@wgtechlabs/secrets-engine` but you can provide your own.
 */
export interface Encryptor {
	encrypt(plaintext: string): Promise<string>;
	decrypt(ciphertext: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * Context exposed to migration functions. Operates directly on the
 * SQLite store, bypassing validation so migrations can fix invalid data.
 */
export interface MigrationContext {
	get<V = unknown>(key: string): V | undefined;
	set(key: string, value: unknown): void;
	has(key: string): boolean;
	delete(key: string): boolean;
}

export interface MigrationDefinition {
	/** Semver version this migration targets. */
	version: string;
	/** Migration function. May be async. */
	up(ctx: MigrationContext): void | Promise<void>;
}

export interface MigrationHookContext {
	fromVersion: string;
	toVersion: string;
	finalVersion: string;
	versions: string[];
}

// ---------------------------------------------------------------------------
// Flush strategy
// ---------------------------------------------------------------------------

export type FlushStrategy = "immediate" | "batched" | "manual";

// ---------------------------------------------------------------------------
// Change events
// ---------------------------------------------------------------------------

export type ChangeCallback<V> = (newValue: V | undefined, oldValue: V | undefined) => void;
export type AnyChangeCallback<T> = (newValue: T, oldValue: T) => void;
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ConfigEngineOptions<T extends Record<string, unknown>> {
	/** Application / project name — used to resolve the config directory. */
	projectName: string;

	/**
	 * Current project version (semver). Required when `migrations` is set.
	 * Used to determine which migrations to run.
	 */
	projectVersion?: string;

	/**
	 * Override the default config directory. When set, `projectName` is still
	 * required but only used for identification, not path resolution.
	 */
	cwd?: string;

	/** Config file name without extension. @default "config" */
	configName?: string;

	/** Default config values. Deep-merged into the store on first open. */
	defaults?: Partial<T>;

	/**
	 * Zod schema for built-in validation. If provided, all `.set()` calls
	 * are validated against this schema.
	 */
	schema?: ZodSchema<T>;

	/**
	 * Custom validator (pluggable). Takes precedence over `schema` if both
	 * are provided. Use this for Valibot, AJV, or any custom validator.
	 */
	validator?: Validator<T>;

	/**
	 * Encryption key name (to be resolved via `@wgtechlabs/secrets-engine`),
	 * OR a custom `Encryptor` instance for full control.
	 */
	encryptionKey?: string | Encryptor;

	/**
	 * Ordered list of migrations. Executed sequentially in a SQLite
	 * transaction with full rollback on failure.
	 */
	migrations?: MigrationDefinition[];

	/** Hook called before each migration runs. */
	beforeEachMigration?: (ctx: MigrationHookContext) => void | Promise<void>;

	/** Hook called after each migration runs. */
	afterEachMigration?: (ctx: MigrationHookContext) => void | Promise<void>;

	/**
	 * Write-behind strategy.
	 * - `"immediate"` — sync write on every `.set()`
	 * - `"batched"`   — debounced microtask flush (default)
	 * - `"manual"`    — user calls `.flush()` explicitly
	 * @default "batched"
	 */
	flushStrategy?: FlushStrategy;

	/**
	 * Enable dot-notation access for nested keys.
	 * e.g. `config.get("a.b.c")` traverses into `{ a: { b: { c: ... } } }`.
	 * @default true
	 */
	accessPropertiesByDotNotation?: boolean;

	/**
	 * Watch the SQLite database file for external changes and
	 * refresh the in-memory cache automatically.
	 * @default false
	 */
	watch?: boolean;

	/**
	 * Clear the store if the existing data fails validation or
	 * decryption, rather than throwing an error.
	 * @default false
	 */
	clearInvalidConfig?: boolean;
}
