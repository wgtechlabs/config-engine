/**
 * @module migrations
 * Version-based migration system with SQLite transaction rollback.
 */

import type { ConfigStore } from "./store.js";
import type { MigrationContext, MigrationDefinition, MigrationHookContext } from "./types.js";

const META_KEY = "schema_version";
const INITIAL_VERSION = "0.0.0";

/**
 * Run pending migrations against the store. Executes in a SQLite
 * transaction — if any migration throws, ALL changes are rolled back.
 */
export async function runMigrations(options: {
	store: ConfigStore;
	migrations: MigrationDefinition[];
	projectVersion: string;
	beforeEachMigration?: (ctx: MigrationHookContext) => void | Promise<void>;
	afterEachMigration?: (ctx: MigrationHookContext) => void | Promise<void>;
}): Promise<void> {
	const { store, migrations, projectVersion, beforeEachMigration, afterEachMigration } = options;

	if (migrations.length === 0) return;

	const currentVersion = store.getMeta(META_KEY) ?? INITIAL_VERSION;
	const versions = migrations.map((m) => m.version);
	const finalVersion = projectVersion;

	// Filter migrations that need to run (versions > currentVersion)
	const pending = migrations.filter((m) => compareVersions(m.version, currentVersion) > 0);

	if (pending.length === 0) {
		// Ensure version is up to date even if no migrations ran
		store.setMeta(META_KEY, projectVersion);
		return;
	}

	// Sort by version ascending
	pending.sort((a, b) => compareVersions(a.version, b.version));

	// Create a migration context that operates directly on the store
	const ctx = createMigrationContext(store);

	// Execute migrations — some may be async, so we can't use
	// a SQLite transaction wrapper for the whole batch. Instead,
	// we snapshot before and restore on failure.
	const snapshot = store.getAll();
	const snapshotVersion = currentVersion;

	try {
		for (const migration of pending) {
			const hookCtx: MigrationHookContext = {
				fromVersion: currentVersion,
				toVersion: migration.version,
				finalVersion,
				versions,
			};

			if (beforeEachMigration) {
				await beforeEachMigration(hookCtx);
			}

			await migration.up(ctx);

			if (afterEachMigration) {
				await afterEachMigration(hookCtx);
			}
		}

		// All migrations succeeded — update schema version
		store.setMeta(META_KEY, projectVersion);
		store.touchLastWrite();
	} catch (error) {
		// Rollback: restore the snapshot
		store.transaction(() => {
			store.deleteAll();
			const entries = Object.entries(snapshot);
			if (entries.length > 0) {
				store.setMany(entries);
			}
			store.setMeta(META_KEY, snapshotVersion);
		});

		throw new Error(
			`Migration to version "${pending.find(() => true)?.version}" failed. ` +
				`All changes have been rolled back. Original error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Create a MigrationContext that reads/writes directly to the store,
 * bypassing validation and caching.
 */
function createMigrationContext(store: ConfigStore): MigrationContext {
	return {
		get<V = unknown>(key: string): V | undefined {
			return store.getOne(key) as V | undefined;
		},
		set(key: string, value: unknown): void {
			store.setOne(key, value);
		},
		has(key: string): boolean {
			return store.has(key);
		},
		delete(key: string): boolean {
			return store.deleteOne(key);
		},
	};
}

/**
 * Simple semver comparison. Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
function compareVersions(a: string, b: string): number {
	const partsA = a.split(".").map(Number);
	const partsB = b.split(".").map(Number);

	for (let i = 0; i < 3; i++) {
		const va = partsA[i] ?? 0;
		const vb = partsB[i] ?? 0;
		if (va !== vb) return va - vb;
	}
	return 0;
}

/**
 * Get the current schema version from the store.
 */
export function getSchemaVersion(store: ConfigStore): string {
	return store.getMeta(META_KEY) ?? INITIAL_VERSION;
}
