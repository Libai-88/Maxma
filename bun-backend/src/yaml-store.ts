/**
 * yaml-store.ts — YAML 读写辅助（api/yaml_store.py 的 Bun 直译，阶段二 2.2）。
 *
 * Bun.YAML.stringify 默认输出与 pyyaml allow_unicode=True 兼容的 UTF-8 文本。
 * writeYamlAtomic：临时文件 + rename（对齐 dump_yaml_atomic）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** 安全解析 YAML（损坏返回 null，不抛）。 */
export function BunYamlSafeParse(text: string): unknown {
  try {
    return Bun.YAML.parse(text);
  } catch {
    return null;
  }
}

/** 原子写 YAML（临时文件 + rename，避免半写文件）。 */
export function writeYamlAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, Bun.YAML.stringify(data), "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort
    }
    throw err;
  }
}

/** 读 JSON（损坏返回 null）。 */
export function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 原子写 JSON（ensure_ascii=False 等价：直接 UTF-8 输出）。 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  writeTextAtomic(filePath, JSON.stringify(data, null, 2));
}

/**
 * 原子写纯文本（临时文件 + rename）。
 *
 * ⚠️ 需要**块状 YAML 文本**时用它，不要用 `writeYamlAtomic`：
 * `Bun.YAML.stringify` 输出的是**流式（flow）风格**
 * （实测 `{version: 1,refs: {NAME: value}}` 一行），任何按行扫描 YAML 的
 * 消费者（例如 Jet Hub 插件从 `.credentials.yaml` 的 `refs:` 段重建账号索引）
 * 都读不到。
 */
export function writeTextAtomic(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort
    }
    throw err;
  }
}
