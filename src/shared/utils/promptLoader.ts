import {readFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

/**
 * Loads and parses a prompt template from a markdown file
 * @param promptFileName - The name of the prompt file (without path)
 * @param replacements - Optional key-value pairs for template replacements
 * @returns The processed prompt string
 */
export function loadPrompt(promptFileName: string, replacements?: Record<string, string>): string {
    try {
        // Get the directory of the current module
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);

        // Construct path to the prompts directory
        const promptPath = join(__dirname, '../../app/commands/prompts', promptFileName);

        // Read the file
        let content = readFileSync(promptPath, 'utf-8');

        // Apply replacements if provided
        if (replacements) {
            for (const [key, value] of Object.entries(replacements)) {
                const placeholder = `{{${key}}}`;
                content = content.replace(new RegExp(placeholder, 'g'), value);
            }
        }

        return content;
    } catch (error) {
        console.error(`Error loading prompt file ${promptFileName}:`, error);
        throw new Error(`Failed to load prompt: ${promptFileName}`);
    }
}

/**
 * Loads the Nexa system prompt with optional dynamic context
 */
export function loadNexaPrompt(context?: {
    groupContext?: string;
    currentDate?: string;
    additionalInstructions?: string;
}): string {
    let prompt = loadPrompt('nexa-system-prompt.md');

    // Add group context if provided
    if (context?.groupContext) {
        prompt += context.groupContext;
    }

    // Add bot command access information
    prompt += `\n\n## Bot Command Access
You have access to various bot commands through these tools:
- \`get_bot_commands(query?)\` - Get list of available bot commands (optionally filtered)
- \`get_command_help(commandName)\` - Get detailed help for a specific command
- \`execute_bot_command(commandName, args)\` - Execute a bot command safely

**Command Usage Guidelines:**
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
    prompt += `Current Date : ${dateToUse}\n\n`;

    // Add any additional instructions
    if (context?.additionalInstructions) {
        prompt += `\n${context.additionalInstructions}\n`;
    }

    return prompt;
}

