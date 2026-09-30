/**
 * kernel/mcp.ts — mcp_servers.yaml → pi 官方 MCP 扩展适配（阶段一 §6.2 任务 6）。
 *
 * 解析逻辑镜像 src/mcp.ts 的 loadConfiguredMcp（同一 yaml 契约），产出改为
 * 官方 McpServerEntry 形状，经 createMcpExtension({ loadConfig }) 注入。
 * 差异点（均为 pi 官方语义）：
 *   - 传输仅支持 stdio / http（streamable）；sse / websocket → unsupported
 *   - allow/block 工具过滤 → 官方 exposure / toolExposure 机制：
 *       block:[x]           → toolExposure: { x: "hidden" }
 *       allow:[a,b]         → exposure: "hidden" + toolExposure: { a: "direct", b: "direct" }
 *   - oauth / tls_verify / sse_read_timeout 暂不透传（与 OMP 版口径一致）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

/** 与 src/mcp.ts mcpConfigPath 同语义（kernel 不回引 OMP 模块，切换期镜像）。 */
function mcpConfigPath(): string {
  return path.resolve(process.env.MAXMA_PROJECT_ROOT ?? process.cwd(), "api/data/mcp_servers.yaml");
}

export interface MaxmaMcpLoadResult {
  entries: McpServerEntry[];
  unsupported: Record<string, string>;
}

/** pi 官方 McpServerConfig 的最小可写形状（桥接层构造用）。 */
type WritableServerConfig = {
  type?: "stdio" | "http";
  enabled?: boolean;
  timeout?: number;
  exposure?: string;
  toolExposure?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
};

/** 单条 yaml 条目的最小读取形状（与 src/mcp.ts MaxmaMcpEntry 同一契约）。 */
type YamlEntry = Record<string, unknown> & {
  server_id?: string;
  transport?: unknown;
  enabled?: unknown;
  allowed_tools?: unknown;
  allow?: unknown;
  blocked_tools?: unknown;
  block?: unknown;
};

function toStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : undefined;
}

export function loadMaxmaMcpEntries(): MaxmaMcpLoadResult | undefined {
  const configPath = mcpConfigPath();
  if (!fs.existsSync(configPath)) return undefined;
  const bunRuntime = globalThis as typeof globalThis & { Bun: { YAML: { parse(text: string): unknown } } };
  let parsed: Record<string, unknown>;
  try {
    const value = bunRuntime.Bun.YAML.parse(fs.readFileSync(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      console.error("[mcp/pi] configuration root must be an object; ignoring configuration");
      return undefined;
    }
    parsed = value as Record<string, unknown>;
  } catch {
    // Parser messages can echo inline secrets, so log only a stable diagnostic.
    console.error("[mcp/pi] invalid YAML configuration; ignoring configuration");
    return undefined;
  }

  const rawEntries = Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers : [];
  const entries: McpServerEntry[] = [];
  const unsupported: Record<string, string> = {};
  const source = configPath;

  for (const [index, rawEntry] of rawEntries.entries()) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      console.error(`[mcp/pi] ignoring invalid configuration entry at index ${index}`);
      continue;
    }
    const entry = rawEntry as YamlEntry;
    const name = typeof entry.server_id === "string" ? entry.server_id : undefined;
    const transport = entry.transport;
    if (!name || entry.enabled === false || typeof transport !== "string") continue;

    const config: WritableServerConfig = { enabled: true };
    if (transport === "stdio") {
      config.type = "stdio";
      for (const key of ["command", "args", "env", "cwd", "timeout"] as const) {
        if (key in entry) (config as Record<string, unknown>)[key] = entry[key];
      }
    } else if (transport === "streamable_http") {
      config.type = "http";
      for (const key of ["url", "headers", "timeout"] as const) {
        if (key in entry) (config as Record<string, unknown>)[key] = entry[key];
      }
    } else if (transport === "sse") {
      unsupported[name] = "pi supports stdio and streamable-http MCP transports (sse not supported)";
      continue;
    } else if (transport === "websocket") {
      unsupported[name] = "pi does not support websocket MCP transport";
      continue;
    } else {
      unsupported[name] = `Unsupported MCP transport: ${transport}`;
      continue;
    }

    // allow/block → 官方 exposure / toolExposure（见文件头说明）
    const allow = toStringArray(entry.allowed_tools ?? entry.allow);
    const block = toStringArray(entry.blocked_tools ?? entry.block);
    if (block && block.length > 0) {
      config.toolExposure = Object.fromEntries(block.map((t) => [t, "hidden"]));
    }
    if (allow && allow.length > 0) {
      config.exposure = "hidden";
      config.toolExposure = { ...Object.fromEntries(allow.map((t) => [t, "direct"])), ...config.toolExposure };
    }

    entries.push({ name, config: config as McpServerEntry["config"], source, scope: "extension" });
  }

  if (entries.length === 0 && Object.keys(unsupported).length === 0) return undefined;
  for (const [name, message] of Object.entries(unsupported)) {
    console.error(`[mcp/pi] ${name}: ${message}`);
  }
  return { entries, unsupported };
}
