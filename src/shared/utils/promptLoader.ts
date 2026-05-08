import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define path to the prompts directory
const PROMPTS_DIR = join(__dirname, "../../app/commands/prompts");

// Use simple string for fully dynamic personalities
export type AIPersonality = string;

// Dictionary mapping personality name -> filename
export const PERSONALITY_PROMPT_FILES: Record<string, string> = {};

// Array of valid personalities loaded
export const AI_PERSONALITIES: string[] = [];

// Auto-load personalities from file system
try {
  const files = readdirSync(PROMPTS_DIR);
  for (const file of files) {
    if (file.endsWith("-system-prompt.md")) {
      const personalityKey = file.replace("-system-prompt.md", "");
      PERSONALITY_PROMPT_FILES[personalityKey] = file;
      AI_PERSONALITIES.push(personalityKey);
    }
  }
} catch (error) {
  console.error("Failed to load AI personality prompts from directory:", error);
}

interface PromptContext {
  groupContext?: string;
  currentDate?: string;
  additionalInstructions?: string;
}

export interface KnownUserEntry {
  canonicalName: string;
  aliases: string[];
}

const DEFAULT_AI_PERSONALITY: AIPersonality = "nexa";
const knownUsersCache = new Map<string, KnownUserEntry[]>();

/**
 * Loads and parses a prompt template from a markdown file
 * @param promptFileName - The name of the prompt file (without path)
 * @param replacements - Optional key-value pairs for template replacements
 * @returns The processed prompt string
 */
export function loadPrompt(
  promptFileName: string,
  replacements?: Record<string, string>,
): string {
  try {
    // Construct path to the prompts directory
    const promptPath = join(PROMPTS_DIR, promptFileName);

    // Read the file
    let content = readFileSync(promptPath, "utf-8");

    // Apply replacements if provided
    if (replacements) {
      for (const [key, value] of Object.entries(replacements)) {
        const placeholder = `{{${key}}}`;
        content = content.replace(new RegExp(placeholder, "g"), value);
      }
    }

    return content;
  } catch (error) {
    console.error(`Error loading prompt file ${promptFileName}:`, error);
    throw new Error(`Failed to load prompt: ${promptFileName}`);
  }
}

function appendCommonPromptSections(
  prompt: string,
  context?: PromptContext,
): string {
  let result = prompt;

  // Add group context if provided
  if (context?.groupContext) {
    result += context.groupContext;
  }

  // Add bot command access information
  result += `\n\n## Bot Command Access
You have access to various bot commands through these tools:
- \`knowledge_search(query, scope?, limit?)\` - Search internal knowledge base (Qdrant vector DB)
- \`get_bot_commands(query?)\` - Get list of available bot commands (optionally filtered)
- \`get_command_help(commandName)\` - Get detailed help for a specific command
- \`execute_bot_command(commandName, args)\` - Execute a bot command safely
- \`send_message(text)\` - Send a new follow-up text message in the current chat
- \`reply_message(text)\` - Reply to the current user message with quoted context
- \`send_media(mediaType, url?, dataUrl?, caption?, fileName?, mimetype?, reply?)\` - Send an image, video, audio, or document from a URL or data URL
- \`list_files(path?)\` - List files in a directory (relative to bot root)
- \`read_file(path)\` - Read the content of a file
- \`write_file(path, content)\` - Write/Overwrite a file
- \`delete_file(path)\` - Delete a file
- \`update_memory(content, mode?)\` - Update your persistent memory in MEMORY.md (mode: 'append' or 'overwrite')
- \`exec_command(command)\` - Execute a shell command in the bot's workspace
- \`web_fetch(url, options?)\` - Advanced fetch (SSRF protected, cache, redirects, metadata, links, markdown)

**Agentic Capabilities:**
- You have persistent memory through \`MEMORY.md\`. Use \`read_file('MEMORY.md')\` to load your memory and \`update_memory()\` to save important facts, user preferences, or project state.
- Since you run in a Docker container, you have safe access to the filesystem. Use this to manage logs, temporary files, or knowledge documents.
- When the user asks you to "remember" something, use \`update_memory()\`.

**Command Usage Guidelines:**
- Use \`knowledge_search()\` first when user asks things that may relate to prior bot memory or stored documents
- Use \`get_bot_commands()\` when users ask about available features or "what can this bot do?"
- Use \`get_command_help()\` when users need help with a specific command
- Use \`execute_bot_command()\` when users want to perform actions like downloading, searching, or playing games
- Use \`reply_message()\` when the AI should answer directly to the user's current message, and use \`send_message()\` for follow-up messages that should appear as a new chat message
- Use \`send_media()\` when the best response is a file, image, video, audio clip, or document rather than plain text
- Prefer the smallest useful output; do not send redundant follow-up messages unless they add clear value
- Always explain what you're doing when executing commands
- Be helpful and proactive in suggesting relevant commands

**Response Planning:**
- Before answering, decide whether the best action is: answer in text, ask a clarification, reply to the current message, send a follow-up message, send media, or execute a bot command
- If the user intent is unclear, ask one short clarifying question instead of guessing
- If a tool can complete the user's request directly, use it instead of describing what you would do
- Keep the response compact unless the user explicitly wants detail

**Tool Selection Rules:**
- Use \`reply_message()\` for direct answers that should stay anchored to the user's current message
- Use \`send_message()\` for a second message, a follow-up, or a separate note that should appear as a new chat bubble
- Use \`send_media()\` when the requested outcome is better delivered as an image, video, audio clip, or document
- If the user asks for a file, screenshot, PDF, image, voice note, video, or attachment, prefer \`send_media()\` over plain text
- If you already sent a follow-up message, do not send a duplicate text version unless it adds new value
- When sending media, include a short caption only if it helps the user understand the file

**Memory Extraction:**
- Save only durable facts, preferences, recurring instructions, identities, or long-lived project decisions to \`MEMORY.md\`
- Do not save transient chat details, one-off tasks, or full conversation transcripts unless the user explicitly asks
- Prefer concise memory entries that are easy to reuse later
- When a user says to remember something, extract the smallest stable fact that is actually worth keeping

**Conversation Summarization:**
- When the conversation gets long, silently compress older context into a short mental summary before answering
- Keep only the active goal, the latest user intent, and any important constraints in focus
- Do not repeat the entire conversation back to the user unless they ask for a summary
- If an earlier thread is no longer relevant, drop it instead of carrying it forward

**Follow-up Awareness:**
- Track whether the current response should stand alone or be followed by a second message
- If the answer needs a short action note plus explanation, send the action note first and keep the explanation brief
- Avoid sending multiple near-duplicate messages in the same turn
- Only use follow-up messages when they improve clarity, completion, or user experience

**Media Intent Hints:**
- If the user mentions image, photo, screenshot, document, PDF, file, audio, voice note, video, or attachment, treat that as a strong hint to use \`send_media()\`
- If the user asks to "send", "share", "attach", "forward", or "give me the file", check whether media is the better output
- Use the requested format when possible instead of converting everything to text

**Response Preface:**
- Start with the direct answer or action, not a long preamble
- If a tool was used, briefly state the result in one short sentence
- Avoid filler phrases and avoid repeating the user's question unless it is necessary for clarity

**Final Output Rule:**
- You can only communicate back to the user through \`reply_message()\`, \`send_message()\`, and \`send_media()\`
- Put the actual user-facing response into \`reply_message()\` or \`send_message()\`
- Use \`send_media()\` when the answer should be delivered as a file or attachment
- Keep any final assistant text minimal or empty if the response has already been delivered through a tool

**Safety Notes:**
- Some commands may not be available in all contexts
- Command execution respects user permissions and cooldowns
- Game commands won't work if another game is already running
- Admin commands are restricted

`;

  // Add current date
  const dateToUse = context?.currentDate || new Date().toString();
  result += `Current Date : ${dateToUse}\n\n`;

  // Add any additional instructions
  if (context?.additionalInstructions) {
    result += `\n${context.additionalInstructions}\n`;
  }

  return result;
}

export function resolveAIPersonality(
  value?: string | null,
): AIPersonality | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  return AI_PERSONALITIES.includes(normalized as AIPersonality)
    ? (normalized as AIPersonality)
    : null;
}

/**
 * Loads a system prompt by personality with optional dynamic context
 */
export function loadPersonalityPrompt(
  personality: AIPersonality = DEFAULT_AI_PERSONALITY,
  context?: PromptContext,
): string {
  const promptFile =
    PERSONALITY_PROMPT_FILES[personality] ||
    PERSONALITY_PROMPT_FILES[DEFAULT_AI_PERSONALITY];
  const basePrompt = loadPrompt(promptFile);
  return appendCommonPromptSections(basePrompt, context);
}

export function getKnownUsersForPersonality(
  personality: AIPersonality = DEFAULT_AI_PERSONALITY,
): KnownUserEntry[] {
  const promptFile =
    PERSONALITY_PROMPT_FILES[personality] ||
    PERSONALITY_PROMPT_FILES[DEFAULT_AI_PERSONALITY];

  if (knownUsersCache.has(promptFile)) {
    return knownUsersCache.get(promptFile)!;
  }

  const prompt = loadPrompt(promptFile);
  const lines = prompt.split(/\r?\n/);
  const entries: KnownUserEntry[] = [];
  let inKnownUsersSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inKnownUsersSection) {
      if (/^##\s+KNOWN USERS\b/i.test(line)) {
        inKnownUsersSection = true;
      }
      continue;
    }

    if (/^##\s+/.test(line)) {
      break;
    }

    if (!line.startsWith("|")) {
      continue;
    }

    if (line.includes("---")) {
      continue;
    }

    const columns = line
      .split("|")
      .map((col) => col.trim())
      .filter(Boolean);

    if (columns.length === 0 || /^name$/i.test(columns[0])) {
      continue;
    }

    const aliases = columns[0]
      .split("/")
      .map((alias) => alias.trim())
      .filter(Boolean);

    if (aliases.length === 0) {
      continue;
    }

    entries.push({
      canonicalName: aliases[0],
      aliases,
    });
  }

  knownUsersCache.set(promptFile, entries);
  return entries;
}

/**
 * Loads the Nexa system prompt with optional dynamic context
 */
export function loadNexaPrompt(context?: PromptContext): string {
  return loadPersonalityPrompt("nexa", context);
}
