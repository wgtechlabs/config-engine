/**
 * Type declarations for optional peer dependencies.
 */

declare module "@wgtechlabs/secrets-engine" {
	export class SecretsEngine {
		static open(options?: {
			path?: string;
			location?: "home" | "xdg";
		}): Promise<SecretsEngine>;
		get(key: string): Promise<string | null>;
		getOrThrow(key: string): Promise<string>;
		set(key: string, value: string): Promise<void>;
		has(key: string): Promise<boolean>;
		delete(key: string): Promise<boolean>;
		keys(pattern?: string): Promise<string[]>;
		close(): void;
		destroy(): Promise<void>;
		get size(): number;
		get storagePath(): string;
	}
}

declare module "better-sqlite3" {
	// Minimal type stub — full types available via @types/better-sqlite3
	const Database: unknown;
	export = Database;
}
