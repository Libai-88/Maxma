/**
 * routes/tools.ts — 内置工具清单（api/routes/tools.py 的 Bun 直译，阶段二 2.5a）。
 *
 * TOOL-LIST-ACCURACY-001：清单与 Pi 会话默认注册的工具一致。MCP 工具由
 * 会话绑定后动态加入，不在这里伪造静态条目。
 */

import { Hono } from "hono";
import { MAXMA_DEFAULT_PI_TOOLS } from "../../../bun-sidecar/src/kernel/pi-session";

type PiToolMetadata = { label: string; description: string; category: string; builtin: true };

const PI_TOOL_METADATA: Record<(typeof MAXMA_DEFAULT_PI_TOOLS)[number], PiToolMetadata> = {
  read: { label: "Read", description: "读取文件内容", category: "file", builtin: true },
  write: { label: "Write", description: "写入文件", category: "file", builtin: true },
  edit: { label: "Edit", description: "编辑文件内容", category: "file", builtin: true },
  bash: { label: "Bash", description: "执行 shell 命令", category: "code", builtin: true },
  grep: { label: "Grep", description: "文本搜索", category: "file", builtin: true },
  find: { label: "Find", description: "查找文件", category: "file", builtin: true },
  ls: { label: "Ls", description: "列出目录内容", category: "file", builtin: true },
};

const PI_TOOLS = MAXMA_DEFAULT_PI_TOOLS.map((name) => ({ name, ...PI_TOOL_METADATA[name] }));

export const BUILTIN_TOOLS: Array<Record<string, unknown>> = [
  ...PI_TOOLS,
  { name: "remember_memory", label: "Remember Memory", description: "记住一条长期记忆（用户明确要求时）", category: "memory", builtin: true, source: "custom" },
  { name: "search_memories", label: "Search Memories", description: "检索长期记忆", category: "memory", builtin: true, source: "custom" },
  { name: "get_sticker", label: "Get Sticker", description: "获取内置贴纸", category: "fun", builtin: true, source: "custom" },
  { name: "list_rules", label: "List Rules", description: "查询质量规则", category: "system", builtin: true, source: "custom" },
  { name: "read_office_file", label: "Read Office File", description: "读取当前工作区内的 DOCX、XLSX、PDF 和常见文本办公文件", category: "office", builtin: true, source: "custom" },
  { name: "write_office_file", label: "Write Office File", description: "在当前工作区内生成 DOCX、XLSX、CSV 和常见文本办公文件", category: "office", builtin: true, source: "custom" },
  { name: "submit_plan", label: "Submit Plan", description: "提交实施计划供用户审批", category: "interactive", builtin: true, source: "custom" },
];

export function createToolsRoutes(): Hono {
  const app = new Hono();

  // 裸数组响应（非 {tools:[]} 包裹——前端类型 ToolInfo[]）
  app.get("/api/tools", (c) => c.json(BUILTIN_TOOLS));

  return app;
}
