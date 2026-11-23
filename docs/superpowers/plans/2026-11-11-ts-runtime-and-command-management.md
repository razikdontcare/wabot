# Direct TypeScript Runtime + Web Command Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the bot as TypeScript in production/Docker with no `tsc` build, and let an admin create, edit, disable, reset and delete commands from the existing web admin console without rebuilding the image.

**Architecture:** The production image runs `bun src/index.ts` (Bun strips types at load time). Command discovery becomes runtime-agnostic and all `dist/` assumptions are removed. A Mongo-backed `CommandRegistryService` merges the 25 compiled-in command classes with admin overrides and data-only custom commands; `CommandHandler` and the Hono API share one registry instance, so web edits apply to the running bot. The admin console gets a new "Commands" section implemented in the same inline body/styles/script pattern the console already uses.

**Tech Stack:** Bun 1.3.14 (dev, test, production), TypeScript 5.6 (typecheck only, `noEmit`), Hono 4, MongoDB 6, Zod 4, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-11-ts-runtime-and-command-management-design.md`

## Global Constraints

- Pin Bun `1.3.14` everywhere (Docker base image, CI, docs).
- No compile step and no `dist/` in the runtime image. `tsc` is only used as `tsc --noEmit` for typechecking.
- Keep the repository's existing conventions: relative imports with `.js` extensions, PascalCase files, `Logger` via `log` from `src/infrastructure/config/config.ts`, Mongo collection getters that call `getActiveMongoClient()` lazily.
- No new `any`. New code is `strict`-clean.
- All new HTTP routes live under `/api/*` and are covered by the existing Basic Auth middleware in `src/api.ts`.
- Never execute code supplied by the web UI. Custom commands are data (text templates), not modules.
- Custom command response text is 1–4096 characters (WhatsApp message cap used by this codebase).
- Preserve current behavior for every existing command, config key, API route and Mongo document.
- No DB migration; new collection `bot_commands` starts empty.
- Tests: `bun test` (suite baseline is 59 pass / 1 pre-existing failure in `tests/rpgEngine.test.ts` — "awards party combat rewards to every active member"; do not treat it as a regression).
- Typecheck: `bun run typecheck`.
- Verification environment note: this workstation has no Docker CLI, and the DSH sandbox denies Bun's file reads unless the command runs with escalated access; Docker steps must be run on a Docker-capable host/CI. That is an environment fact, not a plan step.

## Review Focus

Five inputs/conditions the spec implies but no single task's happy path exercises. Each gets a test in the task that owns the code:

1. **Name/alias collisions** — admin tries to create or alias a command to a built-in name/alias, core command (`help`, `games`, `stop`, `stats`) or reserved spelling; the save must fail with `409`, not silently shadow the built-in.
2. **Mongo unavailable** — at boot and during an admin save. Built-in commands must keep working; writes must return `503`; nothing may crash or spin.
3. **Malformed custom command** — unknown template placeholder, empty/oversized response, invalid name/category; save is rejected with field-level `400` and the bad command never runs in chat.
4. **Disabled command dispatch** — a disabled custom or built-in command invoked from chat and from the AI tool returns a deterministic "disabled" result without executing, and the listing reflects the disabled state.
5. **Docker image correctness without `dist/`** — command discovery, prompt `.md` files, worker TS modules, `cookies.txt` and yt-dlp paths resolve in the container; `/api/status` answers and logs show commands registered.

---

## File Structure

| Area | File | Responsibility |
| --- | --- | --- |
| Runtime | `src/shared/utils/commandLoader.ts` (new) | Discover and import built-in command files in `.ts` or `.js`, runtime-agnostic. |
| Runtime | `src/shared/utils/sourcePaths.ts` (new) | Resolve worker-only source module paths (`src/...`), replacing `dist/...` branches. |
| Runtime | `src/app/handlers/CommandHandler.ts` (modify) | Use loader + registry; create `DynamicCommand` instances. |
| Runtime | `src/shared/utils/WorkerPool.ts`, `src/app/commands/StickerCommand.ts`, `src/app/commands/VideoToAudioCommand.ts` (modify) | Use `sourcePaths` instead of `dist`. |
| Packaging | `package.json`, `tsconfig.json`, `Dockerfile`, `.dockerignore` (modify) | Direct TS run, no emit, Bun runtime image. |
| Commands domain | `src/domain/models/CommandDefinition.ts` (new) | Types, Zod schemas, constants for stored commands. |
| Commands domain | `src/shared/utils/commandTemplates.ts` (new) | Render and validate `{{placeholder}}` templates. |
| Commands domain | `src/domain/services/CommandStore.ts` (new) | Store interface (fakeable in tests). |
| Commands domain | `src/infrastructure/config/mongoCommandStore.ts` (new) | Mongo implementation of `CommandStore`. |
| Commands domain | `src/domain/services/CommandRegistryService.ts` (new) | Merge built-ins + overrides + customs, validation, cache, CRUD. |
| Commands domain | `src/infrastructure/config/commandRegistry.ts` (new) | Singleton accessor shared by bot and API. |
| Commands domain | `src/app/handlers/DynamicCommand.ts` (new) | `CommandInterface` implementation for a stored custom command. |
| API | `src/infrastructure/web/commandRoutes.ts` (new) | Hono routes for command CRUD. |
| API | `src/api.ts` (modify) | Register routes and serve the commands console script. |
| Console | `src/infrastructure/web/adminConsoleCommandsBody.ts` (new) | Commands section markup. |
| Console | `src/infrastructure/web/adminConsoleCommandsStyles.ts` (new) | Commands section CSS. |
| Console | `src/infrastructure/web/adminConsoleCommandsScript.ts` (new) | Commands section client logic (self-contained IIFE). |
| Console | `adminConsoleBody.ts`, `adminConsoleStyles.ts`, `adminConsolePage.ts`, `adminConsoleScript.ts` (modify) | Compose the new section/script and broadcast refresh. |
| Docs | `docs/COMMANDS.md` (new), `SYSTEM_MAP.md` (modify) | Admin guide and system map updates. |
| Tests | `tests/commandLoader.test.ts`, `tests/sourcePaths.test.ts`, `tests/commandTemplates.test.ts`, `tests/commandDefinition.test.ts`, `tests/commandRegistry.test.ts`, `tests/dynamicCommand.test.ts`, `tests/commandHandlerDynamic.test.ts`, `tests/commandRoutes.test.ts`, `tests/adminConsole.test.ts` (new) | TDD coverage per task. |

---

### Task 1: Runtime-agnostic built-in command loader

Extract command discovery out of `CommandHandler` and drop the `NODE_ENV` extension guess. This is the prerequisite for running `.ts` files in production.

**Files:**
- Create: `src/shared/utils/commandLoader.ts`
- Create: `tests/commandLoader.test.ts`
- Modify: `src/app/handlers/CommandHandler.ts:22-27,52-99,473-476`

**Interfaces:**
- Consumes: `CommandInfo` from `src/app/handlers/CommandInterface.ts`.
- Produces:
  - `selectCommandFiles(commandsDir: string): string[]` — sorted file names ending `.ts`/`.js`, excluding `.d.ts`; regular files only.
  - `loadBuiltinCommands(commandsDir?: string): Promise<CommandInfo[]>` — default dir is `src/app/commands` resolved from `import.meta.url`; dedupes by `name` (first wins, `log.warn` on duplicate); skips invalid exports with `log.warn`; throws only when the directory itself is unreadable.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commandLoader.test.ts
import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  loadBuiltinCommands,
  selectCommandFiles,
} from "../src/shared/utils/commandLoader.js";

const COMMANDS_DIR = fileURLToPath(new URL("../src/app/commands", import.meta.url));

describe("selectCommandFiles", () => {
  it("keeps TypeScript command files and skips declarations and subdirectories", () => {
    const files = selectCommandFiles(COMMANDS_DIR);

    expect(files).toContain("SearchCommand.ts");
    expect(files.every((file) => file.endsWith(".ts") || file.endsWith(".js"))).toBe(true);
    expect(files.some((file) => file.endsWith(".d.ts"))).toBe(false);
    expect(files).not.toContain("prompts");
  });
});

describe("loadBuiltinCommands", () => {
  it("loads every command class exactly once", async () => {
    const commands = await loadBuiltinCommands();

    expect(commands.length).toBeGreaterThanOrEqual(25);
    expect(commands.map((command) => command.name)).toContain("search");
    expect(new Set(commands.map((command) => command.name)).size).toBe(commands.length);
    expect(commands.every((command) => typeof command.commandClass === "function")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commandLoader.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/utils/commandLoader.js'`.

- [ ] **Step 3: Implement `src/shared/utils/commandLoader.ts`**

Use `readdirSync(dir, { withFileTypes: true })`, filter `entry.isFile()`, keep `/\.(ts|js)$/` minus `/\.d\.ts$/`, sort by name. Import each file with `pathToFileURL(join(commandsDir, file)).href` and accept `module.default ?? Object.values(module)[0]` only when it has `commandInfo`. Default directory:

```ts
const DEFAULT_COMMANDS_DIR = fileURLToPath(new URL("../../app/commands/", import.meta.url));
```

- [ ] **Step 4: Replace `CommandHandler.registerCommands` with the loader**

Delete the `fs`/`path`/`fileURLToPath` block and the `isDev`/`fileExtension` logic. In `initialize()` call `await loadBuiltinCommands()` and register results with the existing `registerCommand` (this method stays until Task 7). Log `Successfully registered N commands`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/commandLoader.test.ts`
Expected: PASS, 25+ commands loaded.

- [ ] **Step 6: Typecheck and commit**

Run: `bun run typecheck` (expected PASS).
```bash
git add src/shared/utils/commandLoader.ts tests/commandLoader.test.ts src/app/handlers/CommandHandler.ts
git commit -m "refactor(commands): load built-in commands by runtime-agnostic file discovery"
```

---

### Task 2: Point worker-only modules at TypeScript sources

Remove the three remaining `dist/...` production branches so worker tasks keep working when the image contains only `src/`.

**Files:**
- Create: `src/shared/utils/sourcePaths.ts`
- Create: `tests/sourcePaths.test.ts`
- Modify: `src/shared/utils/WorkerPool.ts:30-38`
- Modify: `src/app/commands/StickerCommand.ts:570-578`
- Modify: `src/app/commands/VideoToAudioCommand.ts:118-130`

**Interfaces:**
- Produces:
  - `resolveSourceModule(...segments: string[]): string` — returns `join(process.cwd(), "src", ...segments)`.
  - `resolveWorkerScriptPath(): string` — `resolveSourceModule("shared","utils","worker.ts")`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sourcePaths.test.ts
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSourceModule,
  resolveWorkerScriptPath,
} from "../src/shared/utils/sourcePaths.js";

describe("sourcePaths", () => {
  it("resolves worker-only modules inside src, not dist", () => {
    const worker = resolveWorkerScriptPath();

    expect(worker).toBe(join(process.cwd(), "src", "shared", "utils", "worker.ts"));
    expect(existsSync(worker)).toBe(true);
  });

  it("resolves every worker module referenced by commands", () => {
    const modules = [
      resolveSourceModule("shared", "utils", "stickerProcessor.ts"),
      resolveSourceModule("shared", "utils", "ffmpeg.ts"),
    ];

    modules.forEach((modulePath) => {
      expect(modulePath.endsWith(".ts")).toBe(true);
      expect(existsSync(modulePath)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sourcePaths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sourcePaths.ts` and use it**

Replace the `dist`/`src` branches with the helper: `WorkerPool` constructor sets `this.workerPath = resolveWorkerScriptPath()`; `StickerCommand.getProcessorPath()` returns `resolveSourceModule("shared","utils","stickerProcessor.ts")`; `VideoToAudioCommand.ffmpegPath()` returns `resolveSourceModule("shared","utils","ffmpeg.ts")`. Remove now-unused `join` imports only if they become unused.

- [ ] **Step 4: Run the new test and the existing worker test**

Run: `bun test tests/sourcePaths.test.ts tests/WorkerPool.test.ts`
Expected: PASS both (the worker test already proved Bun runs `.ts` workers).

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils/sourcePaths.ts tests/sourcePaths.test.ts src/shared/utils/WorkerPool.ts src/app/commands/StickerCommand.ts src/app/commands/VideoToAudioCommand.ts
git commit -m "refactor(runtime): resolve worker modules from src instead of dist"
```

---

### Task 3: Package scripts and TypeScript config for direct execution

Stop emitting JavaScript and make the normal commands say what the project actually does.

**Files:**
- Modify: `package.json:5-14`
- Modify: `tsconfig.json:20-27`
- Modify: `.github/workflows/release.yml:41-42`

- [ ] **Step 1: Update `package.json` scripts**

```json
"scripts": {
  "dev": "bun --hot src/index.ts",
  "start": "bun src/index.ts",
  "typecheck": "tsc --noEmit",
  "test": "bun test",
  "test:migration:askai": "bun run test-askai-migration.ts",
  "test:nexa:providers": "bun run test-nexa-providers.ts",
  "lint": "eslint src/**/*.ts",
  "lint:fix": "eslint src/**/*.ts --fix",
  "format": "prettier --write src/**/*.ts"
}
```

Remove `"build": "tsc -p tsconfig.json"` — nothing in the new pipeline uses it.

- [ ] **Step 2: Make `tsconfig.json` non-emitting**

Set `"noEmit": true`; delete `"outDir"`, `"sourceMap"`, `"declaration"`; keep `module`/`moduleResolution: NodeNext` and the rest unchanged. Keep `"include": ["src/**/*"]`.

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS with no `dist/` created (delete the local `dist/` first if present to prove it: `Remove-Item -Recurse -Force dist` on Windows or `rm -rf dist`).

Run: `bun -e "const p = await Bun.file('package.json').json(); console.log(p.scripts.start, p.scripts.typecheck)"`
Expected: `bun src/index.ts tsc --noEmit`.

- [ ] **Step 4: Keep build-time type safety in CI**

The old Docker build ran `tsc`, so removing it would drop typechecking from releases. In `.github/workflows/release.yml`, after `bun install` (line 42) add:

```yaml
      - name: Typecheck
        run: bun run typecheck
```

Do not add `bun test` here yet: the suite has one pre-existing RPG failure (see Global Constraints) and would break releases until that is fixed separately.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .github/workflows/release.yml
git commit -m "build: run TypeScript directly and typecheck without emit"
```

---

### Task 4: Direct-TS Docker image

**Files:**
- Modify: `Dockerfile` (full rewrite)
- Modify: `.dockerignore`

- [ ] **Step 1: Rewrite the Dockerfile**

Two stages, both `oven/bun:1.3.14-alpine`. The deps stage installs production dependencies only; the runtime stage keeps the existing system toolchain and copies `node_modules`, `src`, and the root runtime files. No `tsc`, no `dist`, no prompt copy.

```dockerfile
# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS deps
RUN apk add --no-cache bash curl build-base python3 vips-dev
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
RUN apk add --no-cache vips-dev ffmpeg python3 py3-pip curl ca-certificates aria2 fontconfig font-dejavu
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install -U --pre --no-cache-dir "yt-dlp[default,curl-cffi]" \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && /opt/yt-dlp-venv/bin/pip install -U --no-cache-dir yt-dlp-ejs \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp-ejs /usr/local/bin/yt-dlp-ejs
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Copies src (TypeScript + prompt .md files), package.json, bun.lock and the
# optional cookies.txt the release workflow creates. .dockerignore keeps the
# image free of tests, docs, dist, tooling config and local junk.
COPY . .
ENV NODE_ENV=production
EXPOSE 5000
CMD ["bun", "src/index.ts"]
```

- [ ] **Step 2: Update `.dockerignore`**

Add `dist`, `tests`, `docs`, `.agents`, `.idea`, `SYSTEM_MAP.md`, `eslint.config.js`, `nodemon.json`, `tsconfig.json`, `README.md`, `test*.ts` to the existing list. Keep `node_modules`, `.git`, `.github`, `.env`, `*.log`. Verify with a local `tar`-style dry run is not necessary; the Docker build context listing (`docker build --progress=plain` output or `docker buildx du`) should show no `tests`/`dist`.

- [ ] **Step 3: Build and smoke-test the image (Docker host/CI only)**

```bash
docker build -t whatsapp-funbot:ts-local .
docker run --rm -d --name funbot-smoke -p 5055:5000 \
  -e MONGO_URI=mongodb://127.0.0.1:27017/unused \
  -e API_USERNAME=admin -e API_PASSWORD=admin123 \
  whatsapp-funbot:ts-local
sleep 8
curl -u admin:admin123 -s http://127.0.0.1:5055/api/status
docker logs funbot-smoke 2>&1 | grep -E "Successfully registered [0-9]+ commands|API running"
docker exec funbot-smoke ls /app
docker rm -f funbot-smoke
```

Expected: `/api/status` returns JSON with `"status"`; logs show commands registered and the API listening; `/app` lists `src`, `node_modules`, `package.json` and **no** `dist`; the process stays alive after Mongo connection failures (they are retried).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build(docker): run the TypeScript entrypoint with Bun, drop the dist build"
```

---

### Task 5: Command definition model, validation and templates

Pure data layer. No Mongo, no Hono.

**Files:**
- Create: `src/domain/models/CommandDefinition.ts`
- Create: `src/shared/utils/commandTemplates.ts`
- Create: `tests/commandTemplates.test.ts`
- Create: `tests/commandDefinition.test.ts`

**Interfaces:**
- Produces:
  - `CORE_COMMAND_NAMES: readonly ["games","help","stop","stats"]`
  - `COMMAND_NAME_PATTERN: RegExp` — `^[a-z0-9][a-z0-9_-]{0,31}$`
  - `MAX_COMMAND_RESPONSE_LENGTH = 4096`
  - `COMMAND_TEMPLATE_PLACEHOLDERS: readonly string[]` — `args`, `arg1`…`arg9`, `user`, `chat`, `prefix`, `botname`, `date`, `time`, `command`
  - `renderCommandTemplate(template: string, context: CommandTemplateContext): string`
  - `validateCommandTemplate(template: string): string[]` — unknown placeholder names, empty array when valid
  - `CommandTemplateContext` — `{ args: string[]; user: string; chat: string; prefix: string; botName: string; command: string; now?: Date }`
  - `CreateCustomCommandInput`, `UpdateCustomCommandInput`, `UpdateBuiltinCommandInput` types plus matching Zod schemas `createCustomCommandSchema`, `updateCustomCommandSchema`, `updateBuiltinCommandSchema`
  - `BuiltinOverride`, `CustomCommandDefinition`, `StoredBuiltinOverride`, `StoredCustomCommand`, `StoredCommandRecord`

- [ ] **Step 1: Write the failing template test**

```ts
// tests/commandTemplates.test.ts
import { describe, expect, it } from "bun:test";
import {
  renderCommandTemplate,
  validateCommandTemplate,
} from "../src/shared/utils/commandTemplates.js";

const context = {
  args: ["dunia", "baru"],
  user: "62811@s.whatsapp.net",
  chat: "1201@g.us",
  prefix: "!",
  botName: "Nexa AI",
  command: "halo",
  now: new Date("2026-11-11T04:05:06.000Z"),
};

describe("renderCommandTemplate", () => {
  it("replaces args, individual args and metadata", () => {
    const text = renderCommandTemplate(
      "Halo {{args}} dari {{user}} di {{chat}} ({{command}}{{prefix}}) {{botname}}",
      context,
    );

    expect(text).toBe(
      "Halo dunia baru dari 62811@s.whatsapp.net di 1201@g.us (halo!) Nexa AI",
    );
  });

  it("renders missing positional args as empty strings", () => {
    expect(renderCommandTemplate("[{{arg3}}]", context)).toBe("[]");
  });

  it("renders date and time from the injected clock", () => {
    const text = renderCommandTemplate("{{date}} {{time}}", context);

    expect(text).not.toContain("{{");
    expect(text).toContain(String(context.now.getFullYear()));
  });
});

describe("validateCommandTemplate", () => {
  it("accepts known placeholders and rejects unknown ones", () => {
    expect(validateCommandTemplate("{{args}} {{arg9}} {{prefix}}")).toEqual([]);
    expect(validateCommandTemplate("{{args}} {{bogus}} {{nope}}")).toEqual([
      "bogus",
      "nope",
    ]);
  });
});
```

- [ ] **Step 2: Write the failing schema test**

```ts
// tests/commandDefinition.test.ts
import { describe, expect, it } from "bun:test";
import {
  createCustomCommandSchema,
  updateBuiltinCommandSchema,
  updateCustomCommandSchema,
} from "../src/domain/models/CommandDefinition.js";

const valid = {
  name: "halo",
  aliases: ["hi"],
  description: "Sapaan",
  response: "Halo {{args}}",
};

describe("createCustomCommandSchema", () => {
  it("accepts a minimal valid command", () => {
    expect(createCustomCommandSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["name with spaces", { ...valid, name: "ha lo" }],
    ["name with symbols", { ...valid, name: "ha!lo" }],
    ["dash-prefixed name", { ...valid, name: "-halo" }],
    ["empty response", { ...valid, response: "" }],
    ["oversized response", { ...valid, response: "x".repeat(4097) }],
    ["too many aliases", { ...valid, aliases: ["a", "b", "c", "d", "e", "f"] }],
    ["unknown category", { ...valid, category: "admin" }],
  ])("rejects %s", (_label, input) => {
    expect(createCustomCommandSchema.safeParse(input).success).toBe(false);
  });

  it("normalizes names and aliases to lowercase", () => {
    const parsed = createCustomCommandSchema.parse({
      ...valid,
      name: "Halo",
      aliases: ["HI"],
    });

    expect(parsed.name).toBe("halo");
    expect(parsed.aliases).toEqual(["hi"]);
  });
});

describe("update schemas", () => {
  it("allow partial updates and keep names immutable", () => {
    expect(updateCustomCommandSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateCustomCommandSchema.safeParse({ name: "other" }).success).toBe(false);
    expect(
      updateBuiltinCommandSchema.safeParse({ enabled: false, disabledReason: "rusak" })
        .success,
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/commandTemplates.test.ts tests/commandDefinition.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the model and template modules**

Template rendering: replace `/\{\{\s*([a-z0-9]+)\s*\}\}/gi`; map `argN` to `args[N-1] ?? ""`; `date` uses `toLocaleDateString("id-ID")`, `time` uses `toLocaleTimeString("id-ID")` from `context.now ?? new Date()`. `validateCommandTemplate` returns unique unknown placeholder names in first-appearance order.

Zod schemas: trim then lowercase all names/aliases before the regex check (`name: z.string().trim().toLowerCase().regex(COMMAND_NAME_PATTERN)`); description 1–200; helpText ≤ 2000; response 1–4096; category enum `["general","utility"]` default `"general"`; cooldown integer 0–86,400,000 (ms — `CooldownManager` expects milliseconds); maxUses integer 1–1000; requiredRoles enum array max 3. `updateCustomCommandSchema` MUST be declared explicitly with every field `.optional()` and **no defaults**, and `.strict()` — do NOT derive it with `.partial()` from the create schema, because Zod 4 keeps `.default()` values through `.partial()`, so a one-field PATCH would overwrite aliases/category/enabled with create-time defaults (this was a real data-loss bug caught in review); `.strict()` also means an attempted rename is a `400`, not a silent no-op. `updateBuiltinCommandSchema` mirrors the override fields (no name, no response, no category) and is `.strict()`; `createCustomCommandSchema` is `.strict()` too. Export stored record types with `_id: string` and `kind`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/commandTemplates.test.ts tests/commandDefinition.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/models/CommandDefinition.ts src/shared/utils/commandTemplates.ts tests/commandTemplates.test.ts tests/commandDefinition.test.ts
git commit -m "feat(commands): add stored command model and response template support"
```

---

### Task 6: Command store and registry service

The core: merge code commands with DB overrides/custom commands, validate collisions, expose sync lookups for the message hot path.

**Files:**
- Create: `src/domain/services/CommandStore.ts`
- Create: `src/infrastructure/config/mongoCommandStore.ts`
- Create: `src/domain/services/CommandRegistryService.ts`
- Create: `src/infrastructure/config/commandRegistry.ts`
- Create: `tests/commandRegistry.test.ts`
- Modify: `src/app/handlers/CommandInterface.ts:5-19`

**Interfaces:**
- Consumes: Task 5 model; `getActiveMongoClient`, `BotConfig`, `log` from config/mongo.
- Produces:
  - `CommandInfo.commandClass?: new () => CommandInterface` (optional now, because custom commands have no class).
  - `CommandStore` — `list(): Promise<StoredCommandRecord[]>`, `upsert(record: StoredCommandRecord): Promise<void>`, `delete(id: string): Promise<boolean>`, `ensureIndexes(): Promise<void>`.
  - `RuntimeCommandInfo extends CommandInfo` — adds `source: "builtin" | "custom"`, `enabled: boolean`, `customDefinition?: CustomCommandDefinition`.
  - `CommandRegistry` interface — `initialize`, `listSync`, `getSync`, `create`, `updateCustom`, `updateBuiltin`, `removeCustom`, `resetBuiltin`.
  - `CommandConflictError`, `CommandNotFoundError`, `CommandStoreUnavailableError`, and `CommandValidationError(issues: { field: string; message: string }[])`.
  - `CommandRegistryService(store, loadBuiltins, options?: { cacheTtlMs?: number })` implements `CommandRegistry`.
  - `getCommandRegistry(): Promise<CommandRegistry>` singleton; `resetCommandRegistryForTests(): void`.

- [ ] **Step 1: Write the failing registry test with an in-memory store**

```ts
// tests/commandRegistry.test.ts
import { describe, expect, it } from "bun:test";
import type { CommandInfo } from "../src/app/handlers/CommandInterface.js";
import type { CommandStore } from "../src/domain/services/CommandStore.js";
import {
  CommandConflictError,
  CommandRegistryService,
  CommandStoreUnavailableError,
  CommandValidationError,
  type CommandRegistry,
} from "../src/domain/services/CommandRegistryService.js";
import type { StoredCommandRecord } from "../src/domain/models/CommandDefinition.js";

class MemoryStore implements CommandStore {
  records = new Map<string, StoredCommandRecord>();
  async list() { return [...this.records.values()]; }
  async upsert(record: StoredCommandRecord) { this.records.set(record._id, record); }
  async delete(id: string) { return this.records.delete(id); }
  async ensureIndexes() {}
}

class BrokenStore extends MemoryStore {
  async list(): Promise<StoredCommandRecord[]> { throw new Error("mongo down"); }
  async upsert(): Promise<void> { throw new Error("mongo down"); }
}

function builtin(overrides: Partial<CommandInfo>): CommandInfo {
  return {
    name: "search",
    aliases: ["ws"],
    description: "Cari web",
    category: "general",
    commandClass: class {} as never,
    ...overrides,
  };
}

const builtins = [
  builtin({}),
  builtin({ name: "help", aliases: [], description: "Bantuan", category: "general" }),
];

async function createRegistry(store: CommandStore = new MemoryStore()): Promise<{
  registry: CommandRegistry;
  store: CommandStore;
}> {
  const registry = new CommandRegistryService(store, async () => builtins);
  await registry.initialize();
  return { registry, store };
}

describe("CommandRegistryService", () => {
  it("merges built-ins, overrides and custom commands and resolves aliases", async () => {
    const { registry } = await createRegistry();
    await registry.create(
      { name: "halo", aliases: ["hi"], description: "Sapaan", response: "Halo {{args}}" },
      "api",
    );

    expect(registry.getSync("hi")?.name).toBe("halo");
    expect(registry.getSync("ws")?.name).toBe("search");
    expect(registry.listSync().map((entry) => entry.name)).toContain("halo");
  });

  it("disables and re-enables a built-in through an override, then resets it", async () => {
    const { registry } = await createRegistry();
    await registry.updateBuiltin("search", { enabled: false, disabledReason: "rusak" }, "api");

    expect(registry.getSync("search")?.disabled).toBe(true);
    expect(registry.getSync("search")?.disabledReason).toBe("rusak");

    await registry.resetBuiltin("search", "api");
    expect(registry.getSync("search")?.disabled).toBe(false);
  });

  it("rejects names and aliases that collide with built-ins or core commands", async () => {
    const { registry } = await createRegistry();

    await expect(
      registry.create({ name: "search", description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandConflictError);
    await expect(
      registry.create({ name: "halo", aliases: ["ws"], description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandConflictError);
    await expect(
      registry.create({ name: "help", description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandConflictError);
  });

  it("deletes custom commands but refuses to delete built-ins", async () => {
    const { registry } = await createRegistry();
    await registry.create({ name: "halo", description: "x", response: "x" }, "api");

    await expect(registry.removeCustom("search", "api")).rejects.toBeInstanceOf(CommandConflictError);
    await registry.removeCustom("halo", "api");
    expect(registry.getSync("halo")).toBeUndefined();
  });

  it("rejects unknown template placeholders", async () => {
    const { registry } = await createRegistry();

    await expect(
      registry.create({ name: "halo", description: "x", response: "Hai {{bogus}}" }, "api"),
    ).rejects.toBeInstanceOf(CommandValidationError);
  });

  it("keeps built-ins usable when the store is unavailable", async () => {
    const registry = new CommandRegistryService(new BrokenStore(), async () => builtins);
    await registry.initialize();

    expect(registry.getSync("search")?.name).toBe("search");
    await expect(
      registry.create({ name: "halo", description: "x", response: "x" }, "api"),
    ).rejects.toBeInstanceOf(CommandStoreUnavailableError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commandRegistry.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `CommandStore.ts` and `MongoCommandStore.ts`**

`MongoCommandStore` mirrors `BotConfigService`: db `BotConfig.sessionName`, collection `bot_commands`, lazy `getActiveMongoClient()` getter. `upsert` uses `updateOne({ _id: record._id }, { $set: record }, { upsert: true })`; `ensureIndexes` creates a unique index on `name` and swallows duplicate-index errors with `log.warn`.

- [ ] **Step 4: Implement `CommandRegistryService.ts`**

Build `views`/`aliasToName` from built-ins + store records on `refresh()`. Merge rules: override wins for `aliases`, `description`, `helpText`, `cooldown`, `maxUses`, `vipOnly`, `requiredRoles`, `disabled`, `disabledReason`; `enabled = override.enabled ?? !info.disabled`; `source` is `"builtin"` or `"custom"`. Custom entries get `disabled: !definition.enabled`, `commandClass: undefined`, `customDefinition: definition`. Alias map is rebuilt each refresh; a conflicting alias logs an error and the later entry is skipped (validation prevents new conflicts).

Validation methods: `assertNameAvailable(name, ignoreName?)` checks regex, `CORE_COMMAND_NAMES`, built-in names/aliases, custom names/aliases; `assertAliasesAvailable(aliases, ignoreName?)`. Throw `CommandConflictError` with a human-readable message. `create` also validates `validateCommandTemplate(response)`; unknown placeholders throw `CommandValidationError` (export it alongside the other errors; routes map it to `400`).

Store failures on write → wrap in `CommandStoreUnavailableError`. `initialize` catches `list()`/`ensureIndexes()` failures, logs `log.warn`, and proceeds with built-ins. `getSync` triggers `void this.refreshIfStale()` when `Date.now() - loadedAt > cacheTtlMs` (default 30_000) and serves the current cache; guard concurrent refreshes with a promise. `resetBuiltin` deletes `builtin:<name>`; `removeCustom` deletes `custom:<name>`.

- [ ] **Step 5: Implement the singleton accessor**

```ts
// src/infrastructure/config/commandRegistry.ts
let registryPromise: Promise<CommandRegistry> | null = null;

export function getCommandRegistry(): Promise<CommandRegistry> {
  registryPromise ??= (async () => {
    const registry = new CommandRegistryService(
      new MongoCommandStore(),
      () => loadBuiltinCommands(),
    );
    await registry.initialize();
    return registry;
  })();
  return registryPromise;
}

export function resetCommandRegistryForTests(): void {
  registryPromise = null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/commandRegistry.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
bun run typecheck
git add src/domain/services/CommandStore.ts src/infrastructure/config/mongoCommandStore.ts src/domain/services/CommandRegistryService.ts src/infrastructure/config/commandRegistry.ts tests/commandRegistry.test.ts
git commit -m "feat(commands): add Mongo-backed command registry with overrides and custom commands"
```

---

### Task 7: Handler integration and dynamic command execution

Make the running bot resolve commands through the registry and execute custom commands.

**Files:**
- Create: `src/app/handlers/DynamicCommand.ts`
- Create: `tests/dynamicCommand.test.ts`
- Create: `tests/commandHandlerDynamic.test.ts`
- Modify: `src/app/handlers/CommandHandler.ts:29-99,174-291,312-330,473-519,658-786`
- Modify: `src/app/client/BotClient.ts:70-86,177-180`

**Interfaces:**
- Consumes: Task 6 `CommandRegistry`, `RuntimeCommandInfo`; Task 5 `CustomCommandDefinition`.
- Produces:
  - `DynamicCommand` — constructor `(definition: CustomCommandDefinition, resolveConfig?: () => Promise<typeof BotConfig>)`; implements `handleCommand`.
  - `CommandHandler` constructor — `(sessionService, usageService?, options?: { registry?: CommandRegistry; sessionCleanupIntervalMs?: number })`.

- [ ] **Step 1: Write the failing `DynamicCommand` test**

```ts
// tests/dynamicCommand.test.ts
import { describe, expect, it } from "bun:test";
import { DynamicCommand } from "../src/app/handlers/DynamicCommand.js";
import type { CustomCommandDefinition } from "../src/domain/models/CommandDefinition.js";

function definition(overrides: Partial<CustomCommandDefinition> = {}): CustomCommandDefinition {
  return {
    name: "halo",
    aliases: [],
    description: "Sapaan",
    category: "general",
    response: "Halo {{args}} dari {{command}}",
    enabled: true,
    createdBy: "api",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    updatedBy: "api",
    ...overrides,
  };
}

function fakeSocket() {
  const sent: string[] = [];
  return {
    sent,
    socket: {
      sendMessage: async (_jid: string, content: { text?: string }) => {
        sent.push(content.text ?? "");
        return { key: { id: String(sent.length) } };
      },
    },
  };
}

describe("DynamicCommand", () => {
  it("renders the stored response template and sends it to the chat", async () => {
    const { sent, socket } = fakeSocket();
    const command = new DynamicCommand(definition(), async () => ({ prefix: "!", name: "Nexa AI" } as never));

    await command.handleCommand(
      ["dunia"],
      "1201@g.us",
      "62811@s.whatsapp.net",
      socket as never,
      {} as never,
      {} as never,
    );

    expect(sent).toEqual(["Halo dunia dari halo"]);
  });
});
```

- [ ] **Step 2: Write the failing handler integration test**

```ts
// tests/commandHandlerDynamic.test.ts
import { describe, expect, it } from "bun:test";
import { CommandHandler } from "../src/app/handlers/CommandHandler.js";
import type { CommandRegistry } from "../src/domain/services/CommandRegistryService.js";
import type { RuntimeCommandInfo } from "../src/domain/services/CommandRegistryService.js";
import type { CustomCommandDefinition } from "../src/domain/models/CommandDefinition.js";

function customInfo(enabled: boolean): RuntimeCommandInfo {
  const definition = {
    name: "halo",
    aliases: ["hi"],
    description: "Sapaan",
    category: "general" as const,
    response: "Halo {{args}}",
    enabled,
    createdBy: "api",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    updatedBy: "api",
  } satisfies CustomCommandDefinition;

  return {
    name: "halo",
    aliases: ["hi"],
    description: definition.description,
    category: "general",
    source: "custom",
    enabled,
    disabled: !enabled,
    customDefinition: definition,
  };
}

function registry(info: RuntimeCommandInfo | undefined): CommandRegistry {
  return {
    initialize: async () => {},
    listSync: () => (info ? [info] : []),
    getSync: (name: string) =>
      info && (name === "halo" || name === "hi") ? info : undefined,
    create: async () => { throw new Error("not used"); },
    updateCustom: async () => { throw new Error("not used"); },
    updateBuiltin: async () => { throw new Error("not used"); },
    removeCustom: async () => {},
    resetBuiltin: async () => { throw new Error("not used"); },
  };
}

function handlerFor(info: RuntimeCommandInfo) {
  return new CommandHandler(
    { getSession: async () => null } as never,
    undefined,
    { registry: registry(info), sessionCleanupIntervalMs: 0 },
  );
}

function fakeSocket(sent: string[]) {
  return {
    sendMessage: async (_jid: string, content: { text?: string }) => {
      sent.push(content.text ?? "");
      return { key: { id: String(sent.length) } };
    },
  } as never;
}

describe("CommandHandler custom commands", () => {
  it("executes a custom command through the AI execution path", async () => {
    const sent: string[] = [];
    const handler = handlerFor(customInfo(true));
    await handler.waitForInitialization();

    const result = await handler.executeCommandForAI(
      "halo",
      ["dunia"],
      "1201@g.us",
      "62811@s.whatsapp.net",
      fakeSocket(sent),
      {} as never,
    );

    expect(result.success).toBe(true);
    expect(sent).toEqual(["Halo dunia"]);
  });

  it("reports a disabled custom command instead of executing it", async () => {
    const sent: string[] = [];
    const handler = handlerFor(customInfo(false));
    await handler.waitForInitialization();

    const result = await handler.executeCommandForAI(
      "halo",
      ["dunia"],
      "1201@g.us",
      "62811@s.whatsapp.net",
      fakeSocket(sent),
      {} as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled");
    expect(sent).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/dynamicCommand.test.ts tests/commandHandlerDynamic.test.ts`
Expected: FAIL — modules/constructor options not found.

- [ ] **Step 4: Implement `DynamicCommand.ts`**

`handleCommand` resolves config (default `getCurrentConfig`), calls `renderCommandTemplate(definition.response, { args, user, chat: jid, prefix: config.prefix, botName: config.name, command: definition.name })`, and `await sock.sendMessage(jid, { text })`. Ignore `sessionService`/`msg` with `void`.

- [ ] **Step 5: Rework `CommandHandler` around the registry**

- Constructor stores `options.registry` in `this.registryPromise = Promise.resolve(options.registry)` or lazily calls `getCommandRegistry()`. Store `sessionCleanupIntervalMs`; only call `setInterval` when `> 0`.
- `initialize()` awaits the registry's `initialize()` and sets `initialized = true`; remove the local `commands`/`aliases` maps, `registerCommand`, `registerCommands` and `getCommandInfo`'s map logic.
- `getCommandInfo(name)` → `this.registry.getSync(name.toLowerCase())`; aliases resolve inside the registry.
- `getCommandInstance` → `if (info.customDefinition) return new DynamicCommand(info.customDefinition); if (!info.commandClass) throw new Error(...); return new info.commandClass();`
- `getAllCommands`/`getCommandsByCategory`/`getCommandByName`/`isCommandAvailable` delegate to `listSync`/`getSync`; return `CommandInfo[]` (runtime entries are assignable).
- `listGames` and `handleHelpCommand` iterate `this.registry.listSync()`; keep core-command help text. In the full help list, append `" (nonaktif)"` after the description when `info.disabled` is true.
- Everything else (VIP, roles, cooldown, usage, dispatch branches) stays as-is.

- [ ] **Step 6: Update `BotClient` after re-creating the handler**

At `src/app/client/BotClient.ts:177-180`, after `this.commandHandler = new CommandHandler(...)`, call `setCommandHandler(this.commandHandler)` again and await/log `waitForInitialization()` so the AI tools and the message router share the live handler. Do not change the constructor's early handler.

- [ ] **Step 7: Run tests and typecheck**

Run: `bun test tests/dynamicCommand.test.ts tests/commandHandlerDynamic.test.ts tests/commandRegistry.test.ts`
Expected: PASS. Then `bun run typecheck` (expected PASS).

- [ ] **Step 8: Commit**

```bash
git add src/app/handlers/DynamicCommand.ts tests/dynamicCommand.test.ts tests/commandHandlerDynamic.test.ts src/app/handlers/CommandInterface.ts src/app/handlers/CommandHandler.ts src/app/client/BotClient.ts
git commit -m "feat(commands): dispatch custom commands through the shared registry"
```

---

### Task 8: Command management API

**Files:**
- Create: `src/infrastructure/web/commandRoutes.ts`
- Create: `tests/commandRoutes.test.ts`
- Modify: `src/api.ts:41-43,64-67,132-150` (register routes after auth middleware, before `serve`)

**Interfaces:**
- Consumes: Task 6 `CommandRegistry`, error classes; Task 5 schemas.
- Produces: `registerCommandRoutes(app: Hono, getRegistry?: () => Promise<CommandRegistry>): void` and these endpoints:
  - `GET /api/commands` → `{ commands: PublicCommandView[] }`
  - `POST /api/commands` → `201 { command }`
  - `GET /api/commands/:name` → `{ command }`
  - `PATCH /api/commands/:name` → `{ command }` (custom or built-in override)
  - `DELETE /api/commands/:name` → `{ message }` (custom only)
  - `POST /api/commands/:name/reset` → `{ command }` (built-in only)
- `PublicCommandView` fields: `name`, `aliases`, `description`, `helpText`, `category`, `source`, `enabled`, `disabledReason`, `cooldown`, `maxUses`, `vipOnly`, `requiredRoles`, `response` (custom only), `updatedAt`, `updatedBy`.

- [ ] **Step 1: Write the failing route test**

```ts
// tests/commandRoutes.test.ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerCommandRoutes } from "../src/infrastructure/web/commandRoutes.js";
import {
  CommandConflictError,
  CommandNotFoundError,
  CommandStoreUnavailableError,
  CommandValidationError,
} from "../src/domain/services/CommandRegistryService.js";
import type { CommandRegistry } from "../src/domain/services/CommandRegistryService.js";

const view = {
  name: "halo",
  aliases: [] as string[],
  description: "Sapaan",
  category: "general" as const,
  source: "custom" as const,
  enabled: true,
  response: "Halo {{args}}",
};

function appWith(overrides: Partial<CommandRegistry>) {
  const registry = {
    initialize: async () => {},
    listSync: () => [],
    getSync: () => undefined,
    create: async () => view,
    updateCustom: async () => view,
    updateBuiltin: async () => view,
    removeCustom: async () => {},
    resetBuiltin: async () => view,
    ...overrides,
  } as unknown as CommandRegistry;
  const app = new Hono();
  registerCommandRoutes(app, async () => registry);
  return app;
}

describe("command routes", () => {
  it("lists commands", async () => {
    const app = appWith({});
    const res = await app.request("/api/commands");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: [] });
  });

  it("creates a custom command", async () => {
    const app = appWith({});
    const res = await app.request("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "halo", description: "Sapaan", response: "Halo {{args}}" }),
    });
    expect(res.status).toBe(201);
  });

  it("maps registry errors to HTTP statuses", async () => {
    const conflict = appWith({ create: async () => { throw new CommandConflictError("exists"); } });
    expect((await conflict.request("/api/commands", { method: "POST", body: JSON.stringify({ name: "x", description: "x", response: "x" }) })).status).toBe(409);

    const invalid = appWith({ create: async () => { throw new CommandValidationError([{ field: "response", message: "bad" }]); } });
    expect((await invalid.request("/api/commands", { method: "POST", body: JSON.stringify({ name: "x", description: "x", response: "x" }) })).status).toBe(400);

    const missing = appWith({ updateCustom: async () => { throw new CommandNotFoundError("halo"); } });
    expect((await missing.request("/api/commands/halo", { method: "PATCH", body: JSON.stringify({ enabled: false }) })).status).toBe(404);

    const down = appWith({ create: async () => { throw new CommandStoreUnavailableError(); } });
    expect((await down.request("/api/commands", { method: "POST", body: JSON.stringify({ name: "x", description: "x", response: "x" }) })).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commandRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `commandRoutes.ts`**

Parse bodies with the Task 5 schemas (`safeParse`), map issues to `{ error: "Invalid request body", details: [{ field, message }] }` with `400`. Create strips unknown fields; update schemas are strict, so a rename attempt or unknown key is a `400` rather than a silent no-op. Look up the current command before PATCH/DELETE/reset so custom vs built-in routing is explicit (`404` when absent). Name matching is case-insensitive (`c.req.param("name").toLowerCase()`). Serialize via a `toPublicCommandView(info)` helper that omits `commandClass` and maps `customDefinition` to `response`.

- [ ] **Step 4: Wire into `src/api.ts`**

Import `registerCommandRoutes` and call it after the Basic Auth middleware block:

```ts
registerCommandRoutes(app);
```

The `/api/*` middleware already covers it. No other route changes in this task.

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test tests/commandRoutes.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/web/commandRoutes.ts tests/commandRoutes.test.ts src/api.ts
git commit -m "feat(api): expose command management endpoints"
```

---

### Task 9: Admin console — Commands section markup and styles

**Files:**
- Create: `src/infrastructure/web/adminConsoleCommandsBody.ts`
- Create: `src/infrastructure/web/adminConsoleCommandsStyles.ts`
- Create: `tests/adminConsole.test.ts`
- Modify: `src/infrastructure/web/adminConsoleBody.ts:13-20` (nav) and tail (insert section before `</main>`)
- Modify: `src/infrastructure/web/adminConsoleStyles.ts` (append styles)
- Modify: `src/infrastructure/web/adminConsolePage.ts:15-18` (load commands script)

**Interfaces:**
- Produces: `ADMIN_CONSOLE_COMMANDS_BODY: string`, `ADMIN_CONSOLE_COMMANDS_STYLES: string`; DOM ids used by Task 10: `commands`, `commandsTableBody`, `commandSearch`, `commandSourceFilter`, `commandStatusFilter`, `newCommandBtn`, `refreshCommandsBtn`, `commandsMeta`, `commandFormPanel`, `commandForm`, `commandFormTitle`, `cmdName`, `cmdAliases`, `cmdDescription`, `cmdCategory`, `cmdResponse`, `cmdCooldown`, `cmdMaxUses`, `cmdVipOnly`, `cmdRequiredRoles`, `cmdEnabled`, `cmdDisabledReason`, `cmdHelpText`, `cmdFormFeedback`, `cancelCommandBtn`.

- [ ] **Step 1: Write the failing markup test**

```ts
// tests/adminConsole.test.ts
import { describe, expect, it } from "bun:test";
import { renderAdminConsoleHtml } from "../src/infrastructure/web/adminConsolePage.js";
import { ADMIN_CONSOLE_COMMANDS_BODY } from "../src/infrastructure/web/adminConsoleCommandsBody.js";

describe("admin console commands section", () => {
  it("is reachable from the navigation and present in the rendered page", () => {
    const html = renderAdminConsoleHtml();

    expect(html).toContain('href="#commands"');
    expect(html).toContain('id="commands"');
    expect(html).toContain("commandsTableBody");
    expect(ADMIN_CONSOLE_COMMANDS_BODY).toContain('id="commandSearch"');
    expect(html).toContain('src="/admin/commands.js"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/adminConsole.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the section markup**

Build an `.panel` with a `.panel-head` (title "Commands", copy explaining data-only commands take effect immediately), a toolbar row (`commandSearch`, two selects, `refreshCommandsBtn`, `newCommandBtn`), a `.table-wrap > table` with `tbody#commandsTableBody`, a `.meta` paragraph (`commandsMeta`), and a hidden form panel (`commandFormPanel` with `commandForm`) containing the fields listed above. Add a short placeholder cheatsheet under the response textarea. Use existing classes (`panel`, `panel-head`, `field`, `btn-row`, `table-wrap`, `meta`, `ghost`, `primary`).

- [ ] **Step 4: Compose the section and nav link**

Import `ADMIN_CONSOLE_COMMANDS_BODY` in `adminConsoleBody.ts`, interpolate it before `</main>`, and add `<a href="#commands">Commands</a>` after the Usage link. Import `ADMIN_CONSOLE_COMMANDS_STYLES` in `adminConsoleStyles.ts` and append it to the exported string. Add `<script src="/admin/commands.js" defer></script>` in `adminConsolePage.ts` after `/admin/app.js`.

- [ ] **Step 5: Add styles**

Style the toolbar grid, source/enabled badges, action button row, form panel grid (two columns, response textarea spanning both), and a mobile breakpoint consistent with the existing console. Prefix new classes with `commands-` to avoid collisions.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/adminConsole.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/web/adminConsoleCommandsBody.ts src/infrastructure/web/adminConsoleCommandsStyles.ts src/infrastructure/web/adminConsoleBody.ts src/infrastructure/web/adminConsoleStyles.ts src/infrastructure/web/adminConsolePage.ts tests/adminConsole.test.ts
git commit -m "feat(admin): add command management section to the console"
```

---

### Task 10: Admin console — command management behavior

**Files:**
- Create: `src/infrastructure/web/adminConsoleCommandsScript.ts`
- Modify: `src/infrastructure/web/adminConsoleScript.ts` (dispatch refresh event)
- Modify: `src/api.ts:132-150` (serve `/admin/commands.js`)
- Modify: `tests/adminConsole.test.ts` (script-serving assertion)

**Interfaces:**
- Consumes: the Task 8 endpoints and Task 9 DOM ids.
- Produces: `ADMIN_CONSOLE_COMMANDS_SCRIPT: string`; a standalone IIFE with no globals.

- [ ] **Step 1: Extend the failing test**

```ts
// tests/adminConsole.test.ts — add
import { ADMIN_CONSOLE_COMMANDS_SCRIPT } from "../src/infrastructure/web/adminConsoleCommandsScript.js";

it("ships a self-contained commands script with no innerHTML rendering", () => {
  expect(ADMIN_CONSOLE_COMMANDS_SCRIPT).toContain("/api/commands");
  expect(ADMIN_CONSOLE_COMMANDS_SCRIPT).not.toContain("innerHTML");
  expect(ADMIN_CONSOLE_COMMANDS_SCRIPT).toContain("admin:refresh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/adminConsole.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the script**

Self-contained IIFE with a local `api(path, options)` helper (JSON body/headers, error extraction like `adminConsoleScript.ts:163-180`), state (`commands`, `editing`), and functions: `loadCommands()`, `renderTable()` (create rows with `document.createElement` + `textContent`; name + aliases, source badge, category, enabled toggle button, cooldown, Edit / Reset / Delete actions), `openCreate()`, `openEdit(name)`, `submitForm()` (POST or PATCH), `toggleEnabled(name)`, `deleteCommand(name)` with `confirm()`, `resetCommand(name)` with `confirm()`, `bindEvents()`, and `bootstrap()`. Disable name editing when editing; hide custom-only fields (response, category) for built-ins; show a "Reset to code defaults" hint. On `window.addEventListener("admin:refresh", loadCommands)`, refresh. Feedback goes to `cmdFormFeedback`/`commandsMeta` with `textContent`.

- [ ] **Step 4: Serve the script and broadcast refresh**

In `src/api.ts`, import `ADMIN_CONSOLE_COMMANDS_SCRIPT` and add:

```ts
app.get("/admin/commands.js", () => new Response(ADMIN_CONSOLE_COMMANDS_SCRIPT, {
  headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
}));
```

In `adminConsoleScript.ts`'s `refreshAll()` add `window.dispatchEvent(new Event('admin:refresh'));` (the commands script may load after the first refresh; its own `bootstrap()` loads immediately).

- [ ] **Step 5: Run tests**

Run: `bun test tests/adminConsole.test.ts tests/commandRoutes.test.ts`
Expected: PASS.

- [ ] **Step 6: Manual browser check (after Tasks 1-8 are wired)**

Start the app against a dev Mongo (`bun run dev`), open `/admin`, sign in, then:
- Create `halo` with response `Halo {{args}}`; it appears in the table and in `!help` after the next message.
- Edit its description and aliases; toggle it off; the table shows disabled.
- Disable built-in `search`; `!search test` replies with the disabled reason.
- Reset `search`; it works again.
- Try to create `help` and `search`; both are rejected with a visible error.
- Put `<img src=x onerror=alert(1)>` in a description; it renders as text (no alert, no image).
- Delete `halo`; it disappears.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/web/adminConsoleCommandsScript.ts src/infrastructure/web/adminConsoleScript.ts src/api.ts tests/adminConsole.test.ts
git commit -m "feat(admin): manage commands from the console"
```

---

### Task 11: Documentation and system map

**Files:**
- Create: `docs/COMMANDS.md`
- Modify: `SYSTEM_MAP.md` (file registry, API surface, data models, conventions, changelog)

- [ ] **Step 1: Write `docs/COMMANDS.md`**

Cover: built-in vs custom commands; what the console can do (create/edit/disable/delete/reset); placeholder table; 409/400/503 meanings; the security rule that custom commands are text only and complex commands still require a deploy; that changes are stored in `bot_commands` and invalidate the in-process cache immediately; cache TTL 30 s for other replicas.

- [ ] **Step 2: Update `SYSTEM_MAP.md`**

Add to the file registry: `commandLoader`, `sourcePaths`, `CommandDefinition`, `commandTemplates`, `CommandStore`, `mongoCommandStore`, `CommandRegistryService`, `commandRegistry`, `DynamicCommand`, `commandRoutes`, and the three console command files. Add the six API routes. Add `bot_commands` to data models. Update the "Conventions" section: production runs `bun src/index.ts`, `tsc --noEmit` is typecheck-only, no `dist/`. Add a changelog entry dated 2026-11-11.

- [ ] **Step 3: Commit**

```bash
git add docs/COMMANDS.md SYSTEM_MAP.md
git commit -m "docs: document direct TS runtime and web command management"
```

---

### Task 12: Full verification and handoff

**Files:** none (verification only; fix any failures in the owning task).

- [ ] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 2: Full test suite**

Run: `bun test`
Expected: same baseline plus new tests passing; the only failure is the pre-existing `rpg party > awards party combat rewards to every active member` (`result.victory` is `undefined`). Record the pass/fail counts in the handoff.

- [ ] **Step 3: Verify no compiled-layout assumptions remain**

Run: `git grep -n "dist/" -- src Dockerfile package.json`
Expected: no matches in `src` or `package.json` (a `dist` mention in docs is fine).

Run: `git grep -nE '"build"|tsc -p' -- package.json Dockerfile`
Expected: only `tsc --noEmit` in the `typecheck` script.

- [ ] **Step 4: Docker smoke (Docker host/CI)**

Run the Task 4 build/run/curl/log/`ls /app` sequence. Expected: `/api/status` 200, registered-commands log line, no `/app/dist`.

- [ ] **Step 5: API smoke (local dev, Mongo available)**

```bash
bun run dev
# then, in another shell
curl -u admin:admin123 -s http://127.0.0.1:5000/api/commands
curl -u admin:admin123 -s -X POST http://127.0.0.1:5000/api/commands \
  -H 'content-type: application/json' \
  -d '{"name":"halo","aliases":["hi"],"description":"Sapaan","response":"Halo {{args}}"}'
curl -u admin:admin123 -s -X PATCH http://127.0.0.1:5000/api/commands/halo \
  -H 'content-type: application/json' -d '{"enabled":false}'
curl -u admin:admin123 -s -X DELETE http://127.0.0.1:5000/api/commands/halo
```

Expected: `201` create, `{ "command": { ... "enabled": false } }` patch, delete success; then `!help` no longer lists `halo`, and `!hi` is unknown.

- [ ] **Step 6: Final commit (if verification produced fixes)**

```bash
git status --short
git add -A && git commit -m "test: verify direct TS runtime and command management"
```

---

## Self-review checklist (run before handoff)

- **Spec coverage:** Goal 1 → Tasks 1-4, 12. Goal 2 → Tasks 5-10. Docs → Task 11. Security rule → Tasks 5, 8, 10 (validation, no code execution, `textContent`). Rollout → Task 12 + spec.
- **Failure modes:** collisions (Task 6), Mongo down (Task 6), malformed template (Tasks 5-6, 8), disabled dispatch (Task 7), Docker/no-dist (Tasks 1-4, 12).
- **Type consistency:** `RuntimeCommandInfo` extends `CommandInfo`; `CommandInfo.commandClass` becomes optional in Task 6; `CommandRegistry` methods used identically in Tasks 6-8; `CustomCommandDefinition` shape used by `DynamicCommand` and the store; `renderCommandTemplate` context matches `DynamicCommand`.
- **Known baseline:** one pre-existing RPG test failure, documented in Global Constraints and Task 12; do not "fix" it as part of this work unless asked.
