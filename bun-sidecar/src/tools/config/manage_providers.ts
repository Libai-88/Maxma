/**
 * tools/config/manage_providers.ts — View/manage LLM Providers
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const PROFILE_PATH = "config/providers.yaml";

function parseYaml(text: string): any {
  const lines = text.split("\n");
  const result: any = {};
  let currentKey = "";
  let currentIndent = 0;
  const stack: any[] = [result];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (trimmed.endsWith(":")) {
      const key = trimmed.slice(0, -1);
      currentKey = key;
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
        if (currentKey) parent[currentKey] = arr2;
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
        currentKey = key;
      }
    }
    if (indent < currentIndent) {
      while (stack.length > 1 && indent <= currentIndent) {
        stack.pop();
        currentIndent = indent;
      }
    }
  }
  return result;
}

const params = z.object({
  action: z.enum(["list", "get"]).describe("操作类型: list=列举所有 provider, get=查看详情"),
  provider_id: z.string().optional().describe("Provider ID"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_providers",
  label: "Manage Providers",
  description: "管理 LLM Provider 配置。可列举所有已配置的 Provider、查看详情。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const profilePath = path.resolve(process.cwd(), PROFILE_PATH);
    if (!fs.existsSync(profilePath)) return { content: [{ type: "text", text: "Provider 配置文件不存在" }] };
    const raw = fs.readFileSync(profilePath, "utf-8");
    let config: any;
    try { config = parseYaml(raw); } catch { return { content: [{ type: "text", text: "配置格式错误" }], isError: true }; }
    const providers = config?.providers ?? [];
    if (params.action === "list") {
      if (!Array.isArray(providers) || providers.length === 0) return { content: [{ type: "text", text: "没有配置任何 Provider" }] };
      const lines = providers.map((p: any) => `- ${p.id || p.name}: ${p.label || p.model || "(unnamed)"}`);
      return { content: [{ type: "text", text: `## Provider (${providers.length} 个)\n\n${lines.join("\n")}` }] };
    }
    if (params.action === "get") {
      if (!params.provider_id) return { content: [{ type: "text", text: "请指定 provider_id" }], isError: true };
      const provider = providers.find((p: any) => (p.id || p.name) === params.provider_id);
      if (!provider) return { content: [{ type: "text", text: `Provider "${params.provider_id}" 不存在` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(provider, null, 2) }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
