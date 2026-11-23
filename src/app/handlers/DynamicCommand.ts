import type { proto } from "baileys";
import { CommandInterface } from "./CommandInterface.js";
import type { SessionService } from "../../domain/services/SessionService.js";
import type { CustomCommandDefinition } from "../../domain/models/CommandDefinition.js";
import { BotConfig, getCurrentConfig } from "../../infrastructure/config/config.js";
import { renderCommandTemplate } from "../../shared/utils/commandTemplates.js";
import type { WebSocketInfo } from "../../shared/types/types.js";

/**
 * Executes an admin-created, data-only custom command: it renders the stored
 * `{{placeholder}}` response template and sends it to the chat. No code from
 * the web UI is ever executed.
 */
export class DynamicCommand extends CommandInterface {
  constructor(
    private readonly definition: CustomCommandDefinition,
    private readonly resolveConfig: () => Promise<
      typeof BotConfig
    > = getCurrentConfig,
  ) {
    super();
  }

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    _msg: proto.IWebMessageInfo,
  ): Promise<void> {
    const config = await this.resolveConfig();
    const text = renderCommandTemplate(this.definition.response, {
      args,
      user,
      chat: jid,
      prefix: config.prefix,
      botName: config.name,
      command: this.definition.name,
    });

    await sock.sendMessage(jid, { text });
  }
}
