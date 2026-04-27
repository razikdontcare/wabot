import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { join, resolve } from "path";
import { exec } from "child_process";
import { log } from "../../infrastructure/config/config.js";

// New dependencies for enhanced web_fetch
import { promises as dns } from "dns";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import NodeCache from "node-cache";
import { parse } from "node-html-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import iconv from "iconv-lite";

// Restrict filesystem access to the current directory for safety
const ROOT_DIR = process.cwd() + "/workspaces/";

// Caches
const responseCache = new NodeCache({ stdTTL: 300, useClones: false }); // 5 minutes TTL
const robotsCache = new NodeCache({ stdTTL: 3600, useClones: false }); // 1 hour TTL

/**
 * Validates that a path is within the allowed ROOT_DIR
 */
function validatePath(filePath: string): string {
  const resolvedPath = resolve(ROOT_DIR, filePath);
  if (!resolvedPath.startsWith(ROOT_DIR)) {
    throw new Error(`Access denied: ${filePath} is outside the root directory.`);
  }
  return resolvedPath;
}

export async function list_files(path: string = "."): Promise<string> {
  try {
    const targetPath = validatePath(path);
    const files = readdirSync(targetPath, { withFileTypes: true });

    const fileList = files.map(file => {
      return `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`;
    }).join("\n");

    return `Files in ${path}:\n${fileList || "(empty)"}`;
  } catch (error) {
    log.error(`Error listing files in ${path}:`, error);
    return `Error listing files: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function read_file(path: string): Promise<string> {
  try {
    const targetPath = validatePath(path);
    if (!existsSync(targetPath)) {
      return `File not found: ${path}`;
    }

    const content = readFileSync(targetPath, "utf-8");
    // Limit content size to prevent context overflow
    if (content.length > 10000) {
      return content.substring(0, 10000) + "\n\n... (content truncated)";
    }
    return content;
  } catch (error) {
    log.error(`Error reading file ${path}:`, error);
    return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function write_file(path: string, content: string): Promise<string> {
  try {
    const targetPath = validatePath(path);
    writeFileSync(targetPath, content, "utf-8");
    return `Successfully wrote to ${path}`;
  } catch (error) {
    log.error(`Error writing file ${path}:`, error);
    return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function delete_file(path: string): Promise<string> {
  try {
    const targetPath = validatePath(path);
    if (!existsSync(targetPath)) {
      return `File not found: ${path}`;
    }
    unlinkSync(targetPath);
    return `Successfully deleted ${path}`;
  } catch (error) {
    log.error(`Error deleting file ${path}:`, error);
    return `Error deleting file: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Specialized tool for managing MEMORY.md
 */
export async function update_memory(content: string, mode: "append" | "overwrite" = "append"): Promise<string> {
  const memoryFile = "MEMORY.md";
  try {
    const targetPath = validatePath(memoryFile);
    if (mode === "append") {
      const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf-8") : "";
      const separator = existing.length > 0 ? "\n\n---\n\n" : "";
      const timestamp = new Date().toLocaleString();
      const newContent = `${existing}${separator}### Memory Entry (${timestamp})\n${content}`;
      writeFileSync(targetPath, newContent, "utf-8");
    } else {
      writeFileSync(targetPath, content, "utf-8");
    }
    return `Successfully updated ${memoryFile}`;
  } catch (error) {
    log.error(`Error updating memory:`, error);
    return `Error updating memory: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function exec_command(command: string): Promise<string> {
  return new Promise((resolve) => {
    // We execute in the root directory
    exec(command, { cwd: ROOT_DIR }, (error, stdout, stderr) => {
      if (error) {
        resolve(`Command failed with error: ${error.message}\nStderr: ${stderr}`);
        return;
      }
      resolve(stdout || stderr || "Command executed successfully with no output.");
    });
  });
}

/** Helper to check if an IP is private/loopback for SSRF protection */
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

/** Helper to check SSRF by resolving hostname */
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

/** Helper to fetch and check robots.txt */
async function checkRobotsTxt(urlObj: URL, userAgent: string = "WhatsAppFunBot/1.0"): Promise<void> {
  const origin = urlObj.origin;
  const robotsUrl = `${origin}/robots.txt`;
  
  let robots = robotsCache.get<any>(origin);
  
  if (!robots) {
    try {
      const res = await fetch(robotsUrl, { redirect: "follow", timeout: 5000 } as any);
      const text = res.ok ? await res.text() : "";
      robots = (robotsParser as any)(robotsUrl, text);
      robotsCache.set(origin, robots);
    } catch (err) {
      log.debug(`Failed to fetch robots.txt for ${origin}, assuming allowed.`);
      robots = (robotsParser as any)(robotsUrl, "");
      robotsCache.set(origin, robots);
    }
  }

  if (robots.isDisallowed(urlObj.href, userAgent)) {
    throw new Error(`Access denied by robots.txt for ${urlObj.href}`);
  }

  const crawlDelay = robots.getCrawlDelay(userAgent);
  if (crawlDelay) {
    if (crawlDelay > 5) {
      throw new Error(`Crawl-delay too long (${crawlDelay}s) for ${urlObj.href}`);
    }
    await new Promise(resolve => setTimeout(resolve, crawlDelay * 1000));
  }
}

export interface WebFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  allowList?: string[];
  blockList?: string[];
}

export async function web_fetch(
  url: string,
  options: WebFetchOptions = {},
): Promise<string> {
  const { 
    method = "GET", 
    headers = {}, 
    body, 
    timeout = 30000,
    allowList,
    blockList 
  } = options;

  let currentUrl = url;
  let redirectCount = 0;
  const maxRedirects = 10;
  const redirectChain = new Set<string>();

  // Check TTL Cache for GET requests
  const cacheKey = `GET:${currentUrl}`;
  if (method.toUpperCase() === "GET") {
    const cached = responseCache.get<string>(cacheKey);
    if (cached) {
      return `[CACHE HIT]\n${cached}`;
    }
  }

  let lastError: Error | null = null;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let urlObj: URL;
      try {
        urlObj = new URL(currentUrl);
      } catch (e) {
        throw new Error(`Invalid URL: ${currentUrl}`);
      }

      // Domain Allow/Block checks
      const domain = urlObj.hostname;
      if (allowList && allowList.length > 0 && !allowList.includes(domain)) {
        throw new Error(`Domain ${domain} is not in the allowList.`);
      }
      if (blockList && blockList.length > 0 && blockList.includes(domain)) {
        throw new Error(`Domain ${domain} is blocked.`);
      }

      // SSRF & Robots.txt checks
      await checkSSRF(urlObj);
      await checkRobotsTxt(urlObj);

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          "User-Agent": "WhatsAppFunBot/1.0",
          ...headers
        },
        body: body ?? undefined,
        signal: controller.signal,
        redirect: "manual", // Handle redirects manually
      };

      const response = await fetch(currentUrl, fetchOptions);
      clearTimeout(id);

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect status ${response.status} but no location header.`);
        }
        
        // Resolve relative URLs
        const nextUrl = new URL(location, currentUrl).href;
        
        if (redirectChain.has(nextUrl)) {
          throw new Error(`Infinite redirect loop detected at ${nextUrl}`);
        }
        
        if (redirectCount >= maxRedirects) {
          throw new Error(`Maximum redirect limit (${maxRedirects}) reached.`);
        }
        
        redirectChain.add(currentUrl);
        currentUrl = nextUrl;
        redirectCount++;
        
        // Follow redirect by retrying the loop immediately (not an exponential backoff retry)
        attempt = -1; 
        continue;
      }

      if (!response.ok) {
        // Transient errors for backoff
        if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
           throw new Error(`Transient error: ${response.status} ${response.statusText}`);
        }
        return `Failed to fetch ${currentUrl}: ${response.status} ${response.statusText}`;
      }

      // Binary Type Rejection
      const contentType = response.headers.get("content-type") || "";
      if (contentType && !contentType.includes("text/") && !contentType.includes("application/json") && !contentType.includes("application/xml")) {
        return `Error: Rejected binary content type (${contentType}).`;
      }

      // Streaming Size Cap (5MB)
      const MAX_SIZE = 5 * 1024 * 1024;
      let size = 0;
      const chunks: Uint8Array[] = [];
      
      if (response.body) {
        // @ts-ignore: Web ReadableStream as AsyncIterable (Node 18+)
        for await (const chunk of response.body) {
          chunks.push(chunk as Uint8Array);
          size += (chunk as Uint8Array).length;
          if (size > MAX_SIZE) {
            log.warn(`Response exceeded 5MB size cap. Truncating stream.`);
            break;
          }
        }
      }
      
      const buffer = Buffer.concat(chunks);

      // Charset decoding
      let charset = "utf-8";
      const match = contentType.match(/charset=([^;]+)/i);
      if (match) {
        charset = match[1].toLowerCase();
      } else {
        // Fallback: try to find it in the HTML meta tag
        const partialHtml = buffer.toString("utf8", 0, Math.min(buffer.length, 1024));
        const metaMatch = partialHtml.match(/<meta[^>]+charset=['"]?([^>'"\s]+)['"]?/i);
        if (metaMatch) charset = metaMatch[1].toLowerCase();
      }

      let text = "";
      try {
        if (iconv.encodingExists(charset)) {
          text = iconv.decode(buffer, charset);
        } else {
          text = buffer.toString("utf8");
        }
      } catch (e) {
        text = buffer.toString("utf8");
      }

      // If it's JSON, just return it directly (formatted)
      if (contentType.includes("application/json")) {
        let result = text;
        if (text.length > 20000) {
          result = text.substring(0, 20000) + "\n\n[... content truncated ...]";
        }
        if (method.toUpperCase() === "GET") responseCache.set(cacheKey, result);
        return result;
      }

      // HTML Parsing and Markdown Conversion
      const root = parse(text);
      
      // Extract Metadata
      const metadata: Record<string, string> = {};
      const titleNode = root.querySelector("title");
      if (titleNode) metadata["Title"] = titleNode.text.trim();
      
      const metas = root.querySelectorAll("meta");
      for (const meta of metas) {
        const name = meta.getAttribute("name") || meta.getAttribute("property");
        const content = meta.getAttribute("content");
        if (name && content) {
          if (["description", "keywords", "author", "article:published_time"].includes(name.toLowerCase()) || name.toLowerCase().startsWith("og:") || name.toLowerCase().startsWith("twitter:")) {
             metadata[name] = content.trim();
          }
        }
      }
      
      const canonical = root.querySelector('link[rel="canonical"]');
      if (canonical) metadata["Canonical"] = canonical.getAttribute("href") || "";

      // Extract Links
      const linksNode = root.querySelectorAll("a");
      const links = linksNode.slice(0, 50).map(a => {
        return `[${a.text.trim() || 'link'}](${a.getAttribute("href") || ''}) ${a.getAttribute("rel") ? `rel="${a.getAttribute("rel")}"` : ''}`;
      }).filter(l => l !== "[link]() " && l !== "[link]()");

      // Extract Images
      const imgsNode = root.querySelectorAll("img");
      const images = imgsNode.slice(0, 20).map(img => {
        return `![${img.getAttribute("alt") || ''}](${img.getAttribute("src") || ''})`;
      }).filter(i => i !== "![](null)" && i !== "![]()");

      // Remove scripts and styles before Markdown conversion
      root.querySelectorAll('script, style, noscript, iframe, svg').forEach(el => el.remove());
      
      // Convert to Markdown
      const nhm = new NodeHtmlMarkdown();
      let markdown = nhm.translate(root.innerHTML);

      // Token budget truncation (20k chars)
      if (markdown.length > 20000) {
        markdown = markdown.substring(0, 20000) + "\n\n[... content truncated ...]";
      }

      // Format output
      let finalOutput = `# Metadata\n`;
      for (const [k, v] of Object.entries(metadata)) {
        finalOutput += `- **${k}**: ${v}\n`;
      }
      finalOutput += `\n# Content\n${markdown}\n`;
      
      if (links.length > 0) {
        finalOutput += `\n# Extracted Links (Top ${links.length})\n${links.join("\n")}\n`;
      }
      if (images.length > 0) {
        finalOutput += `\n# Extracted Images (Top ${images.length})\n${images.join("\n")}\n`;
      }

      if (method.toUpperCase() === "GET") {
        responseCache.set(cacheKey, finalOutput);
      }

      return finalOutput;
      
    } catch (error: any) {
      lastError = error as Error;
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(`Request timed out after ${timeout}ms`);
      }
      
      const isTransient = error instanceof Error && (error.message.includes("Transient error") || error.message.includes("ECONNRESET") || error.message.includes("ETIMEDOUT") || error.message.includes("fetch failed"));
      
      if (isTransient && attempt < maxRetries) {
        const baseDelay = 1000;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        log.warn(`Transient error fetching ${currentUrl}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      break; 
    }
  }

  return `Error fetching URL: ${lastError?.message || "Unknown error"}`;
}
