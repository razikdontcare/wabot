import { describe, expect, it } from "bun:test";
import { ADMIN_CONSOLE_COMMANDS_BODY } from "../src/infrastructure/web/adminConsoleCommandsBody.js";
import { ADMIN_CONSOLE_COMMANDS_STYLES } from "../src/infrastructure/web/adminConsoleCommandsStyles.js";
import { renderAdminConsoleHtml } from "../src/infrastructure/web/adminConsolePage.js";
import { ADMIN_CONSOLE_STYLES } from "../src/infrastructure/web/adminConsoleStyles.js";

// Contract shared with the command management script (Plan Task 10): every
// element the script queries by id must exist in the rendered page.
const COMMAND_CONSOLE_IDS = [
  "commands",
  "commandsTableBody",
  "commandSearch",
  "commandSourceFilter",
  "commandStatusFilter",
  "newCommandBtn",
  "refreshCommandsBtn",
  "commandsMeta",
  "commandFormPanel",
  "commandForm",
  "commandFormTitle",
  "cmdName",
  "cmdAliases",
  "cmdDescription",
  "cmdCategory",
  "cmdResponse",
  "cmdCooldown",
  "cmdMaxUses",
  "cmdVipOnly",
  "cmdRequiredRoles",
  "cmdEnabled",
  "cmdDisabledReason",
  "cmdHelpText",
  "cmdFormFeedback",
  "cancelCommandBtn",
] as const;

describe("admin console commands section", () => {
  it("is reachable from the navigation and present in the rendered page", () => {
    const html = renderAdminConsoleHtml();

    expect(html).toContain('href="#commands"');
    expect(html).toContain('id="commands"');
    expect(html).toContain("commandsTableBody");
    expect(ADMIN_CONSOLE_COMMANDS_BODY).toContain('id="commandSearch"');
    expect(html).toContain('src="/admin/commands.js"');
  });

  it("lists Commands in the navigation after Usage", () => {
    const html = renderAdminConsoleHtml();

    expect(html.indexOf('href="#commands"')).toBeGreaterThan(
      html.indexOf('href="#analytics"'),
    );
  });

  it.each(COMMAND_CONSOLE_IDS)("renders the #%s element", (id) => {
    expect(renderAdminConsoleHtml()).toContain(`id="${id}"`);
  });

  it("composes the commands stylesheet into the served CSS", () => {
    expect(ADMIN_CONSOLE_STYLES).toContain(ADMIN_CONSOLE_COMMANDS_STYLES);
    expect(ADMIN_CONSOLE_COMMANDS_STYLES).toContain(".commands-toolbar");
  });
});
