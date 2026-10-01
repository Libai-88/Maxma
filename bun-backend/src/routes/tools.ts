/**
 * routes/tools.ts — 内置工具清单（api/routes/tools.py 的 Bun 直译，阶段二 2.5a）。
 *
 * TOOL-LIST-ACCURACY-001 语义保持：清单与运行时事实一致——OMP 原生记忆工具
 * 已移除、Maxma 自定义工具（source:"custom"）在列。纯静态数据。
 */

import { Hono } from "hono";

export const BUILTIN_TOOLS: Array<Record<string, unknown>> = [
  // File
  { name: "read", label: "Read", description: "读取文件内容", category: "file", builtin: true },
  { name: "write", label: "Write", description: "写入文件", category: "file", builtin: true },
  { name: "edit", label: "Edit", description: "编辑文件内容", category: "file", builtin: true },
  { name: "glob", label: "Glob", description: "搜索文件", category: "file", builtin: true },
  { name: "grep", label: "Grep", description: "文本搜索", category: "file", builtin: true },
  // Code
  { name: "bash", label: "Bash", description: "执行 shell 命令", category: "code", builtin: true },
  { name: "eval", label: "Eval", description: "执行代码片段", category: "code", builtin: true },
  { name: "lsp", label: "LSP", description: "代码语言服务", category: "code", builtin: true },
  { name: "debug", label: "Debug", description: "调试工具", category: "code", builtin: true },
  { name: "ast_grep", label: "AST Grep", description: "AST 语法搜索", category: "code", builtin: true },
  { name: "ast_edit", label: "AST Edit", description: "AST 语法编辑", category: "code", builtin: true },
  // Web
  { name: "web_search", label: "Web Search", description: "搜索互联网", category: "web", builtin: true },
  { name: "browser", label: "Browser", description: "浏览器自动化", category: "web", builtin: true },
  // System
  { name: "github", label: "GitHub", description: "GitHub CLI 操作", category: "system", builtin: true },
  { name: "task", label: "Task", description: "DAG 子任务编排", category: "system", builtin: true },
  { name: "job", label: "Job", description: "异步作业管理", category: "system", builtin: true },
  { name: "ssh", label: "SSH", description: "SSH 远程连接", category: "system", builtin: true },
  { name: "launch", label: "Launch", description: "启动应用", category: "system", builtin: true },
  { name: "checkpoint", label: "Checkpoint", description: "创建检查点", category: "system", builtin: true },
  { name: "rewind", label: "Rewind", description: "回退到检查点", category: "system", builtin: true },
  { name: "irc", label: "IRC", description: "多 agent 通信", category: "system", builtin: true },
  // Interactive
  { name: "ask", label: "Ask User", description: "向用户提问", category: "interactive", builtin: true },
  { name: "todo", label: "Todo", description: "待办管理", category: "interactive", builtin: true },
  { name: "inspect_image", label: "Inspect Image", description: "图片分析", category: "interactive", builtin: true },
  // Skills
  { name: "manage_skill", label: "Manage Skill", description: "管理技能包", category: "skills", builtin: true },
  // ── Maxma 自定义工具（kernel customTools 全量注册）──
  { name: "remember_memory", label: "Remember Memory", description: "记住一条长期记忆（用户明确要求时）", category: "memory", builtin: true, source: "custom" },
  { name: "search_memories", label: "Search Memories", description: "检索长期记忆", category: "memory", builtin: true, source: "custom" },
  { name: "get_sticker", label: "Get Sticker", description: "获取内置贴纸", category: "fun", builtin: true, source: "custom" },
  { name: "list_rules", label: "List Rules", description: "查询质量规则", category: "system", builtin: true, source: "custom" },
  { name: "list_automations", label: "List Automations", description: "查询自动化任务", category: "system", builtin: true, source: "custom" },
];

export function createToolsRoutes(): Hono {
  const app = new Hono();

  // 裸数组响应（非 {tools:[]} 包裹——前端类型 ToolInfo[]）
  app.get("/api/tools", (c) => c.json(BUILTIN_TOOLS));

  return app;
}
