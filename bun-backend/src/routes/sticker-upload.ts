/**
 * routes/sticker-upload.ts — 自定义表情上传（api/routes/sticker_upload.py 的
 * Bun 直译，阶段二 2.2）。
 *
 * 转换：PIL → sharp（PNG/JPG/WebP 缩放到 256px 转 WebP；GIF 提取动画帧转
 * 动画 WebP）。文件名 = 内容 md5 前 16 位（重复上传幂等）。
 */

import { Hono } from "hono";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import sharp from "sharp";

import { bundleDir, dataDir } from "../app-paths";

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function builtinStickersDir(): string {
  return path.join(bundleDir(), "config", "stickers");
}
export function customStickersDir(): string {
  return path.join(dataDir(), "config", "stickers", "custom");
}

export function createStickerUploadRoutes(): Hono {
  const app = new Hono();

  app.post("/api/stickers/upload", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") {
      return c.json({ detail: "缺少文件" }, 400);
    }
    const filename = file instanceof File ? file.name : "upload";
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return c.json(
        { detail: `不支持的文件格式: ${ext}，仅支持 ${[...ALLOWED_EXTENSIONS].join(", ")}` },
        400,
      );
    }
    const content = Buffer.from(await file.arrayBuffer());
    if (content.length > MAX_FILE_SIZE) {
      return c.json({ detail: `文件过大，最大 ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 400);
    }

    const fileHash = crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
    const webpFilename = `custom_${fileHash}.webp`;
    const dir = customStickersDir();
    fs.mkdirSync(dir, { recursive: true });
    const dstPath = path.join(dir, webpFilename);

    if (fs.existsSync(dstPath)) {
      return c.json({
        success: true,
        path: `custom/${webpFilename}`,
        filename: webpFilename,
        message: "文件已存在（重复上传）",
      });
    }

    try {
      const animated = ext === ".gif";
      const pipeline = sharp(content, animated ? { animated: true } : undefined).rotate();
      if (animated) {
        await pipeline.webp({ quality: 80, effort: 3 }).toFile(dstPath);
      } else {
        await pipeline
          .resize(256, 256, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(dstPath);
      }
    } catch (err) {
      try {
        fs.rmSync(dstPath, { force: true });
      } catch {
        // best-effort
      }
      console.error("[sticker-upload] 转换失败", err);
      return c.json({ detail: "图片转换失败" }, 500);
    }

    return c.json({
      success: true,
      path: `custom/${webpFilename}`,
      filename: webpFilename,
      message: "上传成功",
    });
  });

  app.get("/api/stickers/custom", (c) => {
    const dir = customStickersDir();
    const stickers: Array<{ category: string; filename: string; path: string }> = [];
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".webp")).sort()) {
        stickers.push({ category: "custom", filename: f, path: `custom/${f}` });
      }
    }
    return c.json({ stickers });
  });

  app.delete("/api/stickers/custom/:filename", (c) => {
    const filename = c.req.param("filename");
    if (!/^custom_[\w]+\.webp$/.test(filename)) {
      return c.json({ detail: "非法文件名" }, 400);
    }
    const filePath = path.join(customStickersDir(), filename);
    if (!fs.existsSync(filePath)) return c.json({ detail: "表情不存在" }, 404);
    fs.rmSync(filePath, { force: true });
    return c.json({ success: true, message: "已删除" });
  });

  return app;
}
