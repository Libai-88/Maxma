/**
 * routes/chat-artifacts.ts — Agent 工具输出 → InteractiveArtifact 负载合成
 * （api/routes/chat_artifacts.py 的 Bun 直译，阶段二 2.3b）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** 写类工具集合——其输出可能包含文件路径，需要合成 artifact。 */
export const FILE_WRITING_TOOLS = new Set(["write", "edit", "create"]);

/** body 字符上限（前端 isInteractiveArtifact 限制 4000）。 */
const MAX_ARTIFACT_BODY = 2000;

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * 从工具输出字符串中提取文件路径。
 *
 * 侧边栏将工具结果序列化为 JSON，格式如：
 *   {"content":[{"type":"text","text":"Successfully wrote 13 bytes to /path/to/file.txt"}],"details":{}}
 * 尝试解析 JSON 并提取文本，再匹配 "to /path" / "Edited C:\\path" 中的路径。
 */
export function extractFilePathFromOutput(output: string): string | null {
  let text = output;
  try {
    const data = JSON.parse(output) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const content = (data as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        const texts = content
          .filter(
            (block): block is { type: string; text: string } =>
              !!block && typeof block === "object" &&
              (block as { type?: string }).type === "text",
          )
          .map((block) => String(block.text ?? ""));
        if (texts.length > 0) text = texts.join(" ");
      }
    }
  } catch {
    // 非 JSON，按原始文本处理
  }

  const patterns = [
    /(?:to|at|:)\s*(\/[^\s,.;!?'"]+)/gi, // Unix 绝对路径
    /(?:to|at|:)\s*([A-Za-z]:\\[^\s,.;!?'"]+)/gi, // Windows 绝对路径
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const candidate = (match[1] ?? "").trim().replace(/[.,;:!?"']+$/, "");
      if (candidate && isFile(candidate)) return path.normalize(candidate);
    }
  }

  // 兜底：扫描输出中所有存在的文件路径
  for (let word of text.split(/\s+/)) {
    word = word.trim().replace(/[.,;:!?"']+$/, "");
    if (word && isFile(word)) return path.normalize(word);
  }

  return null;
}

/**
 * 读取文件并构建 InteractiveArtifact 负载。
 * 文件不可读返回 null（与 Python 版同语义）。
 */
export function buildArtifactPayload(filePath: string): Record<string, unknown> | null {
  if (!isFile(filePath)) return null;
  let content: string;
  try {
    content = fs.readFileSync(filePath).toString("utf8"); // 非法字节 → U+FFFD（同 errors="replace"）
  } catch {
    return null;
  }

  const fileId = createHash("md5").update(filePath, "utf8").digest("hex"); // 32 字符 hex
  const filename = path.basename(filePath);
  const token = Buffer.from(filePath, "utf8").toString("base64");

  // 截断并 sanitize body（不包含 HTML 标签）
  let preview = content.slice(0, MAX_ARTIFACT_BODY);
  if (content.length > MAX_ARTIFACT_BODY) preview += "\n\n... (内容已截断)";
  preview = preview.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return {
    version: 1,
    id: fileId,
    type: "choice",
    title: filename,
    body: preview,
    actions: [
      { id: "preview", label: "预览", token, style: "primary" },
      { id: "open", label: "打开", token, style: "secondary" },
    ],
  };
}
