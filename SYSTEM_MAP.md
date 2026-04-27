# SYSTEM_MAP.md

## Metadata
- **map_version**: 1.0.0
- **last_updated**: 2026-04-28
- **last_updated_by**: agent/initial-scan

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
  - `ai`, `@ai-sdk/google`, `@ai-sdk/groq`: AI integration
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
| `API_USERNAME` | Username for Hono API basic auth |
| `API_PASSWORD` | Password for Hono API basic auth |
| `AI_PROVIDER` | AI provider routing (google, groq, auto) |
| `DASHBOARD_PORT` | Port for the Hono dashboard (default: 5000) |

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
| `src/domain/services/AIKnowledgeVectorService.ts` | Vector search integration for AI knowledge | `AIKnowledgeVectorService` | #domain | #ai |
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
| `src/domain/services/SessionService.ts` | Manages user/group game sessions | `SessionService` | #domain | #bot |
| `src/domain/services/UserPreferenceService.ts` | Manages user-specific preferences | `UserPreferenceService` | #domain | #bot |
| `src/domain/services/VIPService.ts` | Manages VIP status and benefits | `VIPService` | #domain | #bot |

### Infrastructure Layer
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/infrastructure/config/auth.ts` | MongoDB-backed auth state for Baileys | `useMongoDBAuthState` | #infra | #config |
| `src/infrastructure/config/config.ts` | Static and dynamic config initialization | `BotConfig`, `getCurrentConfig` | #infra | #config |
| `src/infrastructure/config/mongo.ts` | Atomic MongoDB client connection management | `getMongoClient`, `isMongoConnected` | #infra | #infra |
| `src/infrastructure/config/scheduler.ts` | Initializes cron jobs | `scheduleVIPCleanup`, etc. | #infra | #bot |
| `src/infrastructure/web/adminConsolePage.ts` | HTML rendering for admin dashboard | `renderAdminConsoleHtml` | #infra | #web |

### Shared Layer & Root
| Path | Purpose | Exports | #layer | #domain |
| :--- | :--- | :--- | :--- | :--- |
| `src/index.ts` | Bot entry point | None | #app | #bot |
| `src/api.ts` | API entry point and routes | `broadcastQRUpdate` | #infra | #web |
| `src/shared/logger/logger.ts` | Custom logging with buffer and redaction | `Logger`, `logBuffer` | #shared | #utils |
| `src/shared/types/types.ts` | Common TypeScript types | `Session`, `WebSocketInfo` | #shared | #types |
| `src/shared/utils/ai_tools.ts` | Helper tools for AI interactions | `setCommandHandler` | #shared | #ai |
| `src/shared/utils/ytdlp.ts` | YouTube download utility | `ytdlp` | #shared | #utils |

## API Surface
| Method | Path | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| GET | `/admin` | Admin Console Dashboard | Yes |
| GET | `/api/logs` | Fetch recent bot logs | Yes |
| POST | `/api/logs/clear` | Clear log buffer | Yes |
| GET | `/api/logs/stream` | SSE stream for live logs | Yes |
| GET | `/api/command-usage` | Get command usage stats | Yes |
| GET | `/api/leaderboard` | Get game leaderboards | Yes |
| POST | `/api/send-message` | Send a WhatsApp message via bot | Yes |
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

## Conventions
- **Naming**: `PascalCase` for files/classes, `camelCase` for variables/methods.
- **Imports**: Relative with `.js` extension (ESM compatibility).
- **Error Handling**: Standard `try-catch` with custom `Logger`.
- **Global State**: `globalThis.__botClient` used to share bot instance with API.
- **Gotcha**: `getMongoClient` uses a promise-based lock to prevent `MongoNotConnectedError` during concurrent initialization.

## Data Flow: "!help" Command
1.  **Ingestion**: `BotClient` receives message via `baileys` socket event.
2.  **Routing**: `CommandHandler` identifies the command and prefix.
3.  **Validation**: Permission and maintenance checks performed.
4.  **Execution**: `CommandHandler.handleHelpCommand` generates list of commands.
5.  **Response**: `sock.sendMessage` dispatches response back to WhatsApp.

## Changelog
- **2026-04-28**: Initial map generated from full codebase scan (agent/initial-scan).
