/**
 * @module store
 * Low-level SQLite abstraction for config persistence.
 * All values are stored as JSON-stringified text.
 */

import type { DatabaseAdapter } from "./types.js";

/** Row shape for the `config` table. */
interface ConfigRow {
	key: string;
	value: string;
}

/**
 * Direct SQLite store — thin wrapper around the database adapter.
 * This layer does NOT cache or validate; that's handled by higher layers.
 */
export class ConfigStore {
	readonly #db: DatabaseAdapter;

	constructor(db: DatabaseAdapter) {
		this.#db = db;
		this.#initialize();
	}

	/** Create tables if they don't exist. */
	#initialize(): void {
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS config (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`);
		this.#db.exec(`
			CREATE TABLE IF NOT EXISTS _meta (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`);
	}

	// -----------------------------------------------------------------------
	// Config CRUD
	// -----------------------------------------------------------------------

	/** Get all config entries as a flat `Record<string, unknown>`. */
	getAll(): Record<string, unknown> {
		const rows = this.#db.prepare("SELECT key, value FROM config").all() as ConfigRow[];
		const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const row of rows) {
			result[row.key] = JSON.parse(row.value);
		}
		return result;
	}

	/** Get a single value by key. Returns `undefined` if not found. */
	getOne(key: string): unknown {
		const row = this.#db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
			| ConfigRow
			| undefined;
		return row ? JSON.parse(row.value) : undefined;
	}

	/** Insert or replace a single key/value. */
	setOne(key: string, value: unknown): void {
		this.#db
			.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
			.run(key, JSON.stringify(value));
	}

	/**
	 * Set multiple entries atomically within a transaction.
	 * Significantly faster than individual `setOne` calls.
	 */
	setMany(entries: Array<[string, unknown]>): void {
		const stmt = this.#db.prepare(
			"INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
		);
		const runTransaction = this.#db.transaction(() => {
			for (const [key, value] of entries) {
				stmt.run(key, JSON.stringify(value));
			}
		});
		runTransaction();
	}

	/** Delete a single key. Returns `true` if the key existed. */
	deleteOne(key: string): boolean {
		const before = this.count();
		this.#db.prepare("DELETE FROM config WHERE key = ?").run(key);
		return this.count() < before;
	}

	/** Delete all config entries. */
	deleteAll(): void {
		this.#db.exec("DELETE FROM config;");
	}

	/** Check if a key exists. */
	has(key: string): boolean {
		const row = this.#db
			.prepare("SELECT 1 FROM config WHERE key = ? LIMIT 1")
			.get(key);
		return row !== undefined && row !== null;
	}

	/** Number of config entries. */
	count(): number {
		const row = this.#db.prepare("SELECT COUNT(*) as cnt FROM config").get() as {
			cnt: number;
		};
		return row.cnt;
	}

	// -----------------------------------------------------------------------
	// Meta CRUD (internal state: migration version, timestamps, etc.)
	// -----------------------------------------------------------------------

	getMeta(key: string): string | undefined {
		const row = this.#db
			.prepare("SELECT value FROM _meta WHERE key = ?")
			.get(key) as ConfigRow | undefined;
		return row?.value;
	}

	setMeta(key: string, value: string): void {
		this.#db
			.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)")
			.run(key, value);
	}

	hasMeta(key: string): boolean {
		const row = this.#db
			.prepare("SELECT 1 FROM _meta WHERE key = ? LIMIT 1")
			.get(key);
		return row !== undefined && row !== null;
	}

	// -----------------------------------------------------------------------
	// Transaction helper
	// -----------------------------------------------------------------------

	/**
	 * Execute `fn` inside a SQLite transaction.
	 * If `fn` throws, the transaction is rolled back automatically.
	 */
	transaction<T>(fn: () => T): T {
		const wrapped = this.#db.transaction(fn);
		return wrapped();
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/** Update the `last_write` meta timestamp. Called after any mutation. */
	touchLastWrite(): void {
		this.setMeta("last_write", Date.now().toString());
	}

	/** Get the last write timestamp (ms since epoch), or 0 if never written. */
	getLastWrite(): number {
		const val = this.getMeta("last_write");
		return val ? Number(val) : 0;
	}

	/** Close the underlying database connection. */
	close(): void {
		this.#db.close();
	}
}
