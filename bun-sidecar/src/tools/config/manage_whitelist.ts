/**
 * tools/config/manage_whitelist.ts — Manage path whitelist
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const WHITELIST_PATH = "config/.whitelist";

const params = z.object({
  action: z.enum(["list", "add", "remove"]).describe("操作类型"),
  path_str: z.string().optional().describe("文件路径"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_whitelist",
  label: "Manage Path Whitelist",
  description: "管理 AI 可访问的文件路径白名单。白名单之外的路径 AI 无法读写。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const wlPath = path.resolve(process.cwd(), WHITELIST_PATH);
    const readList = (): string[] => {
      if (!fs.existsSync(wlPath)) return [];
      return fs.readFileSync(wlPath, "utf-8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    };
    const writeList = (items: string[]) => {
      fs.writeFileSync(wlPath, "# AI 路径白名单\n\n" + items.join("\n") + "\n", "utf-8");
    };
    if (params.action === "list") {
      const items = readList();
      if (items.length === 0) return { content: [{ type: "text", text: "白名单为空" }] };
      return { content: [{ type: "text", text: `## 路径白名单 (${items.length} 项)\n\n${items.map((p, i) => `${i + 1}. ${p}`).join("\n")}` }] };
    }
    if (params.action === "add") {
      if (!params.path_str) return { content: [{ type: "text", text: "请指定 path_str" }], isError: true };
      const items = readList();
      const resolved = path.resolve(params.path_str);
      if (items.includes(resolved)) return { content: [{ type: "text", text: `路径 "${resolved}" 已在白名单中` }] };
      items.push(resolved);
      writeList(items);
      return { content: [{ type: "text", text: `已添加 "${resolved}"` }] };
    }
    if (params.action === "remove") {
      if (!params.path_str) return { content: [{ type: "text", text: "请指定 path_str" }], isError: true };
      const items = readList();
      const resolved = path.resolve(params.path_str);
      const idx = items.indexOf(resolved);
      if (idx === -1) return { content: [{ type: "text", text: `路径 "${resolved}" 不在白名单中` }], isError: true };
      items.splice(idx, 1);
      writeList(items);
      return { content: [{ type: "text", text: `已移除 "${resolved}"` }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
