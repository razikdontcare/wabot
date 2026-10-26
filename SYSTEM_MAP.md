# SYSTEM_MAP.md

## Metadata
- **map_version**: 1.0.0
- **last_updated**: 2026-09-25
- **last_updated_by**: agent/zed

## Project Overview
WhatsApp bot with AI integration and modular command system. Built with TypeScript/Bun, using Baileys for WhatsApp connectivity and Hono for the API dashboard.

## Tech Stack
- **Language**: TypeScript
- **Runtime**: Bun
- **Package Manager**: Bun
- **Main Libraries**:
  - `baileys`: WhatsApp Web API
  - `hono`: Web framework for API and dashboard
  - `mongodb`: Persistence (auth, sessions, config, stats)
  - `ai`, `@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/deepseek`: AI integration
  - `sharp`, `jimp`: Image processing
  - `node-cron`: Task scheduling
  - `zod`: Schema validation

## Environment Variables
| Variable | Description |
| :--- | :--- |
| `MONGO_URI` | MongoDB connection string |
| `GROQ_API_KEY` | API key for Groq AI |
| `GOOGLE_GENERATIVE_AI_API_KEY` | API key for Google Generative AI |
| `TAVILY_API_KEY` | API key for Tavily search |
| `EXA_API_KEY` | API key for Exa search and extract (primary) |
| `API_USERNAME` | Username for Hono API basic auth |
| `API_PASSWORD` | Password for Hono API basic auth |
| `AI_PROVIDER` | AI provider routing (google, groq, openrouter, deepseek, auto) |
| `DASHBOARD_PORT` | Port for the Hono dashboard (default: 5000) |
| `DEEPSEEK_API_KEY` | API key for DeepSeek AI (VIP-only provider) |
| `SEND_MESSAGE_MAX_LENGTH` | Max characters for `/api/send-message` text (default: 4096) |
| `SEND_MESSAGE_RATE_MAX` | Max `/api/send-message` requests per IP per window (default: 60) |
| `SEND_MESSAGE_RATE_WINDOW_MS` | Rate-limit window for `/api/send-message` in ms (default: 60000) |

## Entry Points
| Type | File | Description |
| :--- | :--- | :--- |
| Bot | `src/index.ts` | Main entry point for starting the WhatsApp bot |
| API | `src/api.ts` | Entry point for the Hono HTTP server |

## Core Architecture
- **Application Layer (`src/app`)**: Bot client management, message routing, and command handling.
- **Domain Layer (`src/domain`)**: Business logic and services (AI, Sessions, VIP, Games).
- **Infrastructure Layer (`src/infrastructure`)**: External integrations (DB, Web server, Config).
- **Shared Layer (`src/shared`)**: Utilities, logger, and common types.

## File Registry

### Application Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/client/BotClient.ts` | Manages WA connection and event routing | `BotClient` | #app | #bot |
| `src/app/handlers/CommandHandler.ts` | Loads and executes bot commands | `CommandHandler` | #app | #bot |
| `src/app/handlers/CommandInterface.ts` | Command structure definitions | `CommandInterface`, `CommandInfo` | #app | #bot |
| `src/app/handlers/CooldownManager.ts` | Manages command rate limits | `CooldownManager` | #app | #bot |

### Domain Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/domain/services/AIConversationService.ts` | Manages AI chat history and context | `AIConversationService` | #domain | #ai |
| `src/domain/services/AIProviderRouterService.ts` | Routes requests to different AI providers | `AIProviderRouterService` | #domain | #ai |
| `src/domain/services/AIResponseService.ts` | Generates AI responses | `AIResponseService` | #domain | #ai |
| `src/domain/services/BotConfigService.ts` | Manages dynamic bot configuration in DB | `BotConfigService` | #domain | #config |
| `src/domain/services/CommandUsageService.ts` | Tracks command usage statistics | `CommandUsageService` | #domain | #stats |
| `src/domain/services/FreeGamesService.ts` | Checks and notifies about free games | `FreeGamesService` | #domain | #games |
| `src/domain/services/GameLeaderboardService.ts` | Manages game leaderboards | `GameLeaderboardService` | #domain | #games |
| `src/domain/services/GroupSettingService.ts` | Manages group-specific settings | `GroupSettingService` | #domain | #bot |
| `src/domain/services/HangmanGameService.ts` | Logic for Hangman game | `HangmanGameService` | #domain | #games |
| `src/domain/services/IGRSService.ts` | Integration with IGRS (game ratings) | `IGRSService` | #domain | #games |
| `src/domain/services/ReminderService.ts` | Manages user reminders | `ReminderService` | #domain | #utils |
| `src/domain/services/rpg/RpgEngine.ts` | Text RPG rules engine: movement, combat, items, deltas, defeat, party turns, votes | `createSoloRun`, `combatAction`, `partyCombatAction`, `resolveVote` | #domain | #games |
| `src/domain/services/rpg/RpgPresenter.ts` | Text RPG scenes, choices, party roster and views | `renderScene`, `buildChoices`, `renderPartyStatus` | #domain | #games |
| `src/domain/services/rpg/RpgRunService.ts` | MongoDB persistence for RPG runs (solo + party) | `RpgRunService` | #domain | #games |
| `src/domain/services/rpg/rpgContent.ts` | Static folklore world, archetypes, items and bestiary | `buildStaticRooms`, `RPG_WORLD` | #domain | #games |
| `src/domain/services/rpg/rpgRules.ts` | Pure RPG rules: dice, checks, damage, XP, inventory | `attackRoll`, `damageFor`, `gainXp` | #domain | #games |
| `src/domain/services/rpg/rpgSchemas.ts` | Zod contracts for RPG AI intent/narration/world/journal | `rpgIntentSchema`, `rpgSceneSchema`, `rpgWorldSchema` | #domain | #ai |
| `src/domain/services/rpg/RpgNarratorService.ts` | AI intent parsing, scene narration and journal compression (prose only) | `RpgNarratorService` | #domain | #ai |
| `src/domain/services/rpg/RpgWorldService.ts` | One-shot world bible generation with static fallback | `RpgWorldService` | #domain | #ai |
| `src/domain/services/rpg/RpgMapRenderer.ts` | Deterministic parchment map SVG → PNG with cache and text fallback | `renderMapPng`, `buildMapSvg` | #domain | #games |
| `src/domain/services/rpg/mapTheme.ts` | Map palette, medallion glyphs and terrain decoration | `MAP`, `medallionGlyph`, `terrainGlyph` | #domain | #games |
| `src/domain/services/SessionService.ts` | Manages user/group game sessions | `SessionService` | #domain | #bot |
| `src/domain/services/TixService.ts` | Integration with the unofficial TIX catalog API (cities, movies, catalog, theaters, schedules) | `TixService`, `findMoviesByTitle`, `jakartaDate` | #domain | #utils |
| `src/domain/services/UserPreferenceService.ts` | Manages user-specific preferences and structured memory graph | `UserPreferenceService`, `UserPreference` | #domain | #bot |
| `src/domain/services/VIPService.ts` | Manages VIP status and benefits | `VIPService` | #domain | #bot |

### Infrastructure Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/infrastructure/config/auth.ts` | MongoDB-backed auth state for Baileys | `useMongoDBAuthState` | #infra | #config |
| `src/infrastructure/config/config.ts` | Static and dynamic config initialization | `BotConfig`, `getCurrentConfig` | #infra | #config |
| `src/infrastructure/config/mongo.ts` | Atomic MongoDB client connection management | `getMongoClient`, `isMongoConnected`, `getActiveMongoClient` | #infra | #infra |
| `src/infrastructure/config/scheduler.ts` | Initializes cron jobs | `scheduleVIPCleanup`, etc. | #infra | #bot |
| `src/infrastructure/web/adminConsolePage.ts` | HTML rendering for admin dashboard | `renderAdminConsoleHtml` | #infra | #web |
| `src/infrastructure/web/adminConsoleBody.ts` | Admin console body markup | `ADMIN_CONSOLE_BODY` | #infra | #web |
| `src/infrastructure/web/adminConsoleStyles.ts` | Admin console stylesheet string | `ADMIN_CONSOLE_STYLES` | #infra | #web |
| `src/infrastructure/web/adminConsoleScript.ts` | Admin console client logic | `ADMIN_CONSOLE_SCRIPT` | #infra | #web |

### Shared Layer & Root
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/index.ts` | Bot entry point | None | #app | #bot |
| `src/api.ts` | API entry point and routes | `broadcastQRUpdate` | #infra | #web |
| `src/shared/logger/logger.ts` | Custom logging with buffer and redaction | `Logger`, `logBuffer` | #shared | #utils |
| `src/shared/types/types.ts` | Common TypeScript types | `Session`, `WebSocketInfo` | #shared | #types |
| `src/shared/utils/ai_tools.ts` | Consolidated helper and agent tools for AI interactions (filesystem, command exec, web search, web fetch, web extract) | `setCommandHandler`, `get_bot_commands`, `get_command_help`, `execute_bot_command`, `send_chat_message`, `reply_chat_message`, `send_chat_media`, `web_search`, `web_extract`, `list_files`, `read_file`, `write_file`, `delete_file`, `read_memory`, `update_memory`, `exec_command`, `web_fetch` | #shared | #ai |
| `src/shared/utils/ai_agent_tools.ts` | [DELETED 2026-06-16] Filesystem, execution and web tools for AI agents | N/A | #shared | #ai |
| `src/shared/utils/whatsapp_formatter.ts` | Formats standard Markdown to WhatsApp-compatible markup | `formatResponseForWhatsApp` | #shared | #utils |
| `src/shared/utils/ytdlp.ts` | YouTube download utility | `ytdlp` | #shared | #utils |
| `src/shared/utils/stickerProcessor.ts` | Sticker encoding: still (sharp) and animated (ffmpeg/libwebp_anim) WebP, EXIF pack metadata, WebP container normalisation for WhatsApp Web transparency | `addExif`, `createSticker`, `createAnimatedSticker`, `normalizeStickerWebp` | #shared | #utils |
| `src/shared/utils/commandCapture.ts` | Socket proxy that records the chat messages a bot command sends, so the AI can see command output and detect handled failures (❌ replies) | `createCommandCapture`, `classifyCommandOutcome`, `CapturedCommandMessage` | #shared | #ai |
| `src/shared/utils/groupDirectory.ts` | Joined-group directory: cached group listing, name/JID resolution, and group text sending used by the AI tools and `announce` | `fetchJoinedGroups`, `resolveGroup`, `sendGroupText`, `GroupSummary` | #shared | #utils |
| `src/shared/utils/userRoles.ts` | Role lookup that considers both the JID and LID identities Baileys may attach to a message | `getEffectiveUserIds`, `getUserRolesConsideringAlt`, `isAdminConsideringAlt` | #shared | #utils |

### Documentation
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `docs/SEND_MESSAGE_API.md` | Client integration guide for the `/api/send-message` endpoint (auth, JID formats, request/response, rate limits, examples) | N/A | #docs | #api |
| `docs/TEXT_RPG_DESIGN.md` | Design spec for the persistent text RPG (solo + party, engine-authoritative rules, AI narration contracts) | N/A | #docs | #games |

## API Surface
| Method | Path | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| GET | `/admin` | Admin Console Dashboard | Yes |
| GET | `/admin/styles.css` | Admin Console Stylesheet | Yes |
| GET | `/admin/app.js` | Admin Console Client Script | Yes |
| GET | `/api/logs` | Fetch recent bot logs | Yes |
| POST | `/api/logs/clear` | Clear log buffer | Yes |
| GET | `/api/logs/stream` | SSE stream for live logs | Yes |
| GET | `/api/command-usage` | Get command usage stats | Yes |
| GET | `/api/leaderboard` | Get game leaderboards | Yes |
| GET | `/api/ops` | Get runtime ops summary | Yes |
| POST | `/api/send-message` | Send a WhatsApp message via bot (basic-auth; validates JID/text, per-IP rate limited) | Yes |
| GET | `/api/config` | Get bot configuration | Yes |
| POST | `/api/config` | Update bot configuration | Yes |
| GET | `/api/qr` | Get current QR code as PNG | Yes |
| GET | `/api/status` | Get bot connection status | Yes |

## Data Models
| Model | Fields | Description |
| :--- | :--- | :--- |
| `Session` | `game`, `data`, `timestamp` | Represents an active user session (e.g. game) |
| `LogEntry` | `id`, `timestamp`, `level`, `message` | In-memory log representation |
| `BotConfig` | `prefix`, `admins`, `aiProvider`, etc. | Core bot settings |
| `AuthDocument` | `_id`, `data` (Binary) | MongoDB document for auth credentials |
| `SendMessageRequest` | `jid`, `text` | Body for `POST /api/send-message` (validated by zod `sendMessageSchema`) |
| `SendMessageResponse` | `success`, `messageId`, `jid`, `requestId` | Success payload for `POST /api/send-message` |

## Conventions
- **Naming**: `PascalCase` for files/classes, `camelCase` for variables/methods.
- **Imports**: Relative with `.js` extension (ESM compatibility).
- **Error Handling**: Standard `try-catch` with custom `Logger`.
- **Global State**: `globalThis.__botClient` used to share bot instance with API.
- **Gotcha**: `getMongoClient` uses a promise-based lock to prevent `MongoNotConnectedError` during concurrent initialization.
- **Gotcha**: To prevent `MongoNotConnectedError` when the database client is recreated, avoid caching `db` or `collection` objects in asynchronous closures; fetch them dynamically from the active client on each request.
- **Convention**: VIP-only providers (e.g. `deepseek`) are gated in `AskAICommand.handleProviderCommand` — the router itself is provider-agnostic.
- **Gotcha**: `POST /api/send-message` normalizes bare E.164 numbers to `@s.whatsapp.net` and only accepts `@s.whatsapp.net`/`@lid`/`@g.us`/`@broadcast`/`@newsletter` suffixes; it is rate limited in-memory per IP (see `docs/SEND_MESSAGE_API.md`).

## Data Flow: "!help" Command
1.  **Ingestion**: `BotClient` receives message via `baileys` socket event.
2.  **Routing**: `CommandHandler` identifies the command and prefix.
3.  **Validation**: Permission and maintenance checks performed.
4.  **Execution**: `CommandHandler.handleHelpCommand` generates list of commands.
5.  **Response**: `sock.sendMessage` dispatches response back to WhatsApp.

## Changelog
- **2026-04-28**: Initial map generated from full codebase scan (agent/initial-scan).
- **2026-04-28**: Added AI agent tools (filesystem, persistent memory) and integrated into AskAICommand.
- **2026-04-28**: Expanded agent tools with `exec_command` and `web_fetch` for full autonomy.
- **2026-06-12** [patch] (agent/9f57c17c-0398-4c84-ae1f-81ff772d93a7): Modified yt-dlp module and downloader command to parse and use -t mp4 preset option.
- **2026-06-12** [patch] (agent/9f57c17c-0398-4c84-ae1f-81ff772d93a7): Reversed TikTok user-agent behavior to default to yt-dlp native/default UA, and added --curl-ua flag for explicit curl UA.
- **2026-06-12** [patch] (agent/9f57c17c-0398-4c84-ae1f-81ff772d93a7): Added fallback mechanism to TTDL API with X-API-Key header from TTDL_API_KEY env for TikTok downloads.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added DeepSeek provider (deepseek-flash) as VIP-only option in AI provider routing.
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Merged `ai_agent_tools.ts` into `ai_tools.ts` for improved maintainability.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added `web_extract` tool utilizing Tavily's Extract API for clean page content extraction.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Optimized agent execution capability, step counts (30/60), context turns (40), Auto-RAG database search, status cleanup, and research keyword expansion.
- **2026-06-16** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added WhatsApp Formatting Critic, User Profile Memory Graph (MongoDB traits), and Specialized Multi-Agent Delegation (`delegate_task`).
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Fixed WhatsApp formatter regex replacement order for list bullets and images to prevent formatting collision bugs.
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Resolved `any` types in `DownloaderCommand.ts` fallback TikTok API response parser.
- **2026-06-16** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Fixed missing `deepseek` check in `UserPreferenceService.getAIProviderPreference` which caused fallback to openrouter.
- **2026-06-27** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Integrated Exa search and extract tools utilizing the exa-js SDK, with fallback mechanisms to Tavily API.
- **2026-06-27** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Made DeepSeek (deepseek-flash) the default provider for all users and removed the VIP restriction.
- **2026-06-27** [patch] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Fixed animated sticker transparent background glitch on WhatsApp Desktop/Web by changing pixel format to rgba.
- **2026-06-27** [minor] (agent/6b0e1efd-8c9d-4d88-97c0-16f329b7d8fe): Added auxiliary vision model pipeline in AskAICommand to process image inputs on text-only models (like DeepSeek).
- **2026-06-27** [patch] (agent/b4048922-83ae-4e2f-a6d8-c4636831e00c): Fixed database collection caching reconnect disconnects, progressive reconnection logout loop, implemented recursive wrapper message extraction, and integrated MongoDB-backed message store in BotClient.
- **2026-07-05** [patch] (agent/b4048922-83ae-4e2f-a6d8-c4636831e00c): Fixed sticker creation image format error by using safe TypedArray constructor instead of raw Buffer.buffer references.
- **2026-07-09** [patch] (agent/fd7a9281-1924-4aa3-b324-a8752de33779): Fixed MongoDB disconnection issues during WhatsApp reconnection by removing cached database/collection instances in all service classes and using dynamic getters.
- **2026-07-18** [patch] (agent/fd7a9281-1924-4aa3-b324-a8752de33779): Extended MongoDB lazy collection getter refactoring to remaining database services (AIConversationService, AIResponseService, SessionService) to prevent MongoNotConnectedError in all commands/AI pipeline.
- **2026-07-22** [patch] (agent/a30f8e9e-c934-4fe9-9cdd-1ee1b1271961): Separated AI step text from tool calling status log into distinct messages in AskAICommand and preserved working history status message after task completion.
- **2026-09-25** [minor] (agent/zed): Hardened `POST /api/send-message` with zod validation, safe JSON parsing, JID normalization/validation, per-IP rate limiting, request IDs, structured logging, and sanitized error responses.
- **2026-09-25** [patch] (agent/zed): Added `docs/SEND_MESSAGE_API.md` client integration guide for the send-message endpoint.
- **2026-10-24** [minor] (agent/zed): Added `tix` command (`TixCommand` + `TixService`) for TIX cinema listings, showtimes, theaters and catalog summaries via tix.razik.id.
- **2026-10-24** [patch] (agent/zed): TIX API now requires authentication; `TixService` sends `TIX_API_KEY` in the `x-api-key` header and reports missing/rejected keys with actionable messages.
- **2026-10-24** [patch] (agent/zed): Removed Qdrant knowledge-base tooling (Auto-RAG, `knowledge_search`/`upsert_knowledge` tools, `!ai kb` commands, `AIKnowledgeVectorService`, QDRANT_* env config) from the AI pipeline.
- **2026-10-24** [patch] (agent/zed): DeepSeek now handles image input natively; removed the auxiliary Google vision-description pipeline and added vision-aware routing (`requiresMultimodal`) that prefers a vision-capable provider and attaches image parts whenever the routed model supports them. Bumped `@ai-sdk/deepseek` to `^2.0.77`, the first 2.x release that forwards `image_url` parts.
- **2026-10-24** [minor] (agent/zed): Started the text RPG (M0): `rpg` command, engine-authored rules (dice/combat/items/movement), `rpg_runs` persistence, deterministic fallback narration, and unit tests. Design in `docs/TEXT_RPG_DESIGN.md`.
- **2026-10-24** [minor] (agent/zed): RPG M1 — AI narrator (`RpgNarratorService`, zod contracts, world bible with fallback), illustrated deterministic PNG map (`RpgMapRenderer` + `mapTheme`, cached) sent by `!rpg peta`, and DejaVu fonts in the runtime image.
- **2026-10-24** [minor] (agent/zed): RPG M2 — party mode: lobby/join/start, shared gold+inventory, 45s vote turns (early strict majority, lazy deadline), party combat with shared XP, owner migration, and party views. `!rpg peta` works for both modes.
- **2026-10-27** [patch] (agent/zed): Fixed animated stickers showing white blocks and a white square on WhatsApp Web. `stickerProcessor.addExif` now re-asserts the WebP `VP8X` alpha flag that `node-webpmux` dropped while re-muxing an animation (the alpha lives in the `ANMF` frames, not a top-level `ALPH` chunk), resets the `ANIM` background colour to transparent (`normalizeStickerWebp`), and `StickerCommand` sends `isAnimated` on sticker messages so WhatsApp Web uses the animated renderer. Added `tests/stickerProcessor.test.ts`.
- **2026-10-27** [minor] (agent/zed): Made `!ai` remember its own replies: `getAICompletion` now returns the texts actually delivered through `reply_message`/`send_message`/`send_media`, and `AskAICommand` stores them (and the group response) as the assistant turn.
- **2026-10-27** [minor] (agent/zed): Role-gated the dangerous AI tools (`exec_command`, `write_file`, `delete_file`, `list_files`, `read_file`, `update_memory`, `read_memory`) to admins only, with the shared prompt section now driven by `privileged` so non-admins are not told these tools exist.
- **2026-10-27** [minor] (agent/zed): `execute_bot_command` now returns the command's real outcome: `CommandHandler.executeCommandForAI` runs commands through a capturing socket proxy (`createCommandCapture`) and reports `Status` plus the chat messages/❌ errors the command produced, instead of assuming success whenever no exception was thrown. Added `tests/commandCapture.test.ts` and `tests/promptPrivileges.test.ts`.
- **2026-10-27** [minor] (agent/zed): Added admin group messaging: AI tools `list_groups`/`send_group_message` (admin-only, with dry-run preview and name/JID resolution via `GroupDirectory`) and the manual `announce` command (`announce list`, `announce <grup> | <pesan>`, JID target, or reply-to-message). Group lookups cache for 60s. Role checks now share `userRoles` helpers so LID/PN identities resolve consistently for commands and AI tools.
