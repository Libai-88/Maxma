/**
 * auth.ts — Token 生成/加载/轮换（api/db/auth.py 的 Bun 直译，阶段二 2.0）。
 *
 * ⚠️ 生产契约：Python 实际使用 SQLite `auth_tokens` 表（api/db/auth.py，
 * token_hex(32) 64 字符 hex）；api/auth.py 的 YAML 版是遗留实现——Bun 后端
 * 必须读写同一个 maxma.db，保证灰度期同一 Token 在 8000/8001 之间互认。
 *
 * 兼容要点：表结构 `auth_tokens(id, token)`；取 `ORDER BY id DESC LIMIT 1`
 * （rotate = 追加新行，非覆盖）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Database } from "bun:sqlite";

import { getApiDataDir } from "./app-paths";

/** maxma.db 路径（与 Python api/db/core.py DB_PATH 一致）。 */
export function dbPath(): string {
  return path.join(getApiDataDir(), "maxma.db");
}

/** 生成 Token —— 对齐 Python `secrets.token_hex(32)`（64 字符小写 hex）。 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

/** 打开 maxma.db（无则创建目录与库），并确保 auth_tokens 表存在。 */
function openAuthDb(): Database {
  fs.mkdirSync(getApiDataDir(), { recursive: true });
  const db = new Database(dbPath());
  db.exec(
    "CREATE TABLE IF NOT EXISTS auth_tokens (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "token TEXT NOT NULL)",
  );
  return db;
}

/** 从 SQLite 加载最新 Token，不存在则生成并写入。 */
export function loadOrCreateToken(): string {
  const db = openAuthDb();
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get() as
      | { token: string }
      | null;
    if (row?.token) return row.token;
    const token = generateToken();
    db.query("INSERT INTO auth_tokens (token) VALUES (?)").run(token);
    console.info("[auth] Created new auth token in DB");
    return token;
  } finally {
    db.close();
  }
}

/** 轮换 Token（追加新行，返回新值）——与 Python rotate_token 同语义。 */
export function rotateToken(): string {
  const db = openAuthDb();
  try {
    const token = generateToken();
    db.query("INSERT INTO auth_tokens (token) VALUES (?)").run(token);
    console.info("[auth] Token rotated");
    return token;
  } finally {
    db.close();
  }
}
