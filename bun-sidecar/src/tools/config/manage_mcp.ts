/**
 * tools/config/manage_mcp.ts — Manage MCP server configurations
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const MCP_CONFIG_PATH = "config/mcp_servers.yaml";

function parseYaml(text: string): any {
  const lines = text.split("\n");
  const result: any = {};
  const stack: any[] = [result];
  let currentIndent = 0;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (trimmed.endsWith(":")) {
      const key = trimmed.slice(0, -1);
      const obj: any = {};
      const parent = stack[stack.length - 1];
      if (Array.isArray(parent)) parent.push(obj);
      else parent[key] = obj;
      stack.push(obj);
      currentIndent = indent;
    } else if (trimmed.startsWith("- ")) {
      const val = trimmed.slice(2);
      const arr: any[] = stack[stack.length - 1] as any[];
      if (!Array.isArray(arr)) {
        const parent = stack[stack.length - 1];
        const arr2: any[] = [];
        const keys = Object.keys(parent);
        const lastKey = keys[keys.length - 1];
        parent[lastKey] = arr2;
        stack.push(arr2);
        arr2.push(isNaN(Number(val)) ? val : Number(val));
      } else {
        arr.push(isNaN(Number(val)) ? val : Number(val));
      }
    } else {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val: any = trimmed.slice(colonIdx + 1).trim();
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (!isNaN(Number(val))) val = Number(val);
        const parent = stack[stack.length - 1];
        parent[key] = val;
      }
    }
    if (indent < currentIndent) {
      while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; }
    }
  }
  return result;
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
    const configPath = path.resolve(process.cwd(), MCP_CONFIG_PATH);
    if (!fs.existsSync(configPath)) return { content: [{ type: "text", text: "未配置任何 MCP 服务器" }] };
    const raw = fs.readFileSync(configPath, "utf-8");
    let parsed: any;
    try { parsed = parseYaml(raw); } catch { return { content: [{ type: "text", text: "配置格式错误" }], isError: true }; }
    const servers = parsed?.mcp_servers ?? parsed?.servers ?? [];
    if (params.action === "list") {
      if (!Array.isArray(servers) || servers.length === 0) return { content: [{ type: "text", text: "没有配置任何 MCP 服务器" }] };
      const lines = servers.map((s: any) => `- ${s.id || s.name}: ${s.url || s.command || "(unknown)"}`);
      return { content: [{ type: "text", text: `## MCP 服务器 (${servers.length} 个)\n\n${lines.join("\n")}` }] };
    }
    if (params.action === "get") {
      if (!params.server_id) return { content: [{ type: "text", text: "请指定 server_id" }], isError: true };
      const server = servers.find((s: any) => (s.id || s.name) === params.server_id);
      if (!server) return { content: [{ type: "text", text: `服务器 "${params.server_id}" 不存在` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(server, null, 2) }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
