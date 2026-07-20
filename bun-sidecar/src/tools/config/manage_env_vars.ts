/**
 * tools/config/manage_env_vars.ts — View/manage environment variables
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const ENV_PATH = ".env";
const SENSITIVE_SUFFIXES = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "KEY"];

// B-001: resolve against MAXMA_PROJECT_ROOT (forwarded by sidecar_manager.py)
// so the tool reads the real project-level .env instead of bun-sidecar/.env.
function projectRoot(): string {
  return process.env.MAXMA_PROJECT_ROOT ?? process.cwd();
}

function maskValue(key: string, value: string): string {
  const isSensitive = SENSITIVE_SUFFIXES.some((s) => key.toUpperCase().includes(s));
  if (!isSensitive) return value;
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

const params = z.object({
  action: z.enum(["list", "get", "set", "delete"]).describe("操作类型"),
  key: z.string().optional().describe("环境变量名"),
  value: z.string().optional().describe("变量值"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_env_vars",
  label: "Manage Environment Variables",
  description: "管理环境变量配置。敏感信息（API Key 等）在列表中会被部分遮蔽。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const envPath = path.resolve(projectRoot(), ENV_PATH);
    const readEnv = (): Record<string, string> => {
      if (!fs.existsSync(envPath)) return {};
      const vars: Record<string, string> = {};
      for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        vars[t.slice(0, eq).trim()] = v;
      }
      return vars;
    };
    const writeEnv = (vars: Record<string, string>) => {
      fs.writeFileSync(envPath, Object.entries(vars).map(([k, v]) => `${k}=${v.includes(" ") ? `"${v}"` : v}`).join("\n") + "\n", "utf-8");
    };
    if (params.action === "list") {
      const vars = readEnv();
      const keys = Object.keys(vars);
      if (keys.length === 0) return { content: [{ type: "text", text: "没有配置环境变量" }] };
      return { content: [{ type: "text", text: `## 环境变量 (${keys.length} 个)\n\n${keys.map((k) => `- ${k}=${maskValue(k, vars[k])}`).join("\n")}` }] };
    }
    if (params.action === "get") {
      if (!params.key) return { content: [{ type: "text", text: "请指定 key" }], isError: true };
      const vars = readEnv();
      if (!(params.key in vars)) return { content: [{ type: "text", text: `未设置 "${params.key}"` }], isError: true };
      return { content: [{ type: "text", text: `${params.key}=${maskValue(params.key, vars[params.key])}` }] };
    }
    if (params.action === "set") {
      if (!params.key || params.value === undefined) return { content: [{ type: "text", text: "请指定 key 和 value" }], isError: true };
      const vars = readEnv();
      vars[params.key] = params.value;
      writeEnv(vars);
      process.env[params.key] = params.value;
      return { content: [{ type: "text", text: `已设置 "${params.key}"` }] };
    }
    if (params.action === "delete") {
      if (!params.key) return { content: [{ type: "text", text: "请指定 key" }], isError: true };
      const vars = readEnv();
      if (!(params.key in vars)) return { content: [{ type: "text", text: `未设置 "${params.key}"` }], isError: true };
      delete vars[params.key];
      writeEnv(vars);
      return { content: [{ type: "text", text: `已删除 "${params.key}"` }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
