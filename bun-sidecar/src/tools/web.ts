/**
 * tools/web.ts — 一等 Web 研究工具：web_search + web_fetch。
 *
 * 安全边界：
 * - 只允许 http/https，拒绝 URL 凭据、localhost、云元数据地址、私网/链路本地/
 *   CGNAT/组播地址与常见内网服务端口。
 * - 每一跳重定向都重新做同一套 URL 检查；最多 5 跳。
 * - 响应只接受 text/html / text/plain / application/xhtml+xml，正文最多 2MB，
 *   超时 15s；二进制内容明确拒绝。
 * - 搜索走 DuckDuckGo HTML 端点，不依赖 API Key；结果保留来源 URL 与抓取时间。
 * - DNS 解析和实际连接之间仍存在 rebinding 窗口，这是本工具已知边界，不宣称
 *   等同于 OS 级网络沙箱。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.com",
  "instance-data.ec2.internal",
]);
const BLOCKED_PORTS = new Set([22, 23, 25, 135, 137, 138, 139, 445, 1433, 1521, 3306, 5432, 6379, 11211, 27017]);

function result(text: string, details?: unknown): MaxmaToolResult {
  return { content: [{ type: "text", text }], details };
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
}

/** 私网/保留地址判定（IPv4 + IPv6，含 IPv4-mapped）。 */
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    if (a === undefined || b === undefined) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (isIP(normalized) === 6) {
    const lower = normalized.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true;
}

function assertUrlSyntax(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL 格式无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("只允许 http/https URL");
  if (url.username || url.password) throw new Error("URL 不允许包含凭据");
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new Error("URL 缺少主机名");
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("拒绝访问本机/内网/云元数据地址");
  }
  if (url.port && BLOCKED_PORTS.has(Number(url.port))) throw new Error("拒绝访问常见内网服务端口");
  return url;
}

/** 解析 DNS 并拒绝任何私网结果；返回最终 URL。 */
export async function assertPublicUrl(raw: string, resolver: typeof lookup = lookup): Promise<URL> {
  const url = assertUrlSyntax(raw);
  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("拒绝访问私网/保留地址");
    return url;
  }
  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await resolver(hostname, { all: true });
  } catch {
    throw new Error(`DNS 解析失败：${hostname}`);
  }
  if (addresses.length === 0) throw new Error(`DNS 无解析结果：${hostname}`);
  for (const item of addresses) {
    if (isPrivateAddress(item.address)) throw new Error(`域名解析到私网地址：${hostname} → ${item.address}`);
  }
  return url;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&ensp;|&emsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function stripHtml(html: string, maxChars: number): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|header|footer|li|tr|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(withoutNoise)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[内容已截断，原始字符数：${text.length}]` : text;
}

export interface ParsedPage {
  title: string;
  text: string;
  links: Array<{ title: string; url: string }>;
}

export function parseHtmlPage(html: string, pageUrl: string, maxChars = 20_000): ParsedPage {
  const title = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2]
    ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
    ?? html;
  const links: Array<{ title: string; url: string }> = [];
  for (const match of main.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= 50) break;
    const label = decodeEntities(match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    try {
      const url = new URL(match[1] ?? "", pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") links.push({ title: label.slice(0, 160), url: url.toString() });
    } catch {
      // 忽略坏链接
    }
  }
  return { title, text: stripHtml(main, maxChars), links };
}

async function readLimited(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`响应超过 ${MAX_BYTES / 1024 / 1024}MB 上限`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated: false };
}

export interface FetchPageResult {
  url: string;
  title: string;
  text: string;
  links: Array<{ title: string; url: string }>;
  fetchedAt: string;
  redirected: number;
  bytes: number;
}

export async function fetchPublicPage(
  rawUrl: string,
  options: { maxChars?: number; resolver?: typeof lookup; fetchImpl?: typeof fetch } = {},
): Promise<FetchPageResult> {
  const maxChars = Math.min(Math.max(options.maxChars ?? 20_000, 1000), 100_000);
  const resolver = options.resolver ?? lookup;
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = await assertPublicUrl(rawUrl, resolver);
  let redirected = 0;
  const startedAt = Date.now();
  while (true) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: { "user-agent": "Maxma/1.0 (+local research)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`抓取失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`HTTP ${response.status} 重定向缺少 Location`);
      redirected += 1;
      if (redirected > MAX_REDIRECTS) throw new Error(`重定向超过 ${MAX_REDIRECTS} 跳`);
      current = await assertPublicUrl(new URL(location, current).toString(), resolver);
      continue;
    }
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType)) {
      throw new Error(`不支持的内容类型：${contentType.split(";")[0]}`);
    }
    const { bytes } = await readLimited(response);
    const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const parsed = contentType.includes("text/plain")
      ? { title: "", text: body.slice(0, maxChars), links: [] }
      : parseHtmlPage(body, current.toString(), maxChars);
    return {
      url: current.toString(),
      title: parsed.title,
      text: parsed.text,
      links: parsed.links,
      fetchedAt: new Date().toISOString(),
      redirected,
      bytes: bytes.byteLength,
    };
  }
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

function unwrapSearchUrl(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return href;
  }
}

/** 解析 DuckDuckGo HTML 搜索结果（导出以便离线测试）。 */
export function parseDuckDuckGoResults(html: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  const anchorRe = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors = [...html.matchAll(anchorRe)];
  for (let index = 0; index < anchors.length && hits.length < limit; index += 1) {
    const anchor = anchors[index];
    if (!anchor) continue;
    const url = unwrapSearchUrl(decodeEntities(anchor[1] ?? ""));
    if (!/^https?:\/\//.test(url)) continue;
    const title = decodeEntities(anchor[2] ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const nextStart = anchors[index + 1]?.index ?? html.length;
    const slice = html.slice((anchor.index ?? 0) + anchor[0].length, nextStart);
    const snippet = decodeEntities(/result__snippet[^>]*>([\s\S]*?)</i.exec(slice)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    hits.push({ title, url, snippet });
  }
  return hits;
}

/** 解析 Bing HTML 搜索结果（导出以便离线测试）。 */
export function parseBingResults(html: string, limit = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = [...html.matchAll(/<li\b[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const block of blocks) {
    const chunk = block[1] ?? "";
    const anchor = /<h2\b[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk)
      ?? /<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    if (!anchor) continue;
    const url = decodeEntities(anchor[1] ?? "");
    const title = decodeEntities(anchor[2] ?? "").replace(/\s+/g, " ").trim();
    const snippet = decodeEntities(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(chunk)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !/^https?:\/\//.test(url)) continue;
    hits.push({ title, url, snippet });
    if (hits.length >= limit) break;
  }
  return hits;
}

async function searchWeb(query: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<SearchHit[]> {
  const headers = { "user-agent": "Mozilla/5.0 (compatible; Maxma/1.0; local research)", accept: "text/html" };
  try {
    const bing = await fetchImpl(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(limit, 10)}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (bing.ok) {
      const hits = parseBingResults(await bing.text(), limit);
      if (hits.length > 0) return hits;
    }
  } catch {
    // 继续尝试 DuckDuckGo
  }
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`);
  return parseDuckDuckGoResults(await response.text(), limit);
}

export function webFetchTool(): MaxmaToolDescriptor {
  return {
    name: "web_fetch",
    label: "抓取网页",
    description: "抓取公开 http/https 网页并转成可引用文本；拒绝本机、私网、云元数据地址与二进制内容。返回来源 URL、标题、抓取时间、正文和页面链接。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "公开网页 URL（http/https）" },
        max_chars: { type: "integer", minimum: 1000, maximum: 100000, description: "最多返回正文字符数，默认 20000" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const url = String(params.url ?? "").trim();
        if (!url) return result("url 不能为空。", { ok: false });
        const page = await fetchPublicPage(url, { maxChars: Number(params.max_chars ?? 20_000) });
        const header = [page.title || "(无标题)", page.url, `抓取时间：${page.fetchedAt}`].join("\n");
        return result(`${header}\n\n${page.text}`, {
          ok: true,
          url: page.url,
          title: page.title,
          fetchedAt: page.fetchedAt,
          redirected: page.redirected,
          bytes: page.bytes,
          links: page.links,
        });
      } catch (error) {
        return result(`抓取失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function webSearchTool(): MaxmaToolDescriptor {
  return {
    name: "web_search",
    label: "网页搜索",
    description: "用 Bing 公开网页端点搜索，失败时回退 DuckDuckGo；返回标题、来源 URL 和摘要，不抓取正文。需要正文时继续调用 web_fetch。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "返回结果数，默认 8" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const query = String(params.query ?? "").trim();
        if (!query) return result("query 不能为空。", { ok: false });
        const limit = Math.min(Math.max(Number(params.limit ?? 8), 1), 10);
        const hits = await searchWeb(query, limit);
        if (hits.length === 0) {
          return result(`没有搜到「${query}」的结果；可能是搜索端点限流，请稍后重试。`, { ok: true, query, results: [] });
        }
        const lines = hits.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}${hit.snippet ? `\n   ${hit.snippet}` : ""}`);
        return result(`搜索「${query}」返回 ${hits.length} 条：\n\n${lines.join("\n\n")}`, {
          ok: true,
          query,
          fetchedAt: new Date().toISOString(),
          results: hits,
        });
      } catch (error) {
        return result(`搜索失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}
