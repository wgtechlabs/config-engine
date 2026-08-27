/**
 * @module runtime
 * SQLite adapter layer using `better-sqlite3`.
 * Bun is supported as a toolchain (build/test) but Node.js is the target runtime.
 */

import { createRequire } from "node:module";
import type { DatabaseAdapter, StatementAdapter } from "./types.js";

const runtimeRequire = createRequire(import.meta.url);

/**
 * Open a SQLite database using `better-sqlite3`.
 * Requires `better-sqlite3` as a peer dependency.
 */
export function openDatabase(filepath: string): DatabaseAdapter {
	let BetterSqlite3: typeof import("better-sqlite3");
	try {
		// biome-ignore lint/suspicious/noExplicitAny: runtime require for ESM output
		BetterSqlite3 = runtimeRequire("better-sqlite3") as any;
	} catch {
		throw new Error(
			'config-engine requires "better-sqlite3" as a peer dependency. ' +
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
