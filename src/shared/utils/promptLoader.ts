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

const DEFAULT_AI_PERSONALITY: AIPersonality = "nexa";

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
- Always explain what you're doing when executing commands
- Be helpful and proactive in suggesting relevant commands

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

/**
 * Loads the Nexa system prompt with optional dynamic context
 */
export function loadNexaPrompt(context?: PromptContext): string {
  return loadPersonalityPrompt("nexa", context);
}
