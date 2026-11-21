/**
 * tools/code.ts — 代码索引的 Agent 工具面（C1/C2/C3）。
 *
 * 这些工具只读索引与单个源文件，不写入；真正的路径授权仍由 `maxma-path-policy`
 * 扩展在 tool_call 前统一检查（`code_diagnostics` 已列入 READ_TOOLS）。
 */

import * as path from "node:path";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";
import { findDefinition, findReferences, listSymbols, searchCode, syntaxDiagnostics } from "../codeintel/service";

function result(text: string, details?: unknown): MaxmaToolResult {
  return { content: [{ type: "text", text }], details };
}

function clampLimit(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.floor(number), 1), 100) : fallback;
}

function noIndexHint(): MaxmaToolResult {
  return result("代码索引尚未建立。请先在工作台触发一次工作区代码索引（POST /api/code-index/build），再使用代码检索。", {
    ok: false,
    reason: "INDEX_EMPTY",
  });
}

export function codeSearchTool(): MaxmaToolDescriptor {
  return {
    name: "code_search",
    label: "Code Search",
    description: "在当前已索引的工作区里做全文代码检索（FTS5），返回文件路径、语言和命中片段；不替代 grep 的任意文件搜索。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词或标识符，支持空格分词" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "最多返回多少条，默认 20" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const query = String(params.query ?? "").trim();
        if (!query) return result("query 不能为空。", { ok: false });
        const hits = searchCode(query, clampLimit(params.limit, 20));
        if (hits.length === 0) return noIndexHint();
        const lines = hits.map((hit, index) =>
          `${index + 1}. ${hit.relPath} · ${hit.language}\n${hit.snippet.replace(/<mark>/g, "[").replace(/<\/mark>/g, "]")}`,
        );
        return result(`代码检索命中 ${hits.length} 条：\n\n${lines.join("\n\n")}`, { ok: true, hits });
      } catch (error) {
        return result(`代码检索失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function codeSymbolsTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "code_symbols",
    label: "Code Symbols",
    description: "列出文件内符号（函数/类/接口/类型/方法/变量）或按名称检索索引中的符号。只返回索引中已收录的工作区文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对于当前工作区的文件路径；给 path 时列出该文件符号" },
        query: { type: "string", description: "按符号名模糊检索；与 path 二选一" },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "最多返回多少条，默认 100" },
      },
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const requestedPath = typeof params.path === "string" ? params.path.trim() : "";
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!requestedPath && !query) return result("path 或 query 至少给一个。", { ok: false });
        const symbols = listSymbols({
          ...(requestedPath ? { path: path.resolve(cwd, requestedPath) } : {}),
          ...(query ? { query } : {}),
          limit: clampLimit(params.limit, 100),
        });
        if (symbols.length === 0) return result("没有命中符号。确认文件已建立索引，或换一个符号名。", { ok: true, symbols: [] });
        const lines = symbols.map((symbol) =>
          `${symbol.relPath}:${symbol.line}:${symbol.column} · ${symbol.kind} ${symbol.container ? `${symbol.container}.` : ""}${symbol.name}`,
        );
        return result(`符号 ${symbols.length} 个：\n\n${lines.join("\n")}`, { ok: true, symbols });
      } catch (error) {
        return result(`符号查询失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function codeDefinitionTool(): MaxmaToolDescriptor {
  return {
    name: "code_definition",
    label: "Code Definition",
    description: "按符号名查找定义位置（文件、行、列）。优先精确匹配，找不到时返回模糊候选；不代替编辑器跳转的完整语义。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "符号名，例如 createMaxmaSession" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const name = String(params.name ?? "").trim();
        if (!name) return result("name 不能为空。", { ok: false });
        const definitions = findDefinition(name);
        if (definitions.length === 0) return result(`没有找到「${name}」的定义。`, { ok: true, definitions: [] });
        const lines = definitions.map((definition) =>
          `${definition.relPath}:${definition.line}:${definition.column} · ${definition.kind}${definition.container ? ` (${definition.container})` : ""}`,
        );
        return result(`「${name}」定义候选 ${definitions.length} 个：\n\n${lines.join("\n")}`, { ok: true, definitions });
      } catch (error) {
        return result(`定义查询失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function codeReferencesTool(): MaxmaToolDescriptor {
  return {
    name: "code_references",
    label: "Code References",
    description: "在已索引的工作区里查找标识符引用（按词边界匹配，返回行号与预览）；引用是文本级，不是 TypeScript 类型系统级。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "要查找的标识符" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "最多返回多少条，默认 50" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const name = String(params.name ?? "").trim();
        if (!name) return result("name 不能为空。", { ok: false });
        const references = findReferences(name, clampLimit(params.limit, 50));
        if (references.length === 0) return result(`没有找到「${name}」的引用。`, { ok: true, references: [] });
        const lines = references.map((reference) =>
          `${reference.relPath}:${reference.line}:${reference.column}${reference.isDefinition ? " [定义]" : ""} ${reference.preview}`,
        );
        return result(`「${name}」引用 ${references.length} 条：\n\n${lines.join("\n")}`, { ok: true, references });
      } catch (error) {
        return result(`引用查询失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function codeDiagnosticsTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "code_diagnostics",
    label: "Code Diagnostics",
    description: "对当前工作区内的 TS/JS 文件做语法级诊断（类型检查需完整项目上下文，当前工具明确只承诺语法）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对于当前工作区的 TS/JS 文件路径" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const requestedPath = String(params.path ?? "").trim();
        if (!requestedPath) return result("path 不能为空。", { ok: false });
        const absolute = path.resolve(cwd, requestedPath);
        const diagnostics = syntaxDiagnostics(absolute);
        if (diagnostics.length === 0) return result("语法诊断通过（0 条）；未做跨文件类型检查。", { ok: true, diagnostics });
        const lines = diagnostics.map((diagnostic) =>
          `${path.relative(cwd, diagnostic.file)}:${diagnostic.line}:${diagnostic.column} · ${diagnostic.severity} TS${diagnostic.code} ${diagnostic.message}`,
        );
        return result(`语法诊断 ${diagnostics.length} 条：\n\n${lines.join("\n")}`, { ok: true, diagnostics });
      } catch (error) {
        return result(`诊断失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}
