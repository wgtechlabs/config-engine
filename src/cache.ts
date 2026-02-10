/**
 * @module cache
 * In-memory cache with configurable write-behind strategy.
 * All `.get()` calls hit the Map (zero disk I/O). Writes are
 * flushed to the SQLite store based on the configured strategy.
 */

import type { ConfigStore } from "./store.js";
import type { FlushStrategy } from "./types.js";

export class ConfigCache<T extends Record<string, unknown>> {
	readonly #store: ConfigStore;
	readonly #strategy: FlushStrategy;
	readonly #data: Map<string, unknown> = new Map();
	readonly #dirty: Set<string> = new Set();
	readonly #deleted: Set<string> = new Set();
	#flushScheduled = false;
	#flushPromise: Promise<void> | null = null;

	constructor(store: ConfigStore, strategy: FlushStrategy = "batched") {
		this.#store = store;
		this.#strategy = strategy;
	}

	/** Load all data from the store into memory. */
	load(initial?: Record<string, unknown>): void {
		this.#data.clear();
		this.#dirty.clear();
		this.#deleted.clear();

		const stored = initial ?? this.#store.getAll();
		for (const [key, value] of Object.entries(stored)) {
			this.#data.set(key, value);
		}
	}

	// -----------------------------------------------------------------------
	// Read operations (zero I/O)
	// -----------------------------------------------------------------------

	get(key: string): unknown {
		return this.#data.get(key);
	}

	has(key: string): boolean {
		return this.#data.has(key);
	}

	get size(): number {
		return this.#data.size;
	}

	/** Return a shallow copy of the entire store as a plain object. */
	getAll(): T {
		const obj = Object.create(null) as Record<string, unknown>;
		for (const [key, value] of this.#data) {
			obj[key] = value;
		}
		return obj as T;
	}

	entries(): IterableIterator<[string, unknown]> {
		return this.#data.entries();
	}

	// -----------------------------------------------------------------------
	// Write operations
	// -----------------------------------------------------------------------

	set(key: string, value: unknown): void {
		this.#data.set(key, value);
		this.#dirty.add(key);
		this.#deleted.delete(key);
		this.#scheduleFlush();
	}

	setMany(entries: Array<[string, unknown]>): void {
		for (const [key, value] of entries) {
			this.#data.set(key, value);
			this.#dirty.add(key);
			this.#deleted.delete(key);
		}
		this.#scheduleFlush();
	}

	delete(key: string): boolean {
		const existed = this.#data.delete(key);
		if (existed) {
			this.#dirty.delete(key);
			this.#deleted.add(key);
			this.#scheduleFlush();
		}
		return existed;
	}

	clear(): void {
		// Mark all current keys for deletion
		for (const key of this.#data.keys()) {
			this.#deleted.add(key);
		}
		this.#data.clear();
		this.#dirty.clear();
		this.#scheduleFlush();
	}

	/** Replace the entire in-memory store and schedule a full flush. */
	replaceAll(data: T): void {
		// Mark old keys for deletion
		for (const key of this.#data.keys()) {
			if (!(key in data)) {
				this.#deleted.add(key);
			}
		}
		this.#data.clear();
		this.#dirty.clear();

		for (const [key, value] of Object.entries(data)) {
			this.#data.set(key, value);
			this.#dirty.add(key);
			this.#deleted.delete(key);
		}
		this.#scheduleFlush();
	}

	// -----------------------------------------------------------------------
	// Flush
	// -----------------------------------------------------------------------

	#scheduleFlush(): void {
		if (this.#strategy === "manual") return;

		if (this.#strategy === "immediate") {
			this.flushSync();
			return;
		}

		// "batched" — schedule a microtask flush
		if (!this.#flushScheduled) {
			this.#flushScheduled = true;
			this.#flushPromise = Promise.resolve().then(() => {
				this.flushSync();
				this.#flushScheduled = false;
				this.#flushPromise = null;
			});
		}
	}

	/** Synchronously flush all pending changes to SQLite. */
	flushSync(): void {
		if (this.#dirty.size === 0 && this.#deleted.size === 0) return;

		this.#store.transaction(() => {
			// Persist dirty entries
			if (this.#dirty.size > 0) {
				const entries: Array<[string, unknown]> = [];
				for (const key of this.#dirty) {
					entries.push([key, this.#data.get(key)]);
				}
				this.#store.setMany(entries);
			}

			// Delete removed entries
			for (const key of this.#deleted) {
				this.#store.deleteOne(key);
			}

			this.#store.touchLastWrite();
		});

		this.#dirty.clear();
		this.#deleted.clear();
	}

	/**
	 * Wait for any pending batched flush to complete.
	 * Returns immediately if no flush is pending.
	 */
	async flush(): Promise<void> {
		if (this.#flushPromise) {
			await this.#flushPromise;
		} else if (this.#dirty.size > 0 || this.#deleted.size > 0) {
			this.flushSync();
		}
	}

	/** Reload from disk, discarding uncommitted changes. */
	reload(): void {
		this.#dirty.clear();
		this.#deleted.clear();
		this.load();
	}
}
