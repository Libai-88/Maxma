/**
 * tools/stickers.ts — Maxma 贴纸检索工具。
 *
 * get_sticker：列出 config/stickers 下可用的贴纸分类，或按分类随机取
 * 一个贴纸的相对路径。贴纸在对话中由前端渲染，工具返回路径即可。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";

/** 内置贴纸目录：<MAXMA_PROJECT_ROOT>/config/stickers/<category>/*.webp */
export function stickersDir(): string {
  return path.join(
    process.env.MAXMA_PROJECT_ROOT ?? process.cwd(),
    "config",
    "stickers",
  );
}

/** 列出所有贴纸分类及其贴纸数。 */
export async function listStickerCategories(): Promise<Array<{ category: string; count: number }>> {
  const dir = stickersDir();
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: Array<{ category: string; count: number }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const files = await fs.readdir(path.join(dir, e.name));
      const count = files.filter((f) => f.endsWith(".webp") || f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".gif")).length;
      if (count > 0) result.push({ category: e.name, count });
    } catch {
      // 忽略不可读分类
    }
  }
  return result.sort((a, b) => a.category.localeCompare(b.category));
}

/** 按分类随机取一个贴纸（返回相对 config/stickers 的路径）。 */
export async function pickSticker(category: string): Promise<string | null> {
  const catDir = path.join(stickersDir(), category);
  let files;
  try {
    files = await fs.readdir(catDir);
  } catch {
    return null;
  }
  const images = files.filter((f) => /\.(webp|png|jpg|jpeg|gif)$/i.test(f));
  if (images.length === 0) return null;
  const pick = images[Math.floor(Math.random() * images.length)];
  return `${category}/${pick}`;
}

const getStickerSchema = {
  type: "object",
  properties: {
    category: {
      type: "string",
      description: "贴纸分类名（如 开心/委屈/害羞）。不传则列出全部分类供选择",
    },
  },
  additionalProperties: false,
} as const;

export function getStickerTool(): ToolDefinition {
  return {
    name: "get_sticker",
    label: "取贴纸",
    description:
      "获取 Maxma 内置表情贴纸。不传 category 时返回可用分类列表；传入分类名时随机返回该分类下的一张贴纸路径。适合在回复中点缀情绪时调用。",
    parameters: getStickerSchema as unknown as ToolDefinition["parameters"],
    approval: "read",
    async execute(_id: string, params: { category?: string }) {
      const category = (params.category ?? "").trim();
      if (!category) {
        const cats = await listStickerCategories();
        if (cats.length === 0) {
          return {
            content: [{ type: "text", text: "当前没有可用的贴纸。" }],
            details: { categories: [] },
          };
        }
        const lines = cats.map((c) => `- ${c.category}（${c.count} 张）`);
        return {
          content: [{ type: "text", text: `可用贴纸分类：\n${lines.join("\n")}\n\n传入 category 参数可随机取一张。` }],
          details: { categories: cats },
        };
      }
      const stickerPath = await pickSticker(category);
      if (!stickerPath) {
        return {
          content: [{ type: "text", text: `分类「${category}」下没有贴纸。可先不传 category 查看可用分类。` }],
          details: { found: false },
        };
      }
      return {
        content: [{ type: "text", text: `贴纸：${stickerPath}` }],
        details: { found: true, path: stickerPath },
      };
    },
  };
}
