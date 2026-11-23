# Command Management Guide

This guide explains the two kinds of commands the bot runs, what the admin console can
change at runtime, the template/validation rules, the `/api/commands` API, and the security
model behind it.

Related: [`SEND_MESSAGE_API.md`](./SEND_MESSAGE_API.md), [`../SYSTEM_MAP.md`](../SYSTEM_MAP.md),
design spec [`superpowers/specs/2026-11-11-ts-runtime-and-command-management-design.md`](./superpowers/specs/2026-11-11-ts-runtime-and-command-management-design.md).

---

## TL;DR

| Item | Value |
| :--- | :--- |
| Console | `http://<host>:<port>/admin` (HTTP Basic Auth), **Commands** section |
| API base | `/api/commands` (HTTP Basic Auth, JSON) |
| Built-in commands | TypeScript classes in `src/app/commands/` — 25 of them, loaded at boot |
| Custom commands | Plain-text response templates stored in MongoDB; no code is executed |
| Storage | Mongo database `BotConfig.sessionName` (default `meowbot`), collection `bot_commands` |
| Effect of a save | Visible to the running bot immediately on the same process; other replicas within ~30 s |
| Restart/rebuild needed | No — unless you need new *code* (new command behaviour) |

> **Rule of thumb:** if a command needs logic beyond a text reply (media, webhooks, API calls,
> games), it must ship as code in `src/app/commands/`. The web console is for canned text.

---

## Contents

1. [Built-in vs custom commands](#built-in-vs-custom-commands)
2. [Admin console](#admin-console)
3. [Response templates and placeholders](#response-templates-and-placeholders)
4. [Limits and validation rules](#limits-and-validation-rules)
5. [Built-in overrides](#built-in-overrides)
6. [Command API](#command-api)
7. [Error responses](#error-responses)
8. [Storage and cache](#storage-and-cache)
9. [Security model](#security-model)
10. [Runtime notes (direct TypeScript, no `dist/`)](#runtime-notes-direct-typescript-no-dist)
11. [Troubleshooting](#troubleshooting)

---

## Built-in vs custom commands

| | Built-in | Custom |
| :--- | :--- | :--- |
| Defined by | TypeScript class in `src/app/commands/*.ts` with a static `commandInfo` | Document in the `bot_commands` Mongo collection |
| Logic | Arbitrary code | Response text template only |
| Categories | `game`, `general`, `admin`, `utility` | `general`, `utility` |
| Edited from `/admin` | Enable/disable, aliases, description, help text, cooldown, max uses, roles, VIP flag | Everything except the name |
| Added/removed | Add/remove the file and deploy | Immediately, no deploy |
| `source` in the API | `"builtin"` | `"custom"` |
| Name | Fixed in code, immutable | Immutable after creation |

All 25 built-in command classes are discovered at boot by `commandLoader` (`selectCommandFiles`
+ dynamic `import()`), so the same code path works when Bun runs `.ts` directly.

**Core commands** — `games`, `help`, `stop`, `stats` — are handled directly by
`CommandHandler` before the registry is consulted. They are **not** listed by
`GET /api/commands` and cannot be overridden or deleted; their names are reserved, so creating
a custom command or alias with one of those names returns `409`.

Custom commands participate in the normal dispatch pipeline: they appear in `!help` (general /
utility sections, with ` (nonaktif)` appended when disabled), resolve through
`!help <name>`, and are exposed to the AI tools (`get_bot_commands`, `get_command_help`,
`execute_bot_command`). A disabled command never executes: chat replies with the disabled
message and the AI tool returns an error result instead.

---

## Admin console

Open `/admin` and sign in with the Basic Auth credentials, then use the **Commands** section.

| Action | How | Result |
| :--- | :--- | :--- |
| List / search / filter | Toolbar: search by name, alias or description; filter by source (`builtin`/`custom`) and status (`enabled`/`disabled`) | Table of merged commands |
| Create custom command | **New Command** → fill the form → **Create Command** | `POST /api/commands`, `201` |
| Edit custom command | **Edit** row → change fields → **Save Changes** | `PATCH /api/commands/:name` |
| Edit built-in override | **Edit** row (response/category fields are hidden; name is read-only) → **Save Override** | `PATCH /api/commands/:name` |
| Enable / disable | Click the status button in the **Status** column | `PATCH /api/commands/:name` with `{"enabled": false}`; `disabledReason` is editable for built-ins |
| Delete custom command | **Delete** row (confirmation prompt) | `DELETE /api/commands/:name` |
| Reset built-in override | **Reset** row (confirmation prompt) | `POST /api/commands/:name/reset` — restores code defaults |
| Refresh | **Refresh Commands** or wait for `admin:refresh` events from other console panels | Reloads `GET /api/commands` |

Notes:

- Saves refresh the in-process registry synchronously, so the bot answers with the new
  definition on the next message — no restart.
- The edit form sends only fields that changed. The API reports invalid roles as validation errors.
- The console renders every API string with `textContent` (never `innerHTML`); command names,
  descriptions and templates are displayed as text.
- Built-in rows hide the custom-only fields (`response`, `category`); name editing is disabled
  for all commands, because names are immutable.
- The console script is served from `/admin/commands.js` (also Basic Auth protected).

---

## Response templates and placeholders

A custom command's `response` is a `{{placeholder}}` text template rendered per message by
`DynamicCommand`:

```text
Halo {{args}}! Kamu {{user}} di {{chat}} ({{command}}). Sekarang {{date}} {{time}}.
```

Template rules:

- Placeholders are matched case-insensitively and tolerate inner whitespace:
  `{{args}}`, `{{ ARGS }}` and `{{Args}}` are the same.
- Unknown placeholders make the save fail with `400` (e.g. `{{bogus}}`).
- The rendered text is sent as a WhatsApp text message as-is; standard WhatsApp formatting
  (`*bold*`, `_italic_`) works.
- Missing positional arguments render as an empty string, not an error.

| Placeholder | Replaced with | Example output |
| :--- | :--- | :--- |
| `{{args}}` | All arguments joined with single spaces | `dunia baru` |
| `{{arg1}}` … `{{arg9}}` | The Nth positional argument (`""` when absent) | `{{arg2}}` of `dunia baru` → `baru` |
| `{{user}}` | Sender JID | `62811…@s.whatsapp.net` |
| `{{chat}}` | Chat JID where the command was invoked | `1201…@g.us` |
| `{{prefix}}` | Active command prefix | `!` |
| `{{botname}}` | Configured bot name | `Nexa AI` |
| `{{date}}` | Current date, `id-ID` locale | `11/11/2026` |
| `{{time}}` | Current time, `id-ID` locale | `21.30.00` |
| `{{command}}` | Canonical command name | `halo` |

All nine positional placeholders exist individually: `{{arg1}}`, `{{arg2}}`, `{{arg3}}`,
`{{arg4}}`, `{{arg5}}`, `{{arg6}}`, `{{arg7}}`, `{{arg8}}`, `{{arg9}}` (out-of-range positions
render as an empty string).

---

## Limits and validation rules

All names and aliases are trimmed and lowercased before validation and before comparison.

| Field | Rule | Applies to |
| :--- | :--- | :--- |
| `name` | `^[a-z0-9][a-z0-9_-]{0,31}$` — lowercase, starts alphanumeric, max 32 chars, immutable after create | custom |
| `aliases` | Up to **5**; same pattern; must be unique across every command name/alias and must not be a core command name | custom + built-in override |
| `description` | 1–200 chars (trimmed) | custom (required) + built-in override (optional) |
| `helpText` | ≤ 2000 chars (optional; empty string clears it) | custom + built-in override |
| `response` | 1–**4096** chars (the WhatsApp text cap used by this codebase) | custom only |
| `category` | `general` or `utility` (default `general`) | custom only |
| `enabled` | Boolean, default `true` | custom + built-in override |
| `cooldown` | Integer 0–86,400,000 **milliseconds**; per user per command | custom + built-in override |
| `maxUses` | Integer 1–1000; uses allowed inside the cooldown window (defaults to `1` when a cooldown is set) | custom + built-in override |
| `requiredRoles` | Up to **3** of `admin`, `moderator`, `vip`; any one role grants access | custom + built-in override |
| `vipOnly` | Boolean; non-VIP users are refused (admins still allowed) | custom + built-in override |
| `disabledReason` | ≤ 200 chars; shown in the chat reply when disabled | built-in override only |

Additional validation behaviour:

- Creating a name or alias that collides with any existing command name/alias, a core command,
  or with another alias in the same request fails with `409`.
- `POST` and `PATCH` bodies are strict: renaming (`name`) or sending unknown fields fails with
  `400` instead of being silently ignored.
- The name is immutable — delete + recreate a custom command to rename it.
- Custom commands support `enabled`, `cooldown`, `maxUses`, `vipOnly` and `requiredRoles`;
  they do **not** support `disabledReason` (that field exists only for built-in overrides).
- `vipBypassCooldown` is a compiled-in flag for built-in command classes; it is not exposed by
  the API or the console.

---

## Built-in overrides

Editing a built-in command stores an override document; the command **code is not modified**.
On each registry refresh the override is merged over the class's `static commandInfo`.

| Overridable field | Merge behaviour |
| :--- | :--- |
| `aliases` | The override **replaces** the code alias list (empty array removes all aliases) |
| `description` | Overrides code description |
| `helpText` | Overrides code help text |
| `cooldown`, `maxUses` | Overrides code values |
| `vipOnly` | Overrides code value |
| `requiredRoles` | Overrides code roles |
| `enabled` | `enabled = override.enabled ?? !info.disabled` |
| `disabledReason` | Shown when disabled; defaults to `Tidak ada alasan yang diberikan.` |

Not overridable: `name`, `response`, `category` and `vipBypassCooldown`. Audit fields
(`updatedAt`/`updatedBy`) are stored on the override document but are not exposed for built-ins
in `PublicCommandView`.

**Reset** (`POST /api/commands/:name/reset`) deletes the `builtin:<name>` override document,
restoring the code defaults. If another command uses an alias that reset would restore,
the API returns `409` and keeps the override. Deleting a built-in is refused (`409`). You can disable it.

---

## Command API

All routes live under `/api/*` and inherit the existing HTTP Basic Auth middleware
(`API_USERNAME` / `API_PASSWORD`). Bodies are JSON.

| Method | Path | Purpose | Success |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/commands` | List merged built-in + custom commands | `200 { "commands": PublicCommandView[] }` |
| `GET` | `/api/commands/:name` | Fetch one command (aliases resolve) | `200 { "command": PublicCommandView }` |
| `POST` | `/api/commands` | Create a custom command | `201 { "command": PublicCommandView }` |
| `PATCH` | `/api/commands/:name` | Update a custom command **or** a built-in override | `200 { "command": PublicCommandView }` |
| `DELETE` | `/api/commands/:name` | Delete a custom command (built-ins → `409`) | `200 { "message": "Command \"halo\" deleted" }` |
| `POST` | `/api/commands/:name/reset` | Drop a built-in override, restoring code defaults (customs → `409`) | `200 { "command": PublicCommandView }` |

Path matching is case-insensitive (the route lowercases `:name`). For **mutations**
(`PATCH`/`DELETE`/reset) use the canonical command name; an alias returns `404` because the
mutation is applied by name. `GET` resolves aliases.

### `PublicCommandView`

```jsonc
{
  "name": "halo",
  "aliases": ["hi"],
  "description": "Sapaan",
  "helpText": "Optional longer help",
  "category": "general",          // game | general | admin | utility
  "source": "custom",             // builtin | custom
  "enabled": true,
  "disabledReason": "…",          // when applicable
  "cooldown": 5000,               // ms, optional
  "maxUses": 3,                   // optional
  "vipOnly": false,               // optional
  "requiredRoles": ["admin"],     // optional
  "response": "Halo {{args}}!",   // custom commands only
  "updatedAt": "2026-11-11T…",    // custom commands only
  "updatedBy": "api"              // custom commands only
}
```

The `commandClass`/`customDefinition` internals are never exposed.

### Examples

Create a custom command (minimal body — defaults: `aliases: []`, `category: "general"`,
`enabled: true`):

```bash
curl -u admin:admin123 -X POST http://localhost:5000/api/commands \
  -H 'content-type: application/json' \
  -d '{"name":"halo","aliases":["hi"],"description":"Sapaan","response":"Halo {{args}}!"}'
```

List / fetch:

```bash
curl -u admin:admin123 http://localhost:5000/api/commands
curl -u admin:admin123 http://localhost:5000/api/commands/halo
```

Update a custom command (partial body; rename and unknown fields are rejected):

```bash
curl -u admin:admin123 -X PATCH http://localhost:5000/api/commands/halo \
  -H 'content-type: application/json' \
  -d '{"enabled":false,"description":"Sapaan (nonaktif)"}'
```

Disable a built-in, then restore it:

```bash
curl -u admin:admin123 -X PATCH http://localhost:5000/api/commands/search \
  -H 'content-type: application/json' \
  -d '{"enabled":false,"disabledReason":"maintenance"}'

curl -u admin:admin123 -X POST http://localhost:5000/api/commands/search/reset
```

Delete a custom command:

```bash
curl -u admin:admin123 -X DELETE http://localhost:5000/api/commands/halo
```

---

## Error responses

| Status | Meaning | Body shape (typical) |
| :--- | :--- | :--- |
| `400` | Invalid JSON, field validation failure, unknown placeholder, rename attempt, unknown field on `PATCH` | `{ "error": "Invalid request body", "details": [{ "field": "response", "message": "…" }] }` or `{ "error": "Request body must be valid JSON" }` |
| `401` | Missing/wrong Basic Auth credentials | Standard `WWW-Authenticate: Basic` challenge |
| `404` | Unknown command name (including an alias used on a mutation) | `{ "error": "Command \"x\" was not found" }` |
| `409` | Name/alias collision, reserved core command name, duplicate alias, deleting a built-in, or resetting a custom command | `{ "error": "…" }` |
| `503` | Mongo command store unavailable — built-in commands keep running; nothing was written | `{ "error": "Command storage is currently unavailable" }` |
| `500` | Unexpected server error (details only in server logs) | `{ "error": "Internal server error" }` |

Validation errors returned by the registry (as opposed to the request schemas) also map to
`400` with the same `details` array. A disabled command is not an API error: it stays listed
with `enabled: false` and its chat/AI dispatch returns the disabled result.

---

## Storage and cache

| Item | Value |
| :--- | :--- |
| Collection | `bot_commands` |
| Database | `BotConfig.sessionName` (default `meowbot`), reached through the existing Mongo client |
| Record ids | `builtin:<name>` for overrides, `custom:<name>` for custom commands |
| Indexes | Unique index on `name` (created lazily at first boot; a pre-existing duplicate-name collection logs a warning and keeps running) |
| Audit fields | `updatedAt`/`updatedBy` (`createdAt`/`createdBy` for customs); the API writes `updatedBy: "api"` |
| Migration | None — the collection starts empty. Deleting the docs (or rolling back the image) leaves inert data behind |
| In-process cache | Registry loads once at boot and after every write (synchronous refresh) |
| Cross-replica TTL | 30 seconds (`CommandRegistryService` default); lookups serve the cache and trigger a background refresh once stale |

Consequences:

- On a single replica, mutations run in sequence and each save is visible to the bot immediately.
- With multiple replicas, another instance picks up the change within ~30 s, then on the next
  command lookup.
- If Mongo is down at boot, built-in commands still load and the bot starts (a warning is
  logged); custom commands and writes return `503` until Mongo is reachable again.
- Rolling back the image is safe: old code ignores `bot_commands`.

---

## Security model

- **Authentication:** every `/api/*` route and the `/admin` console is protected by the same
  HTTP Basic Auth middleware. Credentials come from `API_USERNAME` / `API_PASSWORD`.
- **Change the default credentials.** The fallback is `admin` / `admin123`; set strong values
  (and serve over HTTPS — Basic Auth is base64, not encryption) before exposing the bot.
- **Custom commands are data, not code.** The web form stores text only; the bot never imports,
  evaluates or writes executable modules from the console. Command execution paths, media
  handling, webhooks and AI logic require a code change and a deploy.
- **Complex logic still ships as code.** Need a real feature? Add a command class in
  `src/app/commands/` (it is discovered automatically) and deploy. The console is for canned
  replies, aliases, enable/disable and built-in tuning.
- **No HTML injection in the console.** The Commands UI renders API/user strings with
  `textContent`, never `innerHTML`.
- **Least privilege available:** gate custom commands with `requiredRoles: ["admin"]` or
  `vipOnly` instead of creating a new admin category.
- **Audit trail is minimal by design:** stored records keep `createdBy`/`updatedBy` (set to
  `api` for web edits) but there is no separate audit-log collection (a documented non-goal).

---

## Runtime notes (direct TypeScript, no `dist/`)

- Production and Docker run `bun src/index.ts` (Bun 1.3.14, pinned). There is **no compile
  step** and no `dist/` directory in the image; `tsc` is only used as `tsc --noEmit` for
  typechecking (`bun run typecheck`).
- Dev: `bun run dev` (`bun --hot src/index.ts`); tests: `bun test`; Docker: two-stage
  `oven/bun:1.3.14-alpine` image that installs production dependencies and copies `src/`
  (including prompt `.md` files) plus `package.json`/`bun.lock`.
- Command classes are discovered by file extension at runtime (`.ts`/`.js`, `.d.ts` skipped),
  and worker-only modules (`worker.ts`, `stickerProcessor.ts`, `ffmpeg.ts`) are resolved from
  `src/` via `sourcePaths` — no environment/`dist` switch.
- The release workflow runs `bun run typecheck` after installing dependencies; it does not run
  the test suite (one pre-existing RPG test failure is tracked separately).

Operational checklist after a deploy:

1. `/api/status` returns JSON (HTTP 200).
2. Startup logs contain `Successfully registered <N> commands` and `API running on port …`.
3. `/admin` shows the **Commands** section with built-ins listed.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| `401 Unauthorized` on API/console | Wrong Basic Auth credentials | Use `API_USERNAME`/`API_PASSWORD`; change defaults in production |
| Create fails with `409` | Name/alias collides with a built-in, custom command, core command, or duplicate alias in the same payload | Pick a unique name/alias; check `GET /api/commands` |
| Save fails with `400` on `response` | Unknown `{{placeholder}}` or response outside 1–4096 chars | Use only the placeholders listed above |
| `PATCH` fails with `400` | Tried to rename (`name`) or send an unknown field | Names are immutable; remove unknown keys |
| `503` on any command API call | Mongo unavailable | Restore Mongo; built-in commands still work meanwhile |
| New command missing from `!help` | Command disabled (` (nonaktif)` suffix) or has an unexpected category | Enable it; custom commands use `general`/`utility` |
| Edit not visible on another instance | Cross-replica cache TTL | Wait ~30 s (or restart that instance) |
| `!search` still answers after disabling | Edit landed on a different replica | Check the instance serving the WhatsApp socket; keep one replica or wait for the TTL |
| Built-in override did not restore aliases | Override replaced the alias list | Use **Reset** to drop the override |
