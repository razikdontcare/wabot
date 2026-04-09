import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import {
  getCurrentConfig,
  getUserRoles,
  log,
} from "../../infrastructure/config/config.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";

const WG_API_URL = process.env.WG_API_URL || "http://host.docker.internal:3001";
const WG_API_SECRET = process.env.WG_API_SECRET || "";
const WG_REQUEST_TIMEOUT_MS = 20000;
const VPN_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface AddVpnPeerResponse {
  name: string;
  ip: string;
  clientConfig: string;
  privateKey?: string;
  publicKey?: string;
}

interface AddVpnPeerError {
  error?: string;
  message?: string;
}

export class AddVpnCommand extends CommandInterface {
  static commandInfo: CommandInfo = {
    name: "addvpn",
    aliases: ["wireguard", "wgadd"],
    description: "Create WireGuard profile (admin only)",
    helpText: `*Usage:*
• /addvpn <nama>

*Contoh:*
• /addvpn hp-baru

*Catatan:*
• Hanya admin bot yang bisa memakai command ini.
• Nama hanya boleh huruf, angka, dash (-), dan underscore (_).`,
    category: "admin",
    commandClass: AddVpnCommand,
    requiredRoles: ["admin"],
    cooldown: 5000,
    maxUses: 3,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    _sessionService: SessionService,
    _msg: proto.IWebMessageInfo,
  ): Promise<void> {
    void _sessionService;
    void _msg;

    const config = await getCurrentConfig();
    const userRoles = await getUserRoles(user);

    if (!userRoles.includes("admin")) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Hanya admin yang dapat menggunakan command ini.`,
      });
      return;
    }

    const name = args.join(" ").trim();
    if (!name) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.info} Usage: /addvpn <nama>`,
      });
      return;
    }

    if (!VPN_NAME_PATTERN.test(name)) {
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Nama tidak valid. Gunakan huruf, angka, dash (-), atau underscore (_).`,
      });
      return;
    }

    await sock.sendMessage(jid, {
      text: `${config.emoji.info} Membuat profile WireGuard untuk *${name}*...`,
    });

    try {
      const peer = await this.addVpnPeer(name);

      await sock.sendMessage(jid, {
        text: `${config.emoji.success} Client *${peer.name}* berhasil ditambahkan.\nIP: \`${peer.ip}\`\n\nMengirim file konfigurasi...`,
      });

      await sock.sendMessage(jid, {
        document: Buffer.from(peer.clientConfig, "utf-8"),
        fileName: `${peer.name}.conf`,
        mimetype: "text/plain",
      });
    } catch (error) {
      log.error("Error in addvpn command:", error);
      await sock.sendMessage(jid, {
        text: `${config.emoji.error} Error: ${error instanceof Error ? error.message : "Gagal menambahkan peer WireGuard."}`,
      });
    }
  }

  private async addVpnPeer(name: string): Promise<AddVpnPeerResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      WG_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${WG_API_URL}/add-peer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-secret": WG_API_SECRET,
        },
        body: JSON.stringify({ name }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorPayload =
          await this.parseJsonSafely<AddVpnPeerError>(response);
        throw new Error(
          errorPayload?.error ||
            errorPayload?.message ||
            `Gagal tambah peer (HTTP ${response.status}).`,
        );
      }

      const payload = await this.parseJsonSafely<AddVpnPeerResponse>(response);
      if (!payload || !payload.name || !payload.ip || !payload.clientConfig) {
        throw new Error("Respons WireGuard API tidak lengkap.");
      }

      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request ke WireGuard API timeout.");
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error("Gagal menambahkan peer WireGuard.");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseJsonSafely<T>(response: Response): Promise<T | null> {
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }
}
