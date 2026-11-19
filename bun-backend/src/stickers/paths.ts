/**
 * Maxma 表情系统路径（dsh-meme pack 模型）。
 *
 * 所有运行时路径都惰性读取 app-paths，测试通过 MAXMA_BUNDLE_DIR/MAXMA_DATA_DIR
 * 隔离；不要缓存返回值。
 */
import * as path from "node:path";

import { bundleDir, dataDir } from "../app-paths";

export const BUILTIN_PACK_ID = "maxma_builtin";
export const USER_PACK_ID = "dsh-meme-user";
export const LEGACY_CUSTOM_PACK_ID = "maxma_legacy_custom";

export function builtinPackDir(): string {
  return path.join(bundleDir(), "config", "stickers");
}

export function stickersDataRoot(): string {
  return path.join(dataDir(), "stickers");
}

export function packsDir(): string {
  return path.join(stickersDataRoot(), "packs");
}

export function userPackDir(): string {
  return path.join(packsDir(), USER_PACK_ID);
}

export function legacyCustomPackDir(): string {
  return path.join(packsDir(), LEGACY_CUSTOM_PACK_ID);
}

export function legacyCustomSourceDir(): string {
  return path.join(dataDir(), "config", "stickers", "custom");
}

export function settingsPath(): string {
  return path.join(stickersDataRoot(), "settings.json");
}

export function cacheDir(): string {
  return path.join(stickersDataRoot(), "cache");
}

export function tmpDir(): string {
  return path.join(stickersDataRoot(), "tmp");
}

export function backupDir(timestamp = Date.now()): string {
  return path.join(stickersDataRoot(), "backup", String(timestamp));
}

export function recentPath(): string {
  return path.join(stickersDataRoot(), "recent.json");
}

export function legacyFavoritesPath(): string {
  return path.join(dataDir(), "api", "data", "sticker_favorites.yaml");
}

export function legacyRecentPath(): string {
  return path.join(dataDir(), "api", "data", "sticker_recent.yaml");
}

export function legacyPreferencesPath(): string {
  return path.join(dataDir(), "api", "data", "sticker_preferences.yaml");
}

export function isSafePackId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
}
