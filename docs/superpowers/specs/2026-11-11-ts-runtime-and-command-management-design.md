# Direct TypeScript Runtime + Web Command Management — Design

**Date:** 2026-11-11
**Status:** Proposed — waiting for approval (no implementation started)
**Related plan:** `docs/superpowers/plans/2026-11-11-ts-runtime-and-command-management.md`

## Intent

Two changes, one deployment:

1. Run the application as TypeScript in production (and in Docker) instead of compiling
   `src/` to `dist/` with `tsc` and running the JavaScript.
2. Let an admin add, edit, disable, reset and delete commands from the existing web admin
   console, without rebuilding the Docker image.

The second change is what makes the first one pay off: today a new command means a code
change, a rebuild and a redeploy.

## What exists today (verified by reading the repo)

- `src/` is already TypeScript. Development already runs it directly:
  `bun --hot src/index.ts`. `bun.lock` exists; CI and the Docker builder pin Bun `1.3.14`.
- `CommandHandler` discovers command classes with `fs.readdirSync` + dynamic `import()`,
  choosing `.ts` or `.js` from `NODE_ENV`, and stores static `commandInfo` objects in a
  `Map` plus an alias map. `disabled` is a compiled-in constant.
- There are 25 command classes in `src/app/commands/`; every one exposes
  `static commandInfo` with `name`, `aliases`, `description`, `category`,
  `commandClass`, optional `cooldown`, `maxUses`, `requiredRoles`, `vipOnly`.
- `Dockerfile`: builder installs Bun, runs `bun run tsc`, copies `dist` plus the prompt
  `.md` files into a `node:24-alpine` runtime, then `node dist/index.js`.
- Three places assume the compiled layout: `CommandHandler` (`.js` in production),
  `WorkerPool` (`dist/shared/utils/worker.js`), `StickerCommand` and
  `VideoToAudioCommand` (`dist/...` processor paths). `promptLoader` reads the
  prompt `.md` files relative to `import.meta.url`.
- The admin console at `/admin` is HTTP Basic Auth protected. It is built from inline
  string modules (`adminConsoleBody`, `Styles`, `Script`, `Page`), backed by Hono routes in
  `src/api.ts`, and persists bot settings in MongoDB through `BotConfigService`
  (60 s in-process cache, invalidated on write).
- Mongo is already the persistence layer for config, usage stats, sessions, VIP, reminders.
- Local verification (Bun 1.3.14): `baileys`, `sharp`, Hono's Node server and TS command
  modules all import and run; `bun test` gives 59 pass / 1 pre-existing RPG failure.
  Docker CLI is not installed on this workstation, so the image build must be verified
  on a Docker-capable host/CI.

## Goals

- Production and Docker run `bun src/index.ts`; no `tsc` build step and no `dist/` in the image.
- Admin can create a custom text command, edit it, disable/enable it, delete it, and
  override built-in commands (enable/disable, aliases, description, help, cooldown,
  roles, VIP flag) from `/admin`.
- Changes take effect while the bot is running; no restart, no image rebuild.
- Custom commands participate in `!help`, `!help <name>`, `!games` and the AI tools
  (`get_bot_commands`, `get_command_help`, `execute_bot_command`).
- Existing behavior, commands, config and Mongo data are preserved.

## Non-goals

- Executing arbitrary code uploaded from the browser (see rejected approach B).
- New command *capabilities* (media replies, webhooks, AI-generated replies) in v1;
  custom commands reply with text only. The data model leaves room to add a type later.
- Multi-replica cache coordination, audit-log collection, command versioning/rollback.
- Redesigning the admin console or changing its auth model.

## Approaches considered

### A. Runtime

| Option | What it means | Trade-off |
| --- | --- | --- |
| **Bun in the image (chosen)** | Runtime stage is `oven/bun:1.3.14-alpine`; `CMD ["bun","src/index.ts"]`. Bun strips types at load time and already resolves the repo's `.js` import specifiers to `.ts` files (proved by `bun test` and module imports). | New production runtime for the WhatsApp socket path; needs one honest smoke test in Docker. Already the dev runtime, so the code is known to load. |
| Node 24 + `tsx` loader | `node --import tsx src/index.ts`; keeps Node as the runtime. | Adds a runtime dependency, loader overhead, and the same `.js`→`.ts` resolution question moved into `tsx`. No upside over Bun here. |
| Node 24 native type stripping | `node --experimental-transform-types src/index.ts`. | Requires migrating every relative import from `.js` to `.ts` (or `rewriteRelativeImportExtensions` plus noEmit), and `CommandHandler`'s constructor parameter properties need refactoring. Large, noisy diff for no benefit. |

### B. Dynamic commands

| Option | What it means | Trade-off |
| --- | --- | --- |
| **DB-backed data commands + built-in overrides (chosen)** | Admins define name/aliases/description/response-template; built-ins get overrides (enabled, aliases, cooldown, roles). Mongo is the store; a registry merges code commands with DB records. | Solves canned replies/aliases and on/off toggles without deploys. Complex new behavior still needs code. |
| Upload executable TS/JS | Admin uploads a command class; the bot writes it to disk and imports it live. | Arbitrary remote code execution through `API_USERNAME`/`API_PASSWORD` (defaults are `admin`/`admin123` in `.env.example`), no type checking, no review, harder rollback. The existing admin AI tools already grant shell, but turning the *web form* into a code loader widens the blast radius and contradicts the "just run TS" simplicity goal. Rejected for v1; can be a future opt-in with a signed/verified directory. |
| Overrides only | Enable/disable/alias built-ins only. | Does not satisfy "add". |

## Decisions

1. **Bun runtime, pinned `1.3.14`**, for dev, CI and Docker. No `dist/`.
2. **One Mongo collection `bot_commands`** for both custom commands and built-in overrides,
   keyed `_id: "builtin:<name>"` / `_id: "custom:<name>"`. `name` is stored lowercase and
   unique. Missing built-in override = code defaults.
3. **Custom commands are data-only text replies** with `{{placeholder}}` templates:
   `{{args}}`, `{{arg1}}`…`{{arg9}}`, `{{user}}`, `{{chat}}`, `{{prefix}}`, `{{botname}}`,
   `{{date}}`, `{{time}}`, `{{command}}`. Unknown placeholders are rejected at save time.
4. **A `CommandRegistryService` singleton** is shared by the bot handler and the API so a
   web edit is visible to the running bot immediately. Cache is refreshed every 30 s for
   out-of-process changes; writes refresh it synchronously.
5. **Built-in command code stays untouched.** Overrides are merged at runtime; names are
   immutable. Core commands (`games`, `help`, `stop`, `stats`) cannot be overridden.
6. **Custom commands are limited to `general` and `utility` categories.** Admin-level
   gating is done with `requiredRoles: ["admin"]`, not a new category.
7. **Security model is unchanged:** all new routes sit behind the existing Basic Auth.
   The UI renders user-supplied strings with `textContent`, never `innerHTML`.
8. **No DB migration:** the new collection starts empty. Removing the feature later leaves
   inert documents behind.

## Data shape (detail lives in the plan)

```
bot_commands
  builtin override: { _id: "builtin:search", kind: "builtin", name: "search",
                      enabled?, disabledReason?, aliases?, description?, helpText?,
                      cooldown?, maxUses?, vipOnly?, requiredRoles?,
                      updatedAt, updatedBy }
  custom command:   { _id: "custom:halo", kind: "custom", name: "halo",
                      aliases, description, helpText?, category, response,
                      enabled, cooldown?, maxUses?, vipOnly?, requiredRoles?,
                      createdBy, createdAt, updatedAt, updatedBy }
```

## API surface (detail lives in the plan)

- `GET /api/commands` — merged list (builtin + custom) for the UI.
- `POST /api/commands` — create a custom command.
- `PATCH /api/commands/:name` — update a custom command or a built-in override.
- `DELETE /api/commands/:name` — delete a custom command (built-ins → 409).
- `POST /api/commands/:name/reset` — drop a built-in override, restoring code defaults.

Errors: `400` validation (field details), `404` unknown command, `409` name/alias
collision or illegal delete, `503` Mongo unavailable.

## Risks and mitigations

- **Bun + long-running Baileys socket.** Only module loading was verified locally. Mitigate
  with a container smoke test (boot, `/api/status` 200, "Successfully registered N commands"
  in logs) and a staged deploy; fallback documented: Node 24 + `tsx`.
- **Hono `@hono/node-server` on Bun** prints `Failed to find Response internal state key`
  but returned HTTP 200 in the proof run. Cosmetic; revisit if it becomes noisy.
- **Mongo unavailable at boot.** Built-ins still load; custom commands are unavailable and
  the API returns 503 until Mongo is back. The registry must never crash the bot.
- **Cache staleness across replicas.** 30 s TTL refresh; single replica is the assumed deployment.
- **Template/description XSS in the console.** Render with `textContent`, not `innerHTML`.
- **Operator expectation gap.** Web-added commands cannot contain custom logic. State this in
  the admin UI copy and in `docs/COMMANDS.md`; complex commands still ship as code.

## Rollout and rollback

- Deploy the new image; first boot creates the collection/index lazily. No data migration.
- Rollback = redeploy the previous image. `bot_commands` documents are ignored by old code.
- Docker CLI is unavailable on this workstation, so image verification is a documented
  manual/CI step in the plan rather than a local unit test.
