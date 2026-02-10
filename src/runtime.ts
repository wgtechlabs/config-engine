/**
 * @module runtime
 * Runtime detection and SQLite adapter layer.
 * Uses `bun:sqlite` on Bun, `better-sqlite3` on Node.js.
 */

import type { DatabaseAdapter, StatementAdapter } from "./types.js";

/** Returns `true` when running under Bun. */
export function isBun(): boolean {
	return typeof globalThis.Bun !== "undefined";
}

/**
 * Open a SQLite database. Automatically selects the driver:
 * - Bun  → `bun:sqlite` (built-in, zero deps)
 * - Node → `better-sqlite3` (peer dependency)
 */
export function openDatabase(filepath: string): DatabaseAdapter {
	if (isBun()) {
		return openBunDatabase(filepath);
	}
	return openNodeDatabase(filepath);
}

// ---------------------------------------------------------------------------
// Bun adapter
// ---------------------------------------------------------------------------

function openBunDatabase(filepath: string): DatabaseAdapter {
	// Using dynamic import syntax to avoid static analysis issues on Node
	// biome-ignore lint/suspicious/noExplicitAny: bun:sqlite types vary
	const { Database } = require("bun:sqlite") as any;
	const db = new Database(filepath);

	// Enable WAL for concurrent read performance
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");

	return {
		prepare(sql: string): StatementAdapter {
			const stmt = db.prepare(sql);
			return {
				run(...params: unknown[]) {
					stmt.run(...params);
				},
				get(...params: unknown[]): unknown {
					return stmt.get(...params);
				},
				all(...params: unknown[]): unknown[] {
					return stmt.all(...params);
				},
			};
		},
		exec(sql: string) {
			db.exec(sql);
		},
		close() {
			db.close();
		},
		transaction<T>(fn: () => T): () => T {
			return db.transaction(fn);
		},
	};
}

// ---------------------------------------------------------------------------
// Node adapter (better-sqlite3)
// ---------------------------------------------------------------------------

function openNodeDatabase(filepath: string): DatabaseAdapter {
	// better-sqlite3 is a peer dep — error if missing
	let BetterSqlite3: typeof import("better-sqlite3");
	try {
		// biome-ignore lint/suspicious/noExplicitAny: dynamic require
		BetterSqlite3 = require("better-sqlite3") as any;
	} catch {
		throw new Error(
			'config-engine requires "better-sqlite3" as a peer dependency when running on Node.js. ' +
				"Install it with: npm install better-sqlite3",
		);
	}

	// biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 constructor
	const db = new (BetterSqlite3 as any)(filepath);

	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");

	return {
		prepare(sql: string): StatementAdapter {
			const stmt = db.prepare(sql);
			return {
				run(...params: unknown[]) {
					stmt.run(...params);
				},
				get(...params: unknown[]): unknown {
					return stmt.get(...params);
				},
				all(...params: unknown[]): unknown[] {
					return stmt.all(...params);
				},
			};
		},
		exec(sql: string) {
			db.exec(sql);
		},
		close() {
			db.close();
		},
		transaction<T>(fn: () => T): () => T {
			return db.transaction(fn) as () => T;
		},
	};
}
