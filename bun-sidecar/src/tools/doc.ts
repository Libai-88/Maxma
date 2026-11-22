/**
 * tools/doc.ts — 文档索引的 Agent 工具面（C3.1）。
 *
 * 只读索引，不读工作区外文件；路径授权仍由 `maxma-path-policy` 扩展在
 * tool_call 前统一检查。搜索默认限定当前任务工作区根，避免引用到别的项目。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";
import { docIndexHasRoot, readDoc, searchDocs } from "../docintel/search";

function result(text: string, details?: unknown): MaxmaToolResult {
  return { content: [{ type: "text", text }], details };
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.floor(number), 1), max) : fallback;
}

function workspaceRoot(cwd: string): string {
  try {
    return fs.realpathSync.native(path.resolve(cwd));
  } catch {
    return path.resolve(cwd);
  }
}

function noIndexHint(root: string): MaxmaToolResult {
  return result(
    `当前工作区尚未建立文档索引：${root}\n\n请先在工作台触发一次文档索引（POST /api/doc-index/build，root_id 为对应工作区），再使用文档检索。`,
    { ok: false, reason: "DOC_INDEX_EMPTY" },
  );
}

export function docSearchTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "doc_search",
    label: "Document Search",
    description:
      "在当前工作区的文档索引里全文检索 PDF/DOCX/XLSX/MD/TXT/HTML，返回文件、来源坐标（页码/段落/工作表行/文本行）和命中片段；扫描 PDF 不会被伪造文本。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词或短语，支持中英文；中文按相邻字匹配" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "最多返回多少条，默认 10" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const query = String(params.query ?? "").trim();
        if (!query) return result("query 不能为空。", { ok: false });
        const root = workspaceRoot(cwd);
        if (!docIndexHasRoot(root)) return noIndexHint(root);
        const hits = searchDocs(query, { root, limit: clampLimit(params.limit, 10, 50) });
        if (hits.length === 0) {
          return result(`文档索引里没有命中「${query}」。可以换关键词，或重建索引后再试。`, {
            ok: true,
            hits: [],
          });
        }
        const lines = hits.map((hit, index) => {
          const suffix = hit.locatorLabel ? ` · ${hit.locatorLabel}` : "";
          return `${index + 1}. ${hit.relPath}${suffix}\n${hit.snippet}`;
        });
        return result(`文档检索命中 ${hits.length} 条（来源坐标可直接引用）：\n\n${lines.join("\n\n")}`, {
          ok: true,
          hits,
        });
      } catch (error) {
        return result(`文档检索失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}

export function docReadTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "doc_read",
    label: "Document Read",
    description:
      "按来源坐标读取文档索引中的原文块：PDF 用 page，DOCX 用 paragraph，XLSX 用 sheet，文本用 start_line/end_line；返回页码/段落/行号，便于在产物里标注引用。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对于当前工作区的文档路径" },
        page: { type: "integer", minimum: 1, description: "PDF 页码，1-based" },
        paragraph: { type: "integer", minimum: 1, description: "DOCX 段落号，1-based" },
        sheet: { type: "string", description: "XLSX 工作表名" },
        start_line: { type: "integer", minimum: 1, description: "文本起始行，1-based" },
        end_line: { type: "integer", minimum: 1, description: "文本结束行，1-based" },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "最多返回多少块，默认 4" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      try {
        const requestedPath = String(params.path ?? "").trim();
        if (!requestedPath) return result("path 不能为空。", { ok: false });
        const root = workspaceRoot(cwd);
        if (!docIndexHasRoot(root)) return noIndexHint(root);
        const doc = readDoc(requestedPath, {
          root,
          ...(typeof params.page === "number" ? { page: Math.floor(params.page) } : {}),
          ...(typeof params.paragraph === "number" ? { paragraph: Math.floor(params.paragraph) } : {}),
          ...(typeof params.sheet === "string" && params.sheet.trim() ? { sheet: params.sheet.trim() } : {}),
          ...(typeof params.start_line === "number" ? { startLine: Math.floor(params.start_line) } : {}),
          ...(typeof params.end_line === "number" ? { endLine: Math.floor(params.end_line) } : {}),
          limit: clampLimit(params.limit, 4, 20),
        });
        if (!doc) {
          return result(`文档索引里没有「${requestedPath}」。确认路径是否在当前工作区，或先重建索引。`, {
            ok: false,
            reason: "DOC_NOT_INDEXED",
          });
        }
        if (doc.status === "unsupported") {
          return result(`${doc.relPath} 未被识别：${doc.error ?? "没有可读文本"}`, {
            ok: false,
            reason: "DOC_UNSUPPORTED",
            doc,
          });
        }
        if (doc.chunks.length === 0) {
          return result(`${doc.relPath} 没有匹配该坐标的文本块。可以不带坐标读取前几块，或换页码/段落。`, {
            ok: true,
            doc,
          });
        }
        const sections = doc.chunks.map(
          (chunk) => `【${chunk.locatorLabel || "未标注坐标"}】\n${chunk.text}`,
        );
        return result(`${doc.relPath}（${doc.format}）读取 ${doc.chunks.length} 块：\n\n${sections.join("\n\n")}`, {
          ok: true,
          doc,
        });
      } catch (error) {
        return result(`文档读取失败：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}
