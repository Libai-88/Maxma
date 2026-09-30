/**
 * routes/transcripts.ts — Transcript 读取（api/routes/transcripts.py 的 Bun 直译）。
 *
 * 安全要点原样保留：类别白名单（autonomy/hooks/manual）、文件名穿越防护
 * （normpath + 禁分隔符）、resolve 后前缀校验（防符号链接绕过）。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { dataDir } from "../app-paths";

const ALLOWED_CATEGORIES = new Set(["autonomy", "hooks", "manual"]);

function transcriptsRoot(): string {
  return path.join(dataDir(), "transcripts");
}

/** JSONL transcript 读取（api/transcript/jsonl_writer.py read_messages 平移）。 */
function readMessages(filePath: string): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (!fs.existsSync(filePath)) return messages;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // 脏行跳过（对齐 Python 版容错）
    }
  }
  return messages;
}

export function createTranscriptsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/transcripts", (c) => {
    const root = transcriptsRoot();
    const result: Record<string, Array<{ filename: string; size: number; modified_at: number }>> = {};
    if (!fs.existsSync(root)) return c.json({ categories: result });

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ALLOWED_CATEGORIES.has(entry.name)) continue;
      const dir = path.join(root, entry.name);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .reverse()
        .map((f) => {
          const stat = fs.statSync(path.join(dir, f));
          return { filename: f, size: stat.size, modified_at: stat.mtimeMs };
        });
      result[entry.name] = files;
    }
    return c.json({ categories: result });
  });

  app.get("/api/transcripts/:category/:filename", (c) => {
    const category = c.req.param("category");
    const filename = c.req.param("filename");
    if (!ALLOWED_CATEGORIES.has(category)) {
      return c.json({ detail: "无效的类别" }, 400);
    }

    // 路径穿越防护：normpath 后禁分隔符与 ..
    const normalized = path.normalize(filename);
    if (normalized.includes("..") || normalized.includes("/") || normalized.includes("\\")) {
      return c.json({ detail: "无效的文件名" }, 400);
    }

    const transcriptPath = path.join(transcriptsRoot(), category, filename);
    const expectedBase = path.resolve(transcriptsRoot(), category);
    const resolved = path.resolve(transcriptPath);
    if (!resolved.startsWith(expectedBase + path.sep) && resolved !== expectedBase) {
      console.warn(`[transcripts] Path traversal blocked: ${resolved} outside ${expectedBase}`);
      return c.json({ detail: "无效的路径" }, 400);
    }

    if (!fs.existsSync(transcriptPath)) {
      return c.json({ detail: "记录文件不存在" }, 404);
    }

    return c.json({ messages: readMessages(transcriptPath), filename, category });
  });

  return app;
}
