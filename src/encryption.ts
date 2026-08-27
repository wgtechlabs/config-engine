/**
 * @module encryption
 * Optional encryption integration via `@wgtechlabs/secrets-engine`.
 * Also supports custom `Encryptor` implementations.
 */

import type { Encryptor } from "./types.js";

/**
 * Encryption adapter that uses `@wgtechlabs/secrets-engine`.
 *
 * The encryption key is stored securely in secrets-engine (machine-bound,
 * AES-256-GCM). This adapter retrieves the key on init and uses it to
 * encrypt/decrypt config values via Node's `crypto` module.
 */
export class SecretsEngineEncryptor implements Encryptor {
	#keyName: string;
	#derivedKey: CryptoKey | null = null;
	// biome-ignore lint/suspicious/noExplicitAny: secrets-engine instance
	#secrets: any = null;

	constructor(keyName: string) {
		this.#keyName = keyName;
	}

	/** Initialize the encryptor — must be called before encrypt/decrypt. */
	async init(): Promise<void> {
		let SecretsEngine: { open: () => Promise<unknown> };
		try {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic import
			const mod = (await import("@wgtechlabs/secrets-engine")) as any;
			SecretsEngine = mod.SecretsEngine ?? mod.default?.SecretsEngine ?? mod;
		} catch {
			throw new Error(
				'Encryption requires "@wgtechlabs/secrets-engine" as a peer dependency. ' +
					"Install it with: npm install @wgtechlabs/secrets-engine",
			);
		}

		this.#secrets = await SecretsEngine.open();

		// Ensure the encryption key exists in secrets-engine
		const hasKey = await this.#secrets.has(this.#keyName);
		if (!hasKey) {
			// Generate a random 256-bit key and store it
			const keyBytes = crypto.getRandomValues(new Uint8Array(32));
			const keyHex = Array.from(keyBytes)
				.map((b: number) => b.toString(16).padStart(2, "0"))
				.join("");
			await this.#secrets.set(this.#keyName, keyHex);
		}

		// Import the key for Web Crypto API usage
		const keyHex = await this.#secrets.get(this.#keyName);
		const keyBuffer = hexToUint8Array(keyHex as string);
		this.#derivedKey = await crypto.subtle.importKey(
			"raw",
			keyBuffer.buffer as ArrayBuffer,
			{ name: "AES-GCM" },
			false,
			["encrypt", "decrypt"],
		);
	}

	async encrypt(plaintext: string): Promise<string> {
		if (!this.#derivedKey) throw new Error("Encryptor not initialized. Call init() first.");

		const iv = crypto.getRandomValues(new Uint8Array(12));
		const encoded = new TextEncoder().encode(plaintext);
		const cipherBuffer = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
			this.#derivedKey,
			encoded,
		);

		// Format: base64(iv):base64(ciphertext)
		const ivB64 = uint8ArrayToBase64(iv);
		const cipherB64 = uint8ArrayToBase64(new Uint8Array(cipherBuffer));
		return `${ivB64}:${cipherB64}`;
	}

	async decrypt(ciphertext: string): Promise<string> {
		if (!this.#derivedKey) throw new Error("Encryptor not initialized. Call init() first.");

		const [ivB64, cipherB64] = ciphertext.split(":");
		if (!ivB64 || !cipherB64) throw new Error("Invalid encrypted data format.");

		const iv = base64ToUint8Array(ivB64);
		const cipherBuffer = base64ToUint8Array(cipherB64);

		const plainBuffer = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
			this.#derivedKey,
			cipherBuffer.buffer as ArrayBuffer,
		);

		return new TextDecoder().decode(plainBuffer);
	}

	/** Close the underlying secrets-engine instance. */
	async close(): Promise<void> {
		if (this.#secrets) {
			this.#secrets.close();
			this.#secrets = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToUint8Array(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}
	// Fallback for non-Node environments
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		return new Uint8Array(Buffer.from(b64, "base64"));
	}
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Resolve the encryptor from options.
 * - If a string key name is provided, create a `SecretsEngineEncryptor`.
 * - If an `Encryptor` object is provided, use it directly.
 * - If undefined, return undefined (no encryption).
 */
export async function resolveEncryptor(
	encryptionKey?: string | Encryptor,
): Promise<Encryptor | undefined> {
	if (!encryptionKey) return undefined;

	if (typeof encryptionKey === "string") {
		const enc = new SecretsEngineEncryptor(encryptionKey);
		await enc.init();
		return enc;
	}

	// Custom Encryptor instance
	return encryptionKey;
}
