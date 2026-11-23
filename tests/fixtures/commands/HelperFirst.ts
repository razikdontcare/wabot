import type { proto } from "baileys";
import {
  CommandInfo,
  CommandInterface,
} from "../../../src/app/handlers/CommandInterface.js";
import type { SessionService } from "../../../src/domain/services/SessionService.js";
import type { WebSocketInfo } from "../../../src/shared/types/types.js";

/**
 * Plain helper export. It sorts before the command class in the ESM namespace,
 * which is exactly the ambiguous case the loader must skip over.
 */
export const AAAHelper = (value: string): string => value.trim();

export class HelperFirstCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "helperfirst",
    aliases: [],
    description: "Fixture command used to test loader export selection.",
    category: "general",
    commandClass: HelperFirstCommand,
  };

  async handleCommand(
    _args: string[],
    _jid: string,
    _user: string,
    _sock: WebSocketInfo,
    _sessionService: SessionService,
    _msg: proto.IWebMessageInfo,
  ): Promise<void> {
    // Fixture only: the loader test never executes this command.
  }
}
