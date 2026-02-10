# @wgtechlabs/config-engine

![GitHub Repo Banner](https://ghrb.waren.build/banner?header=config-engine+%F0%9F%8E%9B%EF%B8%8F%F0%9F%9A%82&subheader=configs+should+be+easy&bg=016EEA&color=FFFFFF&headerfont=Google+Sans+Code&subheaderfont=Inter&watermarkpos=bottom-right)
<!-- Created with GitHub Repo Banner by Waren Gonzaga: https://ghrb.waren.build -->

> Configs should be easy.

Fast, Bun-first configuration SDK for AI agent frameworks, CLI apps, and applications — backed by SQLite with in-memory caching, Zod validation, and optional encryption.

## Use Cases

- **AI agent frameworks** — persistent agent settings, model preferences, API key management, and runtime configuration
- **CLI applications** — user preferences, saved credentials, and tool configuration that persists across sessions
- **Desktop & server apps** — application settings with schema validation, safe migrations, and multi-process access

## Features

- **SQLite-backed** — ACID transactions, WAL mode, multi-process safe
- **In-memory cache** — zero disk I/O on reads, configurable write-behind flush
- **Zod validation** — built-in schema validation with pluggable validator interface
- **Dot-notation access** — `config.get("ui.sidebar.width")` just works
- **Async migrations** — version-based with full transaction rollback on failure
- **Optional encryption** — AES-256-GCM via [`@wgtechlabs/secrets-engine`](https://github.com/wgtechlabs/secrets-engine) or bring your own
- **Change events** — watch specific keys or the entire store
- **Bun-first, Node.js compatible** — uses `bun:sqlite` natively, `better-sqlite3` on Node.js

## Install

```bash
bun add @wgtechlabs/config-engine
```

For Node.js, also install the SQLite driver:

```bash
npm install @wgtechlabs/config-engine better-sqlite3
```

## Quick Start

```typescript
import { ConfigEngine } from "@wgtechlabs/config-engine";

const config = await ConfigEngine.open({
  projectName: "my-app",
  defaults: {
    theme: "dark",
    fontSize: 14,
    sidebar: { width: 300, visible: true },
  },
});

// Read (zero disk I/O — reads from in-memory cache)
config.get("theme");          // "dark"
config.get("sidebar.width");  // 300 (dot-notation)

// Write
config.set("fontSize", 16);
config.set({ theme: "light", fontSize: 12 });
config.set("sidebar.visible", false);

// Check & delete
config.has("theme");    // true
config.delete("theme");

// Iterate
for (const [key, value] of config) {
  console.log(key, value);
}

// Close when done
config.close();
```

## Validation with Zod

```typescript
import { ConfigEngine } from "@wgtechlabs/config-engine";
import { z } from "zod";

const config = await ConfigEngine.open({
  projectName: "my-app",
  defaults: { theme: "dark", fontSize: 14 },
  schema: z.object({
    theme: z.enum(["light", "dark"]),
    fontSize: z.number().min(8).max(72),
  }),
});

config.set("fontSize", 16);  // OK
config.set("fontSize", 200); // Throws ValidationError
```

### Custom Validator (Pluggable)

Bring your own validation library (Valibot, AJV, etc.):

```typescript
import { ConfigEngine, type Validator } from "@wgtechlabs/config-engine";

const myValidator: Validator<MyConfig> = {
  validate(data) {
    // Your validation logic
    if (isValid(data)) {
      return { success: true, data: data as MyConfig };
    }
    return { success: false, errors: ["Validation failed"] };
  },
};

const config = await ConfigEngine.open({
  projectName: "my-app",
  validator: myValidator,
});
```

## Migrations

Robust, async-capable migration system with full SQLite transaction rollback:

```typescript
const config = await ConfigEngine.open({
  projectName: "my-app",
  projectVersion: "3.0.0",
  migrations: [
    {
      version: "2.0.0",
      up(ctx) {
        // Rename a key
        const old = ctx.get("oldSetting");
        if (old !== undefined) {
          ctx.set("newSetting", old);
          ctx.delete("oldSetting");
        }
      },
    },
    {
      version: "3.0.0",
      async up(ctx) {
        // Async migrations supported natively
        const data = ctx.get<string>("rawData");
        if (data) {
          ctx.set("processedData", data.toUpperCase());
          ctx.delete("rawData");
        }
      },
    },
  ],
  beforeEachMigration({ fromVersion, toVersion }) {
    console.log(`Migrating ${fromVersion} → ${toVersion}`);
  },
});
```

If any migration throws, **all changes are rolled back** automatically.

## Encryption

Optional encryption using [`@wgtechlabs/secrets-engine`](https://github.com/wgtechlabs/secrets-engine) for machine-bound key management:

```bash
bun add @wgtechlabs/secrets-engine
```

```typescript
const config = await ConfigEngine.open({
  projectName: "my-app",
  encryptionKey: "my-app.config.key", // Key name in secrets-engine
});

// All values are AES-256-GCM encrypted at rest
config.set("apiToken", "sk-secret-value");
```

Or bring your own encryptor:

```typescript
import { ConfigEngine, type Encryptor } from "@wgtechlabs/config-engine";

const myEncryptor: Encryptor = {
  async encrypt(plaintext) { /* ... */ },
  async decrypt(ciphertext) { /* ... */ },
};

const config = await ConfigEngine.open({
  projectName: "my-app",
  encryptionKey: myEncryptor,
});
```

## Change Events

```typescript
// Watch a specific key
const unsubscribe = config.onDidChange("theme", (newValue, oldValue) => {
  console.log(`Theme changed: ${oldValue} → ${newValue}`);
});

// Watch any change
config.onDidAnyChange((newStore, oldStore) => {
  console.log("Config updated");
});

// Stop watching
unsubscribe();
```

## Flush Strategies

Control when writes hit disk:

```typescript
// Immediate — sync write on every .set() (safest)
const config = await ConfigEngine.open({
  projectName: "my-app",
  flushStrategy: "immediate",
});

// Batched — debounced microtask flush (default, best perf)
const config = await ConfigEngine.open({
  projectName: "my-app",
  flushStrategy: "batched",
});

// Manual — you control when to flush
const config = await ConfigEngine.open({
  projectName: "my-app",
  flushStrategy: "manual",
});
config.set("key", "value");
await config.flush(); // Explicit flush
```

## Where Config is Stored

SQLite database files are stored in platform-appropriate directories:

| OS | Default Path |
|---|---|
| macOS | `~/Library/Preferences/<projectName>/config.db` |
| Windows | `%APPDATA%/<projectName>/config.db` |
| Linux | `~/.config/<projectName>/config.db` |

Override with `cwd`:

```typescript
const config = await ConfigEngine.open({
  projectName: "my-app",
  cwd: "/custom/path",  // → /custom/path/config.db
});
```

## API Reference

### `ConfigEngine.open(options)`

Async factory method. Returns `Promise<ConfigEngine<T>>`.

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `projectName` | `string` | **required** | App identifier for path resolution |
| `projectVersion` | `string` | — | Required when `migrations` is set |
| `cwd` | `string` | OS config dir | Override config directory |
| `configName` | `string` | `"config"` | Database file name (without `.db`) |
| `defaults` | `Partial<T>` | — | Default values, merged on first open |
| `schema` | `ZodSchema<T>` | — | Zod schema for validation |
| `validator` | `Validator<T>` | — | Custom validator (overrides `schema`) |
| `encryptionKey` | `string \| Encryptor` | — | Encryption key name or custom encryptor |
| `migrations` | `MigrationDefinition[]` | — | Ordered migration definitions |
| `beforeEachMigration` | `Function` | — | Hook before each migration |
| `afterEachMigration` | `Function` | — | Hook after each migration |
| `flushStrategy` | `FlushStrategy` | `"batched"` | Write-behind strategy |
| `accessPropertiesByDotNotation` | `boolean` | `true` | Enable dot-notation access |
| `watch` | `boolean` | `false` | Watch for external changes |
| `clearInvalidConfig` | `boolean` | `false` | Clear store on validation/decrypt failure |

### Instance Methods

| Method | Description |
|---|---|
| `.get(key, defaultValue?)` | Get a value (dot-notation supported) |
| `.set(key, value)` | Set a single value |
| `.set(object)` | Set multiple values |
| `.has(key)` | Check if a key exists |
| `.delete(key)` | Remove a key |
| `.clear()` | Clear all values, restore defaults |
| `.reset(...keys)` | Reset specific keys to defaults |
| `.onDidChange(key, cb)` | Watch a key, returns unsubscribe |
| `.onDidAnyChange(cb)` | Watch all changes, returns unsubscribe |
| `.flush()` | Flush pending writes (async) |
| `.flushSync()` | Flush pending writes (sync) |
| `.close()` | Close the engine |

### Instance Properties

| Property | Type | Description |
|---|---|---|
| `.store` | `T` | Get/set the entire config object |
| `.size` | `number` | Number of top-level entries |
| `.path` | `string` | Absolute path to the database file |

## License

MIT © [WGTech Labs](https://github.com/wgtechlabs)
