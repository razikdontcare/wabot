/** Placeholders an admin may use in a custom command response template. */
export const COMMAND_TEMPLATE_PLACEHOLDERS = [
  "args",
  "arg1",
  "arg2",
  "arg3",
  "arg4",
  "arg5",
  "arg6",
  "arg7",
  "arg8",
  "arg9",
  "user",
  "chat",
  "prefix",
  "botname",
  "date",
  "time",
  "command",
] as const;

export interface CommandTemplateContext {
  args: string[];
  user: string;
  chat: string;
  prefix: string;
  botName: string;
  command: string;
  now?: Date;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9]+)\s*\}\}/gi;
const KNOWN_PLACEHOLDERS = new Set<string>(COMMAND_TEMPLATE_PLACEHOLDERS);
const POSITIONAL_ARG_PATTERN = /^arg([1-9])$/;

function resolvePlaceholder(
  placeholder: string,
  context: CommandTemplateContext,
  now: Date,
): string | undefined {
  if (placeholder === "args") {
    return context.args.join(" ");
  }

  const positional = POSITIONAL_ARG_PATTERN.exec(placeholder);
  if (positional) {
    return context.args[Number(positional[1]) - 1] ?? "";
  }

  switch (placeholder) {
    case "user":
      return context.user;
    case "chat":
      return context.chat;
    case "prefix":
      return context.prefix;
    case "botname":
      return context.botName;
    case "command":
      return context.command;
    case "date":
      return now.toLocaleDateString("id-ID");
    case "time":
      return now.toLocaleTimeString("id-ID");
    default:
      return undefined;
  }
}

/**
 * Replaces every known `{{placeholder}}` in a stored response template.
 * Unknown placeholders are left untouched; they are rejected on save.
 */
export function renderCommandTemplate(
  template: string,
  context: CommandTemplateContext,
): string {
  const now = context.now ?? new Date();

  return template.replace(PLACEHOLDER_PATTERN, (match, rawPlaceholder: string) => {
    const placeholder = rawPlaceholder.toLowerCase();
    return resolvePlaceholder(placeholder, context, now) ?? match;
  });
}

/**
 * Returns the unique unknown placeholder names in first-appearance order.
 * An empty array means the template is valid.
 */
export function validateCommandTemplate(template: string): string[] {
  const unknown: string[] = [];

  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[1].toLowerCase();
    if (
      !KNOWN_PLACEHOLDERS.has(placeholder) &&
      !POSITIONAL_ARG_PATTERN.test(placeholder) &&
      !unknown.includes(placeholder)
    ) {
      unknown.push(placeholder);
    }
  }

  return unknown;
}
