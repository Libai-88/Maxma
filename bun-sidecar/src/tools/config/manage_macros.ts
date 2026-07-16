/**
 * tools/config/manage_macros.ts — Manage macros/ replayable instruction snippets
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const MACROS_DIR = "macros";

const params = z.object({
  action: z
    .enum(["list", "get", "create", "update", "delete"])
    .describe("操作类型: list=列举, get=查看内容, create=创建, update=更新, delete=删除"),
  name: z.string().optional().describe("宏名称（用于 get/create/update/delete）"),
  content: z.string().optional().describe("宏内容（用于 create/update）"),
  description: z.string().optional().describe("宏描述（用于 create/update 的 frontmatter）"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_macros",
  label: "Manage Macros",
  description: "管理 macros/ 目录下的可复用指令片段（宏）。可列举所有宏、查看宏内容、创建新宏、更新已有宏、删除宏。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const macrosDir = path.resolve(process.cwd(), MACROS_DIR);
    if (params.action === "list") {
      if (!fs.existsSync(macrosDir)) return { content: [{ type: "text", text: "macros/ 目录不存在" }] };
      const entries = fs.readdirSync(macrosDir, { withFileTypes: true });
      const macros: { name: string; description: string }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const macroPath = path.join(macrosDir, entry.name, "MACRO.md");
        if (!fs.existsSync(macroPath)) continue;
        const content = fs.readFileSync(macroPath, "utf-8");
        const desc = _parseFrontmatter(content).description || entry.name;
        macros.push({ name: entry.name, description: desc });
      }
      if (macros.length === 0) return { content: [{ type: "text", text: "没有找到任何宏" }] };
      const lines = macros.map((m) => `- ${m.name}: ${m.description}`);
      return { content: [{ type: "text", text: `## 可用宏 (${macros.length} 个)\n\n${lines.join("\n")}` }] };
    }
    if (params.action === "get") {
      if (!params.name) return { content: [{ type: "text", text: "请指定宏名称" }], isError: true };
      const macroPath = path.resolve(macrosDir, params.name, "MACRO.md");
      if (!fs.existsSync(macroPath)) return { content: [{ type: "text", text: `宏 "${params.name}" 不存在` }], isError: true };
      return { content: [{ type: "text", text: fs.readFileSync(macroPath, "utf-8") }] };
    }
    if (params.action === "create" || params.action === "update") {
      if (!params.name || !params.content) return { content: [{ type: "text", text: "请指定 name 和 content" }], isError: true };
      const macroDir = path.resolve(macrosDir, params.name);
      const macroPath = path.join(macroDir, "MACRO.md");
      if (params.action === "create" && fs.existsSync(macroPath)) return { content: [{ type: "text", text: `宏 "${params.name}" 已存在` }], isError: true };
      fs.mkdirSync(macroDir, { recursive: true });
      const desc = params.description || params.name;
      fs.writeFileSync(macroPath, `---\nname: "${params.name}"\ndescription: "${desc}"\n---\n\n${params.content}`, "utf-8");
      return { content: [{ type: "text", text: `宏 "${params.name}" 已${params.action === "create" ? "创建" : "更新"}` }] };
    }
    if (params.action === "delete") {
      if (!params.name) return { content: [{ type: "text", text: "请指定宏名称" }], isError: true };
      const macroDir = path.resolve(macrosDir, params.name);
      const macroPath = path.join(macroDir, "MACRO.md");
      if (!fs.existsSync(macroPath)) return { content: [{ type: "text", text: `宏 "${params.name}" 不存在` }], isError: true };
      fs.rmSync(macroDir, { recursive: true, force: true });
      return { content: [{ type: "text", text: `宏 "${params.name}" 已删除` }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

function _parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\s*\n(.*?)\n---/s);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      meta[key] = val;
    }
  }
  return meta;
}

export default tool;
