/**
 * tools/config/manage_mcp.ts — Manage MCP server configurations
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

// B-001: real config lives at <project_root>/api/data/mcp_servers.yaml (see
// app_paths.MCP_CONFIG_PATH). Previously this was "config/mcp_servers.yaml",
// which combined with process.cwd()=bun-sidecar/ silently read phantom paths.
const MCP_CONFIG_PATH = "api/data/mcp_servers.yaml";

// Resolve a project-relative path against MAXMA_PROJECT_ROOT (forwarded by
// sidecar_manager.py), falling back to process.cwd() for direct script runs.
function projectRoot(): string {
  return process.env.MAXMA_PROJECT_ROOT ?? process.cwd();
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "apitoken",
  "apikey",
  "xapikey",
  "clientsecret",
  "password",
  "secret",
  "cookie",
  "setcookie",
]);
const SENSITIVE_CONTAINERS = new Set(["env", "headers"]);

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function redactSensitive(value: unknown, maskAll = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, maskAll));
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = normalizeSensitiveKey(key);
      if (maskAll) {
        redacted[key] = redactSensitive(item, true);
      } else if (SENSITIVE_CONTAINERS.has(normalizedKey)) {
        redacted[key] = redactSensitive(item, true);
      } else if (SENSITIVE_KEYS.has(normalizedKey)) {
        redacted[key] = REDACTED;
      } else {
        redacted[key] = redactSensitive(item);
      }
    }
    return redacted;
  }
  return maskAll ? REDACTED : value;
}

function parseYaml(text: string): any {
  // Minimal YAML parser for the mcp_servers schema (list of flat dicts).
  // B-010: previously the dedent loop set currentIndent = indent inside the
  // while body, making the condition trivially true and over-popping the
  // stack. Fixed by re-deriving currentIndent from the new top of stack
  // and using `<` (not `<=`) so equal indent stops popping.
  const lines = text.split("\n");
  const result: any = {};
  const stack: { indent: number; node: any }[] = [{ indent: -1, node: result }];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack until top.indent < indent (handles dedent correctly).
    // BC-001: don't pop an array at the same indent when the new line is
    // also a list item — sibling list items append to the same array.
    // (Without this guard, the second `- item` would pop the array, then
    // the "parent is not an array" branch would create a NEW array,
    // overwriting the previous one and losing all prior items.)
    const isListItem = trimmed.startsWith("- ");
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      const top = stack[stack.length - 1];
      if (isListItem && Array.isArray(top.node) && top.indent === indent) break;
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;

    if (trimmed.startsWith("- ")) {
      // List item — parent must be an array; if not, convert last key to array.
      const val = trimmed.slice(2);
      let arr: any[];
      if (Array.isArray(parent)) {
        arr = parent;
      } else {
        const keys = Object.keys(parent);
        const lastKey = keys[keys.length - 1];
        arr = [];
        parent[lastKey] = arr;
        stack.push({ indent, node: arr });
      }
      // Support inline "- key: value" syntax for list-of-dicts.
      // BC-001: guard against false positives like `D:/Maxma` (path with
      // drive-letter colon). Require the key to be a YAML identifier and
      // the value (when non-empty) not to start with `/` or `\` (path).
      // Empty value (`- key:`) is allowed — used by `args:` in the schema.
      const colonIdx = val.indexOf(":");
      const keyCandidate = colonIdx > 0 ? val.slice(0, colonIdx).trim() : "";
      const valCandidate = colonIdx > 0 ? val.slice(colonIdx + 1).trim() : "";
      const isYamlKey = /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(keyCandidate);
      const isPathLike =
        valCandidate.startsWith("/") || valCandidate.startsWith("\\");
      if (colonIdx > 0 && isYamlKey && !isPathLike) {
        const obj: any = {};
        const k = keyCandidate;
        const v = coerceScalar(valCandidate);
        obj[k] = v;
        arr.push(obj);
        stack.push({ indent, node: obj });
      } else {
        arr.push(coerceScalar(val));
      }
    } else {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const rawVal = trimmed.slice(colonIdx + 1).trim();
        if (rawVal === "") {
          // Block scalar / nested mapping — push placeholder container; the
          // next list item or mapping line will replace it as needed.
          const child: any = {};
          parent[key] = child;
          stack.push({ indent, node: child });
        } else {
          parent[key] = coerceScalar(rawVal);
        }
      }
    }
  }
  return result;
}

function coerceScalar(raw: string): any {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  // Strip surrounding quotes
  const m = raw.match(/^["'](.*)["']$/);
  if (m) return m[1];
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw;
}

const params = z.object({
  action: z.enum(["list", "get"]).describe("操作类型: list=列举, get=查看详情"),
  server_id: z.string().optional().describe("MCP 服务器 ID"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_mcp",
  label: "Manage MCP Servers",
  description: "管理 MCP (Model Context Protocol) 服务器配置。可列举所有已配置的 MCP 服务器、查看详情。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const configPath = path.resolve(projectRoot(), MCP_CONFIG_PATH);
    if (!fs.existsSync(configPath)) return { content: [{ type: "text", text: "未配置任何 MCP 服务器" }] };
    const raw = fs.readFileSync(configPath, "utf-8");
    let parsed: any;
    try { parsed = parseYaml(raw); } catch { return { content: [{ type: "text", text: "配置格式错误" }], isError: true }; }
    const servers = parsed?.mcp_servers ?? parsed?.servers ?? [];
    if (params.action === "list") {
      if (!Array.isArray(servers) || servers.length === 0) return { content: [{ type: "text", text: "没有配置任何 MCP 服务器" }] };
      const safeServers = servers.map((server: any) => redactSensitive(server) as any);
      const lines = safeServers.map((s: any) => `- ${s.id || s.name}: ${s.url || s.command || "(unknown)"}`);
      return { content: [{ type: "text", text: `## MCP 服务器 (${servers.length} 个)\n\n${lines.join("\n")}` }] };
    }
    if (params.action === "get") {
      if (!params.server_id) return { content: [{ type: "text", text: "请指定 server_id" }], isError: true };
      const server = servers.find((s: any) => (s.id || s.name) === params.server_id);
      if (!server) return { content: [{ type: "text", text: `服务器 "${params.server_id}" 不存在` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(redactSensitive(server), null, 2) }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
