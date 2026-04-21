import { proto } from "baileys";
import { CommandInfo, CommandInterface } from "../handlers/CommandInterface.js";
import { WebSocketInfo } from "../../shared/types/types.js";
import { SessionService } from "../../domain/services/SessionService.js";
import { createFetchClient } from "../../shared/utils/fetchClient.js";

const MBG_IDR_RATE = 917800000000; // Rp 917,8 Miliar

export class CurrencyCommand extends CommandInterface {
  private client = createFetchClient();

  static commandInfo: CommandInfo = {
    name: "kurs",
    aliases: ["exchange", "currency", "uang"],
    category: "utility",
    commandClass: CurrencyCommand,
    description: "Konversi mata uang real-time",
    helpText: `*Penggunaan:*
• !kurs <jumlah> <mata_uang_asal> <mata_uang_tujuan>
• !kurs <mata_uang_asal> <mata_uang_tujuan>
• !kurs <jumlah> <mata_uang_asal>

*Contoh:*
!kurs 50 USD IDR
!kurs USD IDR (Default amount 1)
!kurs 100 JPY (Default tujuan IDR)
!kurs 2M IDR MBG (Easter egg: MBG)`,
  };

  async handleCommand(
    args: string[],
    jid: string,
    user: string,
    sock: WebSocketInfo,
    sessionService: SessionService,
    msg: proto.IWebMessageInfo,
  ): Promise<void> {
    if (args.length === 0 || args[0] === "help") {
      await sock.sendMessage(jid, {
        text: CurrencyCommand.commandInfo.helpText || "",
      });
      return;
    }

    try {
      let amount = 1;
      let fromCurrency = "";
      let toCurrency = "IDR";

      // Helper function to handle Indonesian abbreviations (e.g., 2m = 2000000000)
      const parseAmount = (val: string): number | null => {
        val = val.toLowerCase().replace(/,/g, "");
        let multiplier = 1;
        if (val.endsWith("k") || val.endsWith("rb") || val.endsWith("ribu"))
          multiplier = 1e3;
        else if (
          val.endsWith("jt") ||
          val.endsWith("juta") ||
          val.endsWith("j")
        )
          multiplier = 1e6;
        else if (
          val.endsWith("m") ||
          val.endsWith("miliar") ||
          val.endsWith("milyar") ||
          val.endsWith("b")
        )
          multiplier = 1e9;
        else if (val.endsWith("t") || val.endsWith("triliun"))
          multiplier = 1e12;

        const cleanVal = val.replace(/[a-z]/g, ""); // strip all letters
        const num = parseFloat(cleanVal);
        return isNaN(num) ? null : num * multiplier;
      };

      const parsedAmount = parseAmount(args[0]);

      if (parsedAmount !== null && !args[0].match(/^[a-zA-Z]{3}$/)) {
        // First arg is an amount
        amount = parsedAmount;
        if (args.length >= 3) {
          fromCurrency = args[1].toUpperCase();
          toCurrency = args[2].toUpperCase();
        } else if (args.length === 2) {
          fromCurrency = args[1].toUpperCase();
        } else {
          await sock.sendMessage(jid, {
            text: "Harap masukkan mata uang asal. Contoh: !kurs 50 USD",
          });
          return;
        }
      } else {
        // First arg is a currency
        fromCurrency = args[0].toUpperCase();
        if (args.length >= 2) {
          toCurrency = args[1].toUpperCase();
        }
      }

      await sock.sendMessage(jid, { react: { text: "🔄", key: msg.key } });

      // Handle custom local currencies (MBG)
      const isFromMBG = fromCurrency === "MBG";
      const isToMBG = toCurrency === "MBG";

      let fromQueryCurrency = isFromMBG ? "IDR" : fromCurrency;
      let toQueryCurrency = isToMBG ? "IDR" : toCurrency;

      // Fetch rates from open.er-api.com
      const response = await this.client.get<{
        result: string;
        rates: Record<string, number>;
      }>(`https://open.er-api.com/v6/latest/${fromQueryCurrency}`);
      const data = response.data;

      if (data.result !== "success") {
        await sock.sendMessage(jid, {
          text: `Gagal mendapatkan kurs untuk ${fromQueryCurrency}. Pastikan simbol mata uang benar. (Misal: IDR, USD, JPY)`,
        });
        return;
      }

      const rates = data.rates;

      if (!rates[toQueryCurrency]) {
        await sock.sendMessage(jid, {
          text: `Mata uang tujuan ${toQueryCurrency} tidak ditemukan.`,
        });
        return;
      }

      // Base conversion math
      let conversionRate = rates[toQueryCurrency];
      let finalAmount = amount * conversionRate;

      // Handle MBG easter egg
      if (isFromMBG && isToMBG) {
        finalAmount = amount; // MBG to MBG
      } else if (isFromMBG) {
        // From MBG to something else.
        // 1. Amount in MBG to IDR amount.
        const idrValue = amount * MBG_IDR_RATE;
        // 2. IDR to toCurrency
        finalAmount = idrValue * rates[toQueryCurrency];
      } else if (isToMBG) {
        // From something to MBG
        // 1. Convert amount to IDR
        const idrValue = amount * rates["IDR"]; // If fromQuery isn't IDR, it converts correctly because fromQuery is the base.
        // Wait, 'rates' are already relative to 'fromQueryCurrency'.
        // So amount in 'fromQueryCurrency' * rates['IDR'] gives the IDR equivalent.
        finalAmount = idrValue / MBG_IDR_RATE;
      }

      // Formatting
      const formatCurrency = (val: number, cur: string) => {
        if (cur === "MBG") {
          // Provide a clean format for MBG with up to 3 decimal places
          return `${parseFloat(val.toFixed(3))} hari MBG`;
        }

        let prefix = cur === "IDR" ? "Rp " : `${cur} `;

        // Minimalist number formatting
        if (cur !== "IDR" && val < 0.01) {
          return `${prefix}${val}`;
        }

        return `${prefix}${new Intl.NumberFormat("id-ID", { maximumFractionDigits: cur === "IDR" ? 0 : 2 }).format(val)}`;
      };

      const fromText = formatCurrency(amount, fromCurrency);
      const toText = formatCurrency(finalAmount, toCurrency);

      let replyText = `${fromText} = ${toText}`;

      // Extra minimalist flair for MBG
      if (isToMBG && !isFromMBG) {
        replyText = `Setara ${parseFloat(finalAmount.toFixed(4))} hari program MBG.`;
      } else if (isFromMBG && !isToMBG) {
        replyText = `${amount} hari MBG setara dengan ${toText}.`;
      }

      await sock.sendMessage(jid, { text: replyText });
    } catch (error) {
      console.error("[CurrencyCommand] Error:", error);
      await sock.sendMessage(jid, {
        text: "Terjadi kesalahan saat memproses kurs mata uang.",
      });
    }
  }
}
