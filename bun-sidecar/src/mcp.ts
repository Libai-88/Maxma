/**
 * mcp.ts — MCP 配置解析与工具过滤（纯逻辑 + MCPManager 装配）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp";
import type { AuthStorage, OmpTool } from "./omp-compat";

type MaxmaMcpEntry = Record<string, unknown> & { server_id?: string; transport?: string };

export function mcpConfigPath(): string {
  return path.resolve(process.env.MAXMA_PROJECT_ROOT ?? process.cwd(), "api/data/mcp_servers.yaml");
}

/** Convert Maxma's persisted list into OMP's actual MCPManager input. */
export function loadConfiguredMcp(): {
  configs: Record<string, MCPServerConfig>;
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>;
  unsupported: Record<string, string>;
} | undefined {
  const configPath = mcpConfigPath();
  if (!fs.existsSync(configPath)) return undefined;
  const bunRuntime = globalThis as typeof globalThis & { Bun: { YAML: { parse(text: string): unknown } } };
  let parsed: Record<string, unknown>;
  try {
    const value = bunRuntime.Bun.YAML.parse(fs.readFileSync(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      console.error("[mcp] configuration root must be an object; ignoring configuration");
      return undefined;
    }
    parsed = value as Record<string, unknown>;
  } catch {
    // Parser messages can echo inline secrets, so log only a stable diagnostic.
    console.error("[mcp] invalid YAML configuration; ignoring configuration");
    return undefined;
  }
  const entries = Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers : [];
  const configs: Record<string, MCPServerConfig> = {};
  const allowBlock: Record<string, { allow?: string[]; block?: string[] }> = {};
  const unsupported: Record<string, string> = {};
  for (const [index, rawEntry] of entries.entries()) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      console.error(`[mcp] ignoring invalid configuration entry at index ${index}`);
      continue;
    }
    const entry = rawEntry as MaxmaMcpEntry;
    const name = typeof entry.server_id === "string" ? entry.server_id : undefined;
    const transport = entry.transport;
    if (!name || entry.enabled === false || typeof transport !== "string") continue;
    const config: Record<string, unknown> = { enabled: true };
    if (transport === "stdio") {
      config.type = "stdio";
      for (const key of ["command", "args", "env", "cwd", "timeout"]) if (key in entry) config[key] = entry[key];
    } else if (transport === "sse" || transport === "streamable_http") {
      config.type = transport === "streamable_http" ? "http" : transport;
      for (const key of ["url", "headers", "timeout"]) if (key in entry) config[key] = entry[key];
    } else if (transport === "websocket") {
      // Keep the configured server visible in diagnostics, but never hand an
      // OMP-incompatible type to MCPManager.connectServers.
      unsupported[name] = "OMP SDK does not support websocket MCP transport";
      continue;
    } else {
      unsupported[name] = `Unsupported MCP transport: ${transport}`;
      continue;
    }
    const allowedTools = entry.allowed_tools ?? entry.allow;
    const blockedTools = entry.blocked_tools ?? entry.block;
    if (allowedTools !== undefined || blockedTools !== undefined) {
      allowBlock[name] = {
        allow: Array.isArray(allowedTools) ? allowedTools as string[] : undefined,
        block: Array.isArray(blockedTools) ? blockedTools as string[] : undefined,
      };
      // OMP has no allow/block config fields; retain them locally for tool filtering.
    }
    if ("tls_verify" in entry) unsupported[name] ??= "OMP SDK does not expose tls_verify for MCP transports";
    if ("sse_read_timeout" in entry) unsupported[name] ??= "OMP SDK does not expose sse_read_timeout";
    configs[name] = config as unknown as MCPServerConfig;
  }
  if (Object.keys(configs).length === 0 && Object.keys(unsupported).length === 0) return undefined;
  return { configs, allowBlock, unsupported };
}

export function filterMcpTools(
  tools: OmpTool[],
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>,
  requestedToolNames?: string[],
): OmpTool[] {
  const requested = requestedToolNames === undefined ? undefined : new Set(requestedToolNames);
  return tools.filter((tool) => {
    const server = tool.mcpServerName as string | undefined;
    // requestedToolNames 是内置工具名列表，不应用于过滤 MCP 工具
    // MCP 工具名称（如 fetch/puppeteer_navigate）与内置工具名不匹配，
    // 用同一列表过滤会排掉所有 MCP 工具 → B-014
    if (!server && requested && !requested.has(String(tool.name))) {
      return false;
    }
    const rules = server ? allowBlock[server] : undefined;
    if (!rules) return true;
    const toolName = String(tool.mcpToolName ?? tool.name ?? "");
    if (rules.allow && rules.allow.length > 0 && !rules.allow.includes(toolName)) return false;
    return !rules.block?.includes(toolName);
  });
}

export async function createConfiguredMcp(cwd: string, authStorage: AuthStorage): Promise<{
  manager: MCPManager;
  configs: Record<string, MCPServerConfig>;
  tools: OmpTool[];
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>;
} | undefined> {
  const loaded = loadConfiguredMcp();
  if (!loaded) return undefined;
  for (const [name, message] of Object.entries(loaded.unsupported)) {
    console.error(`[mcp] ${name}: ${message}`);
  }
  // An unsupported-only file must retain the old session creation path.
  if (Object.keys(loaded.configs).length === 0) return undefined;
  const manager = new MCPManager(cwd);
  manager.setAuthStorage(authStorage);
  const sourcePath = mcpConfigPath();
  const sources = Object.fromEntries(Object.keys(loaded.configs).map((name) => [name, {
    provider: "maxma",
    providerName: "Maxma MCP configuration",
    path: sourcePath,
    level: "project" as const,
  }]));
  const result = await manager.connectServers(loaded.configs, sources);
  for (const [name, message] of result.errors) console.error(`[mcp] ${name}: ${message}`);
  return { manager, configs: loaded.configs, allowBlock: loaded.allowBlock, tools: filterMcpTools(result.tools, loaded.allowBlock) };
}

/** OMP skips this callback when the manager is supplied by the caller. */
export function wireMcpToolsChanged(
  session: AgentSession,
  manager: MCPManager,
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>,
  requestedToolNames?: string[],
): void {
  manager.setOnToolsChanged((tools) => {
    void session.refreshMCPTools(
      filterMcpTools(tools, allowBlock, requestedToolNames) as unknown as Parameters<AgentSession["refreshMCPTools"]>[0],
    ).catch((error) => {
      console.error(`[mcp] failed to refresh session tools: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  });
}

export function mcpReloadUnsupportedResponse(): {
  status: "unsupported";
  code: "mcp_reload_requires_session_rebuild";
  message: string;
} {
  return {
    status: "unsupported",
    code: "mcp_reload_requires_session_rebuild",
    message: "MCP configuration reload is not exposed through the Maxma API; rebuild the session",
  };
}
