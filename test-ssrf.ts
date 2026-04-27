import { promises as dns } from "dns";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import NodeCache from "node-cache";
import { parse } from "node-html-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import iconv from "iconv-lite";

// Caches
const responseCache = new NodeCache({ stdTTL: 300 }); // 5 minutes TTL
const robotsCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

function isPrivateIP(ipStr: string): boolean {
  try {
    const ip = ipaddr.parse(ipStr);
    const range = ip.range();
    return (
      range === "private" ||
      range === "loopback" ||
      range === "linkLocal" ||
      range === "broadcast" ||
      range === "multicast" ||
      range === "carrierGradeNat" ||
      range === "reserved" ||
      range === "unspecified"
    );
  } catch (e) {
    return false;
  }
}

async function checkSSRF(urlObj: URL): Promise<void> {
  const hostname = urlObj.hostname;
  
  if (ipaddr.isValid(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`SSRF Blocked: IP ${hostname} is private/restricted.`);
    }
    return;
  }

  try {
    const records = await dns.lookup(hostname);
    if (isPrivateIP(records.address)) {
      throw new Error(`SSRF Blocked: Hostname ${hostname} resolves to private IP ${records.address}.`);
    }
  } catch (err) {
    throw new Error(`Failed to resolve hostname ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
    try {
        await checkSSRF(new URL("http://127.0.0.1"));
        console.log("Failed to block 127.0.0.1");
    } catch(e: any) {
        console.log("Successfully blocked 127.0.0.1:", e.message);
    }
    try {
        await checkSSRF(new URL("https://example.com"));
        console.log("Successfully allowed example.com");
    } catch(e: any) {
        console.log("Failed to allow example.com:", e.message);
    }
}
main();
