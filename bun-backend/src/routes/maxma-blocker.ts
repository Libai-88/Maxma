/**
 * routes/maxma-blocker.ts — MaxmaBlocker 拒止锚管理（api/routes/maxma_blocker.py
 * 的 Bun 直译，阶段二 2.2）。
 *
 * 安全要点（原样保留）：
 *   - 标记文件名 .maxma_blocker 必须与 kernel/extensions/maxma-blocker.ts
 *     查找约定一致（否则拒止锚失效=安全绕过）
 *   - _remove_marker 同时清理旧版 MaxBlocker 标记（向后兼容）
 *   - check-path-blocked fail-closed：NUL 字节/解析异常视为存在 blocker
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { BunYamlSafeParse, writeYamlAtomic } from "../yaml-store";
import { getApiDataDir } from "../app-paths";

export const BLOCKER_FILENAME = ".maxma_blocker";
const LEGACY_BLOCKER_FILENAMES = ["MaxBlocker"];

function blockerYamlPath(): string {
  return path.join(getApiDataDir(), "maxma_blocker.yaml");
}

interface BlockerEntry {
  path: string;
  description: string;
}

function loadBlockers(): BlockerEntry[] {
  const file = blockerYamlPath();
  if (!fs.existsSync(file)) return [];
  const raw = BunYamlSafeParse(fs.readFileSync(file, "utf8"));
  const blockers = (raw as Record<string, unknown> | null)?.blockers;
  return Array.isArray(blockers) ? (blockers as BlockerEntry[]) : [];
}

function saveBlockers(entries: BlockerEntry[]): void {
  writeYamlAtomic(blockerYamlPath(), { blockers: entries });
}

function createMarker(dirPath: string): void {
  const marker = path.join(dirPath, BLOCKER_FILENAME);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, "", "utf8");
}

function removeMarker(dirPath: string): void {
  const target = path.resolve(dirPath);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return;
  const validNames = new Set([BLOCKER_FILENAME, ...LEGACY_BLOCKER_FILENAMES].map((n) => n.toLowerCase()));
  for (const item of fs.readdirSync(target)) {
    const name = path.basename(item, path.extname(item));
    if (validNames.has(name.toLowerCase())) {
      try {
        fs.unlinkSync(path.join(target, item));
      } catch {
        // best-effort
      }
    }
  }
}

/** 查找路径或父目录中的拒止锚（fail-closed，与 kernel/extensions/maxma-blocker.ts 同语义）。 */
export function findBlockerPath(target: string): string | null {
  if (target.includes("\x00")) {
    console.warn(`[security] 路径包含 NUL 字节（fail-closed）: ${JSON.stringify(target)}`);
    return target;
  }
  let resolved: string;
  try {
    resolved = path.resolve(target);
  } catch (err) {
    console.warn(`[security] 路径解析失败（fail-closed）${target}: ${String(err)}`);
    return target;
  }
  let current = resolved;
  while (true) {
    if (fs.existsSync(path.join(current, BLOCKER_FILENAME))) {
      console.warn(`[security] MaxmaBlocker found at ${current}`);
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function createMaxmaBlockerRoutes(): Hono {
  const app = new Hono();

  app.get("/api/maxma-blocker", (c) => c.json({ entries: loadBlockers() }));

  app.post("/api/maxma-blocker", async (c) => {
    const entry = (await c.req.json().catch(() => ({}))) as Partial<BlockerEntry>;
    if (!entry.path || !fs.existsSync(entry.path) || !fs.statSync(entry.path).isDirectory()) {
      return c.json({ detail: "无效目录路径" }, 400);
    }
    createMarker(entry.path);
    const entries = loadBlockers();
    const normalized: BlockerEntry = { path: entry.path, description: entry.description ?? "" };
    entries.push(normalized);
    saveBlockers(entries);
    return c.json(normalized, 201);
  });

  app.delete("/api/maxma-blocker/:index", (c) => {
    const index = Number(c.req.param("index"));
    const entries = loadBlockers();
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      return c.json({ detail: `索引 ${c.req.param("index")} 超出范围` }, 404);
    }
    const removed = entries.splice(index, 1)[0]!;
    removeMarker(removed.path);
    saveBlockers(entries);
    return c.json({ status: "ok", removed });
  });

  app.get("/api/check-path-blocked", (c) => {
    const target = c.req.query("path") ?? "";
    const blockerPath = findBlockerPath(target);
    if (blockerPath !== null) {
      return c.json({
        blocked: true,
        reason: `路径包含 MaxmaBlocker 拒止锚: ${blockerPath}`,
        blocker_path: blockerPath,
      });
    }
    return c.json({ blocked: false, reason: null, blocker_path: null });
  });

  return app;
}
