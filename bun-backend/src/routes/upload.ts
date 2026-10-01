/**
 * routes/upload.ts — 文件上传（api/routes/upload.py 的 Bun 直译，阶段二 2.5a）。
 *
 * 安全语义原样保留：文件名净化（B-013 Unicode 保留 + 分隔符剥离 + Windows
 * 保留名防护）、扩展名白名单、20MB 上限（Content-Length 快速拒绝 + 实际
 * 字节二次校验）、file_id 纯字母数字防 glob/穿越注入。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { getUploadsDir } from "../app-paths";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  // 文本
  ".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".log",
  // 代码
  ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".java",
  ".c", ".cpp", ".go", ".rs", ".rb", ".sh", ".bat", ".ps1",
  ".sql", ".r", ".swift", ".kt",
  // 文档
  ".pdf", ".docx", ".xlsx", ".pptx",
  // 图片
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
]);

/**
 * 净化文件名（B-013）：保留 Unicode 字母/数字/下划线 + `.` `-`，
 * 剥离路径分隔符；Windows 保留名（CON/NUL/COM1…）前加下划线。
 */
export function sanitizeFilename(name: string): string {
  // 取 basename（剥离目录成分；同时兼容 / 与 \）
  let n = name.split(/[\\/]/).pop() ?? "";
  // 显式剥离分隔符（纵深防御）
  n = n.replace(/[\\/]+/g, "");
  // 保留 Unicode 字母/数字/下划线 + . - （对齐 Python \w + re.UNICODE）
  let safe = n.replace(/[^\p{L}\p{N}_.\-]/gu, "");
  // Windows 保留名：取第一个点之前的部分比较
  const stem = safe.split(".")[0]!.toUpperCase();
  if (["CON", "NUL", "PRN", "AUX"].includes(stem) || stem.startsWith("COM") || stem.startsWith("LPT")) {
    safe = `_${safe}`;
  }
  return safe || "unnamed_file";
}

function parseMeta(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) meta[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return meta;
}

export function createUploadRoutes(): Hono {
  const app = new Hono();

  // POST /api/upload（multipart file 字段）
  app.post("/api/upload", async (c) => {
    const uploadDir = getUploadsDir();
    fs.mkdirSync(uploadDir, { recursive: true });

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ detail: "文件名不能为空" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.name) {
      return c.json({ detail: "文件名不能为空" }, 400);
    }

    const originalName = sanitizeFilename(file.name);
    const dot = originalName.lastIndexOf(".");
    const ext = dot >= 0 ? originalName.slice(dot).toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return c.json(
        { detail: `不支持的文件类型: ${ext}。支持的类型: ${[...ALLOWED_EXTENSIONS].sort().join(", ")}` },
        400,
      );
    }

    // Content-Length 快速拒绝
    const clHeader = c.req.header("content-length");
    if (clHeader) {
      const cl = Number(clHeader);
      if (Number.isFinite(cl) && cl > MAX_FILE_SIZE) {
        return c.json(
          { detail: `文件过大（Content-Length: ${cl} 字节），最大允许 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
          413,
        );
      }
    }

    // 实际字节二次校验（Content-Length 可伪造）
    const content = Buffer.from(await file.arrayBuffer());
    if (content.length > MAX_FILE_SIZE) {
      return c.json(
        { detail: `文件过大（${content.length} 字节），最大允许 ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        413,
      );
    }

    const fileId = randomUUID().replace(/-/g, "");
    const safeName = `${fileId}_${originalName}`;
    const filePath = path.join(uploadDir, safeName);
    fs.writeFileSync(filePath, content);

    fs.writeFileSync(
      path.join(uploadDir, `${fileId}.meta`),
      `original_name=${originalName}\nsize=${content.length}\nuploaded_at=${Date.now() / 1000}\n`,
      "utf8",
    );

    return c.json({
      file_id: fileId,
      filename: originalName,
      size: content.length,
      path: `local:${filePath}`,
      message: `文件已上传，Agent 可通过路径 local:${filePath} 读取`,
    });
  });

  // GET /api/uploads
  app.get("/api/uploads", (c) => {
    const uploadDir = getUploadsDir();
    const files: Array<Record<string, unknown>> = [];
    if (!fs.existsSync(uploadDir)) return c.json({ files, count: 0 });

    for (const name of fs.readdirSync(uploadDir).filter((f) => f.endsWith(".meta")).sort()) {
      const fileId = name.slice(0, -".meta".length);
      let meta: Record<string, string>;
      try {
        meta = parseMeta(fs.readFileSync(path.join(uploadDir, name), "utf8"));
      } catch {
        continue;
      }
      const originalName = sanitizeFilename(meta.original_name ?? "");
      const actualFile = path.join(uploadDir, `${fileId}_${originalName}`);
      if (fs.existsSync(actualFile)) {
        files.push({
          file_id: fileId,
          filename: originalName,
          size: Number(meta.size ?? 0) || 0,
          uploaded_at: Number(meta.uploaded_at ?? 0) || 0,
          path: `local:${actualFile}`,
        });
      }
    }
    return c.json({ files, count: files.length });
  });

  // DELETE /api/uploads/{fileId}
  app.delete("/api/uploads/:fileId", (c) => {
    const fileId = c.req.param("fileId");
    // 纯字母数字校验：防 glob 通配符批量删除与路径穿越
    if (!/^[a-zA-Z0-9]+$/.test(fileId)) {
      return c.json({ detail: "非法 file_id" }, 400);
    }
    const uploadDir = getUploadsDir();
    let deleted = false;

    const metaPath = path.join(uploadDir, `${fileId}.meta`);
    if (fs.existsSync(metaPath)) {
      const meta = parseMeta(fs.readFileSync(metaPath, "utf8"));
      const originalName = sanitizeFilename(meta.original_name ?? "");
      const actualFile = path.join(uploadDir, `${fileId}_${originalName}`);
      if (fs.existsSync(actualFile)) fs.rmSync(actualFile, { force: true });
      fs.rmSync(metaPath, { force: true });
      deleted = true; // meta 已清理即视为成功
    } else if (fs.existsSync(uploadDir)) {
      for (const name of fs.readdirSync(uploadDir)) {
        if (name.startsWith(`${fileId}_`)) {
          fs.rmSync(path.join(uploadDir, name), { force: true });
          deleted = true;
        }
      }
    }

    if (!deleted) return c.json({ detail: `文件 ${fileId} 不存在` }, 404);
    return c.json({ deleted: true, file_id: fileId });
  });

  return app;
}
