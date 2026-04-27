import { promises as dns } from "dns";
import ipaddr from "ipaddr.js";
import robotsParser from "robots-parser";
import NodeCache from "node-cache";
import { parse } from "node-html-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import iconv from "iconv-lite";

console.log("Imports successful");
console.log(typeof NodeCache, typeof robotsParser, typeof NodeHtmlMarkdown, typeof iconv.decode, typeof ipaddr.parse);
